"use strict";

const Core = globalThis.GreekVeilCore;
const State = globalThis.GreekVeilState;
const Gregg = globalThis.GreekVeilGregg;
const fields = Object.fromEntries([
  "enabled", "pack", "profile", "renderer", "revealKey",
  "clearWordFraction", "clearWordValue",
  "showIndicator", "sample", "siteRules", "customPack",
  "validation", "saveStatus", "importPack", "examplePack", "exportSettings", "reset",
  "sessionVariation", "sensitiveMode", "sensitivePack", "glyphScale", "letterSpacing",
  "autoVeilOnBlur", "autoVeilAfterMinutes", "learningHints", "customPacks",
  "veilTextInputs", "sensitivePackNote",
  "onboarding", "onboardingPack", "onboardingProfile", "onboardingSample",
  "onboardingRevealKey", "onboardingScopeAll", "onboardingScopeSites",
  "onboardingRendererNote", "onboardingTryHint",
  "finishOnboarding", "skipOnboarding", "reopenOnboarding"
].map((id) => [id, document.getElementById(id)]));

let settings = null;
let catalog = [];
let saveTimer = null;
let onboardingForcedOpen = false;
let onboardingSampleHovered = false;
let onboardingPeeking = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
  return response.value;
}

function selectedPack() {
  return Core.getPack(fields.pack.value, settings?.customPacks || []);
}

function populateProfiles(pack, selected) {
  fields.profile.replaceChildren();
  for (const [id, profile] of Object.entries(pack.profiles)) {
    fields.profile.add(new Option(profile.name || id, id, false, id === selected));
  }
}

function populateRenderers(pack, selected) {
  fields.renderer.replaceChildren();
  const labels = {
    overlay: "Source-preserving overlay · slower",
    unicode: "Fast Unicode · changes page text",
    strokes: "Source-preserving connected strokes"
  };
  for (const renderer of pack.renderers) {
    fields.renderer.add(new Option(labels[renderer] || renderer, renderer, false, renderer === selected));
  }
}

function preferredRenderer(pack) {
  return pack.renderers.includes("unicode") ? "unicode" : pack.defaultRenderer;
}

