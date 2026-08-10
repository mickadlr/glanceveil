"use strict";

importScripts("shared/core.js", "shared/state.js");

const Core = globalThis.GreekVeilCore;
const State = globalThis.GreekVeilState;
const memoryTabStates = {};

async function readSettings() {
  const stored = await chrome.storage.local.get([State.SETTINGS_KEY, "enabled"]);
  const rawSettings = stored[State.SETTINGS_KEY] ??
    (typeof stored.enabled === "boolean" ? { enabled: stored.enabled } : {});
  return State.migrateSettings(rawSettings);
}

async function writeSettings(settings) {
  const sanitized = State.sanitizeSettings(settings);
  sanitized.customPacks = sanitized.customPacks.filter((pack) => Core.validatePack(pack).valid);
  const defaultPack = Core.getPack(sanitized.defaultPackId, sanitized.customPacks);
  sanitized.defaultPackId = defaultPack.id;
  sanitized.defaultProfileId = defaultPack.profiles[sanitized.defaultProfileId]
    ? sanitized.defaultProfileId
    : defaultPack.defaultProfile;
  sanitized.defaultRenderer = Core.resolveRenderer(defaultPack, sanitized.defaultRenderer);
  if (sanitized.sensitiveMode === "pack") {
    const sensitivePack = Core.getPack(sanitized.sensitivePackId, sanitized.customPacks);
    sanitized.sensitivePackId = sensitivePack.renderers.includes(sanitized.defaultRenderer)
      ? sensitivePack.id
      : defaultPack.id;
  }
  await chrome.storage.local.set({ [State.SETTINGS_KEY]: sanitized });
  return sanitized;
}

async function ensureSettings() {
  const settings = await readSettings();
  return writeSettings(settings);
}

async function readTabStates() {
  if (!chrome.storage.session) return memoryTabStates;
  const stored = await chrome.storage.session.get(State.TAB_STATE_KEY);
  return stored[State.TAB_STATE_KEY] || {};
}

async function writeTabStates(states) {
  if (!chrome.storage.session) {
    Object.assign(memoryTabStates, states);
    return;
  }
  await chrome.storage.session.set({ [State.TAB_STATE_KEY]: states });
}

async function getTabState(tabId) {
  const states = await readTabStates();
  return State.sanitizeTabState(states[String(tabId)] || {});
}

async function setTabState(tabId, patch) {
  const states = await readTabStates();
  const key = String(tabId);
  const current = State.sanitizeTabState(states[key] || {});
  const next = State.sanitizeTabState({ ...current, ...patch });
  if (Object.keys(next).length) states[key] = next;
  else delete states[key];
  await writeTabStates(states);
  await notifyTab(tabId);
  return next;
}

async function clearTabState(tabId) {
  const states = await readTabStates();
  delete states[String(tabId)];
  await writeTabStates(states);
  await notifyTab(tabId);
}

function catalogSummary(customPacks) {
  return Core.getCatalog(customPacks).map((pack) => ({
    id: pack.id,
    name: pack.name,
    script: pack.script || pack.name,
    maturity: pack.maturity,
    description: pack.description || "",
    renderers: pack.renderers,
    defaultRenderer: pack.defaultRenderer,
    defaultProfile: pack.defaultProfile,
    profiles: Object.fromEntries(Object.entries(pack.profiles).map(([id, profile]) => [
      id,
      { name: profile.name || id }
    ])),
    sample: pack.sample || "Readable to you. Opaque at a glance."
  }));
}

async function resolveForTab(tabId, url) {
  const settings = await readSettings();
  const tabState = await getTabState(tabId);
  const effective = State.resolveEffectiveState(settings, tabState, url);
  const pack = Core.getPack(effective.packId, settings.customPacks);
  effective.packId = pack.id;
  effective.profileId = pack.profiles[effective.profileId] ? effective.profileId : pack.defaultProfile;
  effective.renderer = Core.resolveRenderer(pack, effective.renderer);
  return {
    effective,
    pack,
    settings,
    tabState,
    catalog: catalogSummary(settings.customPacks)
  };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function notifyTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const resolved = await resolveForTab(tabId, tab.url || "");
    await updateBadge(tabId, resolved);
    await chrome.tabs.sendMessage(tabId, { type: "gv-apply-state", payload: resolved });
  } catch {
    // Restricted, discarded, or not yet injected tabs are expected.
  }
}

