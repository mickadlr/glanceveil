"use strict";

const elements = Object.fromEntries([
  "stateDot", "status", "scope", "toggleTab", "peekSelection", "clearTab",
  "pack", "profile", "renderer", "clearWordFraction", "clearWordValue", "packNote", "siteOn", "siteOff",
  "clearSite", "diagnostics", "settings"
].map((id) => [id, document.getElementById(id)]));

let tab = null;
let snapshot = null;
let busy = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage({ ...message, tabId: tab?.id, url: tab?.url });
  if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
  return response.value;
}

async function sendToTab(message) {
  if (!tab?.id) throw new Error("No active tab.");
  return chrome.tabs.sendMessage(tab.id, message);
}

function setBusy(next) {
  busy = next;
  for (const control of document.querySelectorAll("button, select, input[type='range']")) {
    control.disabled = next || !snapshot?.effective?.supported;
  }
  elements.settings.disabled = false;
}

function selectedPack() {
  return snapshot?.catalog?.find((pack) => pack.id === elements.pack.value) || snapshot?.catalog?.[0];
}

function populateProfiles(pack, selected) {
  elements.profile.replaceChildren();
  for (const [id, profile] of Object.entries(pack?.profiles || {})) {
    elements.profile.add(new Option(profile.name, id, false, id === selected));
  }
}

function populateRenderers(pack, selected) {
  elements.renderer.replaceChildren();
  const labels = {
    overlay: "Source-preserving overlay · slower",
    unicode: "Fast Unicode · changes page text",
    strokes: "Source-preserving connected strokes"
  };
  for (const renderer of pack?.renderers || []) {
    elements.renderer.add(new Option(labels[renderer] || renderer, renderer, false, renderer === selected));
  }
}

function preferredRenderer(pack) {
  return pack?.renderers?.includes("unicode") ? "unicode" : pack?.defaultRenderer;
}

function render(value) {
  snapshot = value;
  const { effective, catalog } = value;
  const pack = catalog.find((item) => item.id === effective.packId) || catalog[0];

  elements.pack.replaceChildren();
  for (const item of catalog) {
    const suffix = item.maturity === "production" ? "" : ` · ${item.maturity}`;
    elements.pack.add(new Option(`${item.name}${suffix}`, item.id, false, item.id === pack.id));
  }
  populateProfiles(pack, effective.profileId);
  populateRenderers(pack, effective.renderer);
  elements.clearWordFraction.value = effective.clearWordFraction;
  elements.clearWordValue.value = `${Math.round(effective.clearWordFraction * 100)}%`;

  elements.status.textContent = !effective.supported ? "Unavailable on this page" :
    effective.enabled ? `${pack.name} veil is active` : "Veil is off";
  elements.scope.textContent = effective.scope;
  elements.stateDot.className = `state-dot ${effective.enabled ? "on" : ""}`;
  elements.toggleTab.textContent = effective.enabled ? "Turn off for this tab" : "Turn on for this tab";
  const rendererNote = effective.renderer === "overlay" && pack.renderers.includes("unicode")
    ? " Unicode text is substantially faster on long pages."
    : "";
  const docsNote = tab?.url?.startsWith("https://docs.google.com/document/")
    ? " Google Docs reloads after appearance changes so its canvas can repaint consistently."
    : "";
  elements.packNote.textContent =
    `${pack.description} ${pack.maturity === "experimental" ? "Expect approximate output." : ""}` +
    `${rendererNote}${docsNote}`;
  setBusy(false);
  elements.clearTab.disabled = effective.scope !== "tab";
}

async function refresh() {
  try {
    tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab) throw new Error("No active tab.");
    render(await send({ type: "gv-get-state" }));
  } catch (error) {
    elements.status.textContent = error.message;
    elements.scope.textContent = "";
    snapshot = { effective: { supported: false } };
    setBusy(false);
  }
}