function appendGreggSample(container, source, clearRanges) {
  const namespace = "http://www.w3.org/2000/svg";
  const tokens = source.match(/\s+|[A-Za-z]+(?:['’][A-Za-z]+)*|[^A-Za-z\s]+/g) || [source];
  let offset = 0;
  for (const token of tokens) {
    const start = offset;
    const end = start + token.length;
    offset = end;
    const clear = clearRanges.some((range) => range.start === start && range.end === end);
    const outline = !clear && /[A-Za-z]/.test(token) ? Gregg?.outlineWord(token) : null;
    if (!outline) {
      container.append(document.createTextNode(token));
      continue;
    }
    const part = document.createElement("span");
    part.className = "gregg-sample-word";
    part.textContent = token;
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", outline.viewBox);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    for (const segment of outline.paths) {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", segment.d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", String(segment.width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(path);
    }
    part.append(svg);
    container.append(part);
  }
}

function renderSample(container, pack, profileId, renderer, fraction = 0) {
  const source = pack.sample || "Readable to you. Opaque at a glance.";
  const clearRanges = Core.selectClearWordRanges(source, fraction, 1);
  container.replaceChildren();
  if (renderer === "strokes") {
    appendGreggSample(container, source, clearRanges);
    return;
  }
  if (renderer === "unicode") {
    container.textContent = Core.transform(
      source,
      pack,
      profileId,
      { clearWordRanges: clearRanges, wordSeed: 1 }
    );
    return;
  }

  let offset = 0;
  for (const token of source.match(/\s+|[^\s]+/g) || [source]) {
    const start = offset;
    const end = start + token.length;
    offset = end;
    if (!/[A-Za-z]/.test(token)) {
      container.append(document.createTextNode(token));
      continue;
    }
    const localClearRanges = clearRanges
      .filter((range) => range.start >= start && range.end <= end)
      .map((range) => ({ start: range.start - start, end: range.end - start }));
    const part = document.createElement("span");
    part.className = "sample-overlay-part";
    part.textContent = token;
    part.dataset.gvRendered = Core.transform(token, pack, profileId, {
      clearWordRanges: localClearRanges,
      sourceOffset: start,
      wordSeed: 1
    });
    container.append(part);
  }
}

function updateSample() {
  renderSample(
    fields.sample,
    selectedPack(),
    fields.profile.value,
    fields.renderer.value,
    Number(fields.clearWordFraction.value)
  );
}

function populateSensitivePacks(renderer, selected) {
  const compatible = catalog.filter((item) => item.renderers.includes(renderer));
  const fallbackId = compatible.some((item) => item.id === fields.pack.value)
    ? fields.pack.value
    : compatible[0]?.id;
  const selectedId = compatible.some((item) => item.id === selected) ? selected : fallbackId;
  fields.sensitivePack.replaceChildren();
  for (const item of compatible) {
    fields.sensitivePack.add(new Option(item.name, item.id, false, item.id === selectedId));
  }
  fields.sensitivePack.disabled = settings.sensitiveMode !== "pack";
}

function updateOnboardingSample() {
  const pack = Core.getPack(fields.onboardingPack.value, settings?.customPacks || []);
  const renderer = preferredRenderer(pack);
  renderSample(
    fields.onboardingSample,
    pack,
    fields.onboardingProfile.value,
    renderer
  );
  const rendererLabels = {
    unicode: "Fast Unicode rendering",
    overlay: "Source-preserving overlay",
    strokes: "Connected-stroke rendering"
  };
  fields.onboardingRendererNote.textContent = rendererLabels[renderer] || renderer;
}

function prepareOnboarding() {
  fields.onboardingPack.replaceChildren();
  for (const item of catalog) {
    const suffix = item.maturity === "production" ? "" : ` · ${item.maturity}`;
    fields.onboardingPack.add(
      new Option(`${item.name}${suffix}`, item.id, false, item.id === settings.defaultPackId)
    );
  }
  const pack = Core.getPack(fields.onboardingPack.value, settings.customPacks);
  fields.onboardingProfile.replaceChildren();
  for (const [id, profile] of Object.entries(pack.profiles)) {
    fields.onboardingProfile.add(
      new Option(profile.name || id, id, false, id === settings.defaultProfileId)
    );
  }
  fields.onboardingRevealKey.value = settings.revealKey || "Alt";
  fields.onboardingScopeAll.checked = settings.enabled;
  fields.onboardingScopeSites.checked = !settings.enabled;
  updateOnboardingSample();
}

function updateOnboardingVisibility() {
  const visible = onboardingForcedOpen || !settings.onboardingComplete;
  fields.onboarding.hidden = !visible;
  document.body.classList.toggle("setup-active", visible);
  if (visible) prepareOnboarding();
}

function revealOnboardingSample() {
  if (onboardingPeeking || fields.onboarding.hidden) return;
  const pack = Core.getPack(fields.onboardingPack.value, settings?.customPacks || []);
  onboardingPeeking = true;
  fields.onboardingSample.classList.add("is-peeking");
  fields.onboardingSample.textContent = pack.sample || "Readable to you. Opaque at a glance.";
  fields.onboardingTryHint.textContent = "Peek works. Release the key to restore the veil.";
  fields.onboardingTryHint.classList.add("success");
}

function veilOnboardingSample() {
  if (!onboardingPeeking) return;
  onboardingPeeking = false;
  fields.onboardingSample.classList.remove("is-peeking");
  updateOnboardingSample();
  fields.onboardingTryHint.textContent = "Nice—use that same gesture on a page whenever you need the original text.";
  fields.onboardingTryHint.classList.add("success");
}

function isOnboardingRevealKey(event) {
  const wanted = (fields.onboardingRevealKey.value || "Alt").trim().toLowerCase();
  const pressed = event.key.toLowerCase();
  return pressed === wanted ||
    (wanted === "option" && pressed === "alt") ||
    (wanted === "alt" && pressed === "option");
}

function renderRules() {
  fields.siteRules.replaceChildren();
  const rules = Object.entries(settings.siteRules);
  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved site rules yet.";
    fields.siteRules.append(empty);
    return;
  }
  for (const [origin, rule] of rules) {
    const row = document.createElement("div");
    row.className = "rule";
    const title = document.createElement("strong");
    title.textContent = origin;
    const detail = document.createElement("small");
    const rulePack = rule.packId ? ` · ${rule.packId}` : "";
    const clearWords = Number.isFinite(rule.clearWordFraction)
      ? ` · ${Math.round(rule.clearWordFraction * 100)}% visible words`
      : "";
    detail.textContent = `${rule.enabled === true ? "Always veil" : rule.enabled === false ? "Never veil" : "Uses global state"}${rulePack}${clearWords}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const siteRules = { ...settings.siteRules };
      delete siteRules[origin];
      await savePatch({ siteRules });
      renderRules();
    });
    row.append(title, detail, remove);
    fields.siteRules.append(row);
  }
}

function renderCustomPacks() {
  fields.customPacks.replaceChildren();
  if (!settings.customPacks.length) return;
  for (const pack of settings.customPacks) {
    const row = document.createElement("div");
    row.className = "rule";
    const title = document.createElement("strong");
    title.textContent = pack.name;
    const detail = document.createElement("small");
    detail.textContent = `${pack.id} · ${pack.maturity}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Uninstall";
    remove.addEventListener("click", async () => {
      const customPacks = settings.customPacks.filter((current) => current.id !== pack.id);
      const patch = { customPacks };
      if (settings.defaultPackId === pack.id) {
        Object.assign(patch, {
          defaultPackId: "greek",
          defaultProfileId: "dense",
          defaultRenderer: "unicode"
        });
      }
      await savePatch(patch);
      render();
    });
    row.append(title, detail, remove);
    fields.customPacks.append(row);
  }
}

function render() {
  fields.enabled.checked = settings.enabled;
  fields.revealKey.value = settings.revealKey;
  fields.clearWordFraction.value = settings.clearWordFraction;
  fields.clearWordValue.value = `${Math.round(settings.clearWordFraction * 100)}%`;
  fields.showIndicator.checked = settings.showIndicator;
  fields.sessionVariation.checked = settings.sessionVariation;
  fields.sensitiveMode.value = settings.sensitiveMode;
  fields.glyphScale.value = settings.glyphScale;
  fields.letterSpacing.value = settings.letterSpacing;
  fields.autoVeilOnBlur.checked = settings.autoVeilOnBlur;
  fields.autoVeilAfterMinutes.value = settings.autoVeilAfterMinutes;
  fields.learningHints.checked = settings.learningHints;
  fields.veilTextInputs.checked = settings.veilTextInputs;
  fields.pack.replaceChildren();
  for (const item of catalog) {
    const suffix = item.maturity === "production" ? "" : ` · ${item.maturity}`;
    fields.pack.add(new Option(`${item.name}${suffix}`, item.id, false, item.id === settings.defaultPackId));
  }
  const pack = selectedPack();
  populateProfiles(pack, settings.defaultProfileId);
  populateRenderers(pack, Core.resolveRenderer(pack, settings.defaultRenderer));
  populateSensitivePacks(fields.renderer.value, settings.sensitivePackId);
  updateSample();
  updateOnboardingVisibility();
  renderRules();
  renderCustomPacks();
  fields.saveStatus.textContent = "Settings loaded";
  setTimeout(() => { fields.saveStatus.textContent = "Saved locally"; }, 900);
}

async function savePatch(patch) {
  fields.saveStatus.textContent = "Saving…";
  const result = await send({ type: "gv-update-settings", patch });
  settings = result.settings;
  catalog = result.catalog;
  fields.saveStatus.textContent = "Saved locally";
}

function scheduleDefaultsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await savePatch({
        enabled: fields.enabled.checked,
        defaultPackId: fields.pack.value,
        defaultProfileId: fields.profile.value,
        defaultRenderer: fields.renderer.value,
        clearWordFraction: Number(fields.clearWordFraction.value),
        revealKey: fields.revealKey.value || "Alt",
        showIndicator: fields.showIndicator.checked,
        sessionVariation: fields.sessionVariation.checked,
        sensitiveMode: fields.sensitiveMode.value,
        sensitivePackId: fields.sensitivePack.value,
        glyphScale: Number(fields.glyphScale.value),
        letterSpacing: Number(fields.letterSpacing.value),
        autoVeilOnBlur: fields.autoVeilOnBlur.checked,
        autoVeilAfterMinutes: Number(fields.autoVeilAfterMinutes.value),
        learningHints: fields.learningHints.checked,
        veilTextInputs: fields.veilTextInputs.checked
      });
    } catch (error) {
      fields.saveStatus.textContent = error.message;
    }
  }, 180);
}