async function updateBadge(tabId, resolved) {
  const state = resolved.effective;
  const text = !state.supported ? "!" : state.enabled ? "λ" : "";
  const color = !state.supported ? "#666666" : "#5e3fb0";
  await chrome.action.setBadgeText({ tabId, text });
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setTitle({
    tabId,
    title: !state.supported ? "Kalima is unavailable on this page" :
      state.enabled ? `${resolved.pack.name} veil is active (${state.scope})` :
        `Kalima is off (${state.scope})`
  });
}

async function setSiteRule(tabId, url, patch) {
  const settings = await readSettings();
  const origin = State.normalizeOrigin(url);
  if (!origin) throw new Error("This page does not support site rules.");
  const current = settings.siteRules[origin] || {};
  settings.siteRules[origin] = { ...current, ...patch };
  await writeSettings(settings);
  await notifyTab(tabId);
}

async function removeSiteRule(tabId, url) {
  const settings = await readSettings();
  const origin = State.normalizeOrigin(url);
  if (origin) delete settings.siteRules[origin];
  await writeSettings(settings);
  await notifyTab(tabId);
}

function isGoogleDocsDocument(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "docs.google.com" &&
      parsed.pathname.startsWith("/document/");
  } catch {
    return false;
  }
}

async function finishTabMutation(tab, url) {
  const resolved = await resolveForTab(tab.id, url);
  if (isGoogleDocsDocument(url)) {
    try {
      await chrome.tabs.reload(tab.id);
    } catch {
      // A tab can close between applying the state and requesting its repaint.
    }
  }
  return resolved;
}

async function handleMessage(message, sender) {
  const type = message?.type;
  const senderTab = sender.tab;
  const requestedTab = Number.isInteger(message?.tabId) ? await chrome.tabs.get(message.tabId) : null;
  const tab = senderTab || requestedTab;

  if (type === "gv-get-state") {
    if (!tab?.id) throw new Error("No browser tab is associated with this request.");
    const result = await resolveForTab(tab.id, tab.url || message.url || "");
    await updateBadge(tab.id, result);
    return result;
  }

  if (type === "gv-get-settings") {
    const settings = await readSettings();
    return { settings, catalog: catalogSummary(settings.customPacks) };
  }

  if (type === "gv-update-settings") {
    const current = await readSettings();
    const settings = await writeSettings({ ...current, ...(message.patch || {}) });
    return { settings, catalog: catalogSummary(settings.customPacks) };
  }

  if (!tab?.id) throw new Error("No active tab is available.");
  const url = tab.url || message.url || "";

  switch (type) {
    case "gv-toggle-tab": {
      const resolved = await resolveForTab(tab.id, url);
      await setTabState(tab.id, { enabled: !resolved.effective.enabled });
      return finishTabMutation(tab, url);
    }
    case "gv-set-tab-enabled":
      await setTabState(tab.id, { enabled: Boolean(message.enabled) });
      return finishTabMutation(tab, url);
    case "gv-clear-tab":
      await clearTabState(tab.id);
      return finishTabMutation(tab, url);
    case "gv-set-tab-preferences":
      await setTabState(tab.id, {
        enabled: true,
        packId: message.packId,
        profileId: message.profileId,
        renderer: message.renderer,
        clearWordFraction: message.clearWordFraction
      });
      return finishTabMutation(tab, url);
    case "gv-set-site-enabled":
      await setSiteRule(tab.id, url, {
        enabled: Boolean(message.enabled),
        ...(message.enabled ? {
          packId: message.packId,
          profileId: message.profileId,
          renderer: message.renderer,
          clearWordFraction: message.clearWordFraction
        } : {})
      });
      return finishTabMutation(tab, url);
    case "gv-clear-site":
      await removeSiteRule(tab.id, url);
      return finishTabMutation(tab, url);
    default:
      throw new Error(`Unknown Kalima message: ${String(type)}`);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureSettings()
    .then((settings) => {
      if (details.reason === "install" && !settings.onboardingComplete) {
        return chrome.runtime.openOptionsPage();
      }
      return undefined;
    })
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureSettings().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await activeTab();
  if (!tab?.id) return;
  if (command === "toggle-greek-veil") {
    await handleMessage({ type: "gv-toggle-tab", tabId: tab.id, url: tab.url }, {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[State.SETTINGS_KEY]) return;
  chrome.tabs.query({})
    .then((tabs) => Promise.all(tabs.filter((tab) => tab.id).map((tab) => notifyTab(tab.id))))
    .catch(() => {});
});