async function act(action) {
  if (busy) return;
  setBusy(true);
  try {
    const next = await action();
    if (next?.effective) render(next);
    else await refresh();
  } catch (error) {
    elements.status.textContent = error.message;
    setBusy(false);
  }
}

elements.toggleTab.addEventListener("click", () => act(() => send({ type: "gv-toggle-tab" })));
elements.clearTab.addEventListener("click", () => act(() => send({ type: "gv-clear-tab" })));
elements.siteOn.addEventListener("click", () => act(() => send({
  type: "gv-set-site-enabled",
  enabled: true,
  packId: elements.pack.value,
  profileId: elements.profile.value,
  renderer: elements.renderer.value,
  clearWordFraction: Number(elements.clearWordFraction.value)
})));
elements.siteOff.addEventListener("click", () => act(() => send({ type: "gv-set-site-enabled", enabled: false })));
elements.clearSite.addEventListener("click", () => act(() => send({ type: "gv-clear-site" })));
elements.peekSelection.addEventListener("click", () => act(async () => {
  const response = await sendToTab({ type: "gv-peek-selection", durationMs: 5000 });
  if (!response?.ok) throw new Error(response?.error || "Select some page text first.");
  window.close();
}));

elements.pack.addEventListener("change", () => {
  const pack = selectedPack();
  populateProfiles(pack, pack.defaultProfile);
  populateRenderers(pack, preferredRenderer(pack));
  act(() => send({
    type: "gv-set-tab-preferences",
    packId: pack.id,
    profileId: elements.profile.value,
    renderer: elements.renderer.value,
    clearWordFraction: Number(elements.clearWordFraction.value)
  }));
});

for (const element of [elements.profile, elements.renderer]) {
  element.addEventListener("change", () => act(() => send({
    type: "gv-set-tab-preferences",
    packId: elements.pack.value,
    profileId: elements.profile.value,
    renderer: elements.renderer.value,
    clearWordFraction: Number(elements.clearWordFraction.value)
  })));
}

elements.clearWordFraction.addEventListener("input", () => {
  elements.clearWordValue.value = `${Math.round(Number(elements.clearWordFraction.value) * 100)}%`;
});
elements.clearWordFraction.addEventListener("change", () => act(() => send({
  type: "gv-set-tab-preferences",
  packId: elements.pack.value,
  profileId: elements.profile.value,
  renderer: elements.renderer.value,
  clearWordFraction: Number(elements.clearWordFraction.value)
})));

document.querySelector("details").addEventListener("toggle", async (event) => {
  if (!event.currentTarget.open) return;
  try {
    const data = await sendToTab({ type: "gv-get-diagnostics" });
    elements.diagnostics.textContent = [
      `Pack: ${data.packId} / ${data.profileId}`,
      `Renderer: ${data.renderer}`,
      `Visible words: ${Math.round(data.clearWordFraction * 100)}%`,
      `Scope: ${data.scope}`,
      `Transformed nodes: ${data.transformedNodes}`,
      `Overlay groups: ${data.overlayGroups}`,
      `Input mirrors: ${data.inputMirrors}`,
      `Open shadow roots: ${data.shadowRoots}`,
      `Shadow audits: ${data.shadowAuditPasses} passes / ${data.shadowAuditElements} elements`,
      `Longest shadow-audit slice: ${data.shadowAuditMaxSliceMs} ms`,
      `Observed mutations: ${data.mutations}`,
      `DOM walks: ${data.walks} (${data.walkedTextNodes} text nodes)`,
      `Walk time: ${data.lastWalkMs} ms last / ${data.maxWalkMs} ms max`,
      `Mutation batches/roots: ${data.mutationBatches} / ${data.mutationRoots}`,
      `Automatic reasons: ${data.automationReasons.join(", ") || "none"}`,
      `Degraded: ${data.degraded.join(" ") || "none"}`,
      `Recent errors: ${data.errors.join(" · ") || "none"}`,
      "Page text and URL are never included."
    ].join("\n");
  } catch (error) {
    elements.diagnostics.textContent = error.message;
  }
});

elements.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
refresh();