for (const field of [
  fields.enabled, fields.profile, fields.renderer, fields.revealKey,
  fields.clearWordFraction,
  fields.showIndicator, fields.sessionVariation,
  fields.sensitiveMode, fields.sensitivePack,
  fields.glyphScale, fields.letterSpacing, fields.autoVeilOnBlur,
  fields.autoVeilAfterMinutes, fields.learningHints, fields.veilTextInputs
]) {
  field.addEventListener("input", () => {
    fields.clearWordValue.value = `${Math.round(Number(fields.clearWordFraction.value) * 100)}%`;
    if (field === fields.renderer) {
      populateSensitivePacks(fields.renderer.value, fields.sensitivePack.value);
    }
    fields.sensitivePack.disabled = fields.sensitiveMode.value !== "pack";
    updateSample();
    scheduleDefaultsSave();
  });
}

fields.pack.addEventListener("change", () => {
  const pack = selectedPack();
  populateProfiles(pack, pack.defaultProfile);
  populateRenderers(pack, preferredRenderer(pack));
  populateSensitivePacks(fields.renderer.value, fields.sensitivePack.value);
  updateSample();
  scheduleDefaultsSave();
});

fields.onboardingPack.addEventListener("change", () => {
  const pack = Core.getPack(fields.onboardingPack.value, settings.customPacks);
  fields.onboardingProfile.replaceChildren();
  for (const [id, profile] of Object.entries(pack.profiles)) {
    fields.onboardingProfile.add(new Option(profile.name || id, id, false, id === pack.defaultProfile));
  }
  updateOnboardingSample();
});
fields.onboardingProfile.addEventListener("change", updateOnboardingSample);
fields.onboardingSample.addEventListener("pointerenter", () => {
  onboardingSampleHovered = true;
});
fields.onboardingSample.addEventListener("pointerleave", () => {
  onboardingSampleHovered = false;
  veilOnboardingSample();
});
fields.onboardingSample.addEventListener("focus", () => {
  onboardingSampleHovered = true;
});
fields.onboardingSample.addEventListener("blur", () => {
  onboardingSampleHovered = false;
  veilOnboardingSample();
});
window.addEventListener("keydown", (event) => {
  if (onboardingSampleHovered && isOnboardingRevealKey(event)) revealOnboardingSample();
});
window.addEventListener("keyup", (event) => {
  if (isOnboardingRevealKey(event)) veilOnboardingSample();
});
window.addEventListener("blur", veilOnboardingSample);

fields.finishOnboarding.addEventListener("click", async () => {
  const pack = Core.getPack(fields.onboardingPack.value, settings.customPacks);
  await savePatch({
    onboardingComplete: true,
    enabled: fields.onboardingScopeAll.checked,
    defaultPackId: pack.id,
    defaultProfileId: fields.onboardingProfile.value,
    defaultRenderer: preferredRenderer(pack),
    revealKey: fields.onboardingRevealKey.value || "Alt"
  });
  onboardingForcedOpen = false;
  render();
});

fields.skipOnboarding.addEventListener("click", async () => {
  await savePatch({ onboardingComplete: true });
  onboardingForcedOpen = false;
  render();
});

fields.reopenOnboarding.addEventListener("click", () => {
  onboardingForcedOpen = true;
  updateOnboardingVisibility();
  fields.onboarding.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start"
  });
});

fields.examplePack.addEventListener("click", () => {
  fields.customPack.value = JSON.stringify({
    schemaVersion: 1,
    id: "triangle-demo",
    name: "Triangle demo",
    script: "Symbols",
    maturity: "experimental",
    description: "A small custom visual pack.",
    renderers: ["overlay"],
    defaultRenderer: "overlay",
    defaultProfile: "familiar",
    profiles: {
      familiar: {
        name: "Familiar",
        mapping: { a: "∆", e: "⋿", i: "Ⅰ", o: "◯", s: "ϟ", t: "†" }
      }
    },
    sample: "Readable to you. Opaque at a glance."
  }, null, 2);
});

fields.importPack.addEventListener("click", async () => {
  try {
    const pack = JSON.parse(fields.customPack.value);
    const result = Core.validatePack(pack);
    if (!result.valid) throw new Error(result.errors.join("\n"));
    if (Core.BUILTIN_PACKS.some((builtIn) => builtIn.id === pack.id)) throw new Error("Built-in pack IDs cannot be replaced.");
    const customPacks = settings.customPacks.filter((current) => current.id !== pack.id);
    customPacks.push(pack);
    await savePatch({ customPacks });
    render();
    fields.validation.textContent = `${pack.name} installed successfully.`;
  } catch (error) {
    fields.validation.textContent = error.message;
  }
});

fields.exportSettings.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "kalima-settings.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

fields.reset.addEventListener("click", async () => {
  if (!confirm("Reset every Kalima preference, site rule, and custom pack?")) return;
  const result = await send({ type: "gv-update-settings", patch: structuredClone(State.DEFAULT_SETTINGS) });
  settings = result.settings;
  catalog = result.catalog;
  render();
});

send({ type: "gv-get-settings" })
  .then((result) => {
    settings = result.settings;
    catalog = result.catalog;
    render();
  })
  .catch((error) => { fields.saveStatus.textContent = error.message; });
