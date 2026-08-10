(function initGreekVeilState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.GreekVeilState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const SETTINGS_KEY = "veilSettings";
  const TAB_STATE_KEY = "veilTabStates";
  const SCHEMA_VERSION = 4;

  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    defaultPackId: "greek",
    defaultProfileId: "dense",
    defaultRenderer: "unicode",
    clearWordFraction: 0,
    revealKey: "Alt",
    siteRules: {},
    customPacks: [],
    showIndicator: true,
    sessionVariation: false,
    sensitiveMode: "off",
    sensitivePackId: "greek",
    glyphScale: 1,
    letterSpacing: 0,
    autoVeilOnBlur: false,
    autoVeilAfterMinutes: 0,
    learningHints: false,
    veilTextInputs: true,
    onboardingComplete: false
  });

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeOrigin(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "file:") return "file://";
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return parsed.origin;
    } catch {
      return "";
    }
  }

  function sanitizeSiteRule(rule) {
    if (!isPlainObject(rule)) return {};
    const result = {};
    if (typeof rule.enabled === "boolean") result.enabled = rule.enabled;
    if (typeof rule.packId === "string") result.packId = rule.packId;
    if (typeof rule.profileId === "string") result.profileId = rule.profileId;
    if (["overlay", "unicode", "strokes"].includes(rule.renderer)) result.renderer = rule.renderer;
    if (Number.isFinite(rule.clearWordFraction)) {
      result.clearWordFraction = Math.min(0.5, Math.max(0, rule.clearWordFraction));
    }
    return result;
  }

  function sanitizeSettings(input = {}) {
    const raw = isPlainObject(input) ? input : {};
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
      defaultPackId: typeof raw.defaultPackId === "string" ? raw.defaultPackId : DEFAULT_SETTINGS.defaultPackId,
      defaultProfileId: typeof raw.defaultProfileId === "string" ? raw.defaultProfileId : DEFAULT_SETTINGS.defaultProfileId,
      defaultRenderer: ["overlay", "unicode", "strokes"].includes(raw.defaultRenderer)
        ? raw.defaultRenderer
        : DEFAULT_SETTINGS.defaultRenderer,
      clearWordFraction: Number.isFinite(raw.clearWordFraction)
        ? Math.min(0.5, Math.max(0, raw.clearWordFraction))
        : DEFAULT_SETTINGS.clearWordFraction,
      revealKey: typeof raw.revealKey === "string" && raw.revealKey.length < 32
        ? raw.revealKey
        : DEFAULT_SETTINGS.revealKey,
      showIndicator: raw.showIndicator !== false,
      sessionVariation: Boolean(raw.sessionVariation),
      sensitiveMode: ["off", "dense", "pack"].includes(raw.sensitiveMode) ? raw.sensitiveMode : "off",
      sensitivePackId: typeof raw.sensitivePackId === "string" ? raw.sensitivePackId : "greek",
      glyphScale: Number.isFinite(raw.glyphScale) ? Math.min(1.2, Math.max(0.8, raw.glyphScale)) : 1,
      letterSpacing: Number.isFinite(raw.letterSpacing) ? Math.min(3, Math.max(-1, raw.letterSpacing)) : 0,
      autoVeilOnBlur: Boolean(raw.autoVeilOnBlur),
      autoVeilAfterMinutes: Number.isFinite(raw.autoVeilAfterMinutes)
        ? Math.min(120, Math.max(0, raw.autoVeilAfterMinutes))
        : 0,
      learningHints: Boolean(raw.learningHints),
      veilTextInputs: raw.veilTextInputs !== false,
      onboardingComplete: Boolean(raw.onboardingComplete),
      siteRules: {},
      customPacks: Array.isArray(raw.customPacks) ? raw.customPacks.slice(0, 25) : []
    };
    if (isPlainObject(raw.siteRules)) {
      for (const [origin, rule] of Object.entries(raw.siteRules).slice(0, 500)) {
        if (normalizeOrigin(origin) === origin || origin === "file://") settings.siteRules[origin] = sanitizeSiteRule(rule);
      }
    }
    return settings;
  }

  function migrateSettings(stored = {}) {
    if (stored?.schemaVersion === SCHEMA_VERSION) return sanitizeSettings(stored);
    const storedObject = isPlainObject(stored) ? stored : {};
    const priorVersion = Number(storedObject.schemaVersion) || 0;
    const hasExistingSettings = Object.keys(storedObject).length > 0;
    return sanitizeSettings({
      ...storedObject,
      schemaVersion: SCHEMA_VERSION,
      enabled: typeof storedObject.enabled === "boolean" ? storedObject.enabled : true,
      // Version 3 extends the non-mutating input mirror to contenteditable
      // chat composers and makes editor-style completed-word veiling standard.
      veilTextInputs: priorVersion >= 3 ? storedObject.veilTextInputs !== false : true,
      // Existing users should not be interrupted by a new first-run flow.
      // An empty store belongs to a genuinely fresh installation.
      onboardingComplete: hasExistingSettings
    });
  }

  function sanitizeTabState(input = {}) {
    if (!isPlainObject(input)) return {};
    const state = {};
    if (typeof input.enabled === "boolean") state.enabled = input.enabled;
    if (typeof input.packId === "string") state.packId = input.packId;
    if (typeof input.profileId === "string") state.profileId = input.profileId;
    if (["overlay", "unicode", "strokes"].includes(input.renderer)) state.renderer = input.renderer;
    if (Number.isFinite(input.clearWordFraction)) {
      state.clearWordFraction = Math.min(0.5, Math.max(0, input.clearWordFraction));
    }
    return state;
  }

  function isSupportedUrl(url) {
    try {
      return ["http:", "https:", "file:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  function resolveEffectiveState(settingsInput, tabInput, url, now = Date.now()) {
    const settings = sanitizeSettings(settingsInput);
    const tab = sanitizeTabState(tabInput);
    const origin = normalizeOrigin(url);
    const site = origin ? sanitizeSiteRule(settings.siteRules[origin]) : {};
    const supported = isSupportedUrl(url);
    return {
      supported,
      origin,
      enabled: supported && (
        typeof tab.enabled === "boolean" ? tab.enabled :
          typeof site.enabled === "boolean" ? site.enabled :
            settings.enabled
      ),
      packId: tab.packId || site.packId || settings.defaultPackId,
      profileId: tab.profileId || site.profileId || settings.defaultProfileId,
      renderer: tab.renderer || site.renderer || settings.defaultRenderer,
      clearWordFraction: tab.clearWordFraction ?? site.clearWordFraction ?? settings.clearWordFraction,
      revealKey: settings.revealKey,
      showIndicator: settings.showIndicator,
      sessionVariation: settings.sessionVariation,
      sensitiveMode: settings.sensitiveMode,
      sensitivePackId: settings.sensitivePackId,
      glyphScale: settings.glyphScale,
      letterSpacing: settings.letterSpacing,
      autoVeilOnBlur: settings.autoVeilOnBlur,
      autoVeilAfterMinutes: settings.autoVeilAfterMinutes,
      learningHints: settings.learningHints,
      veilTextInputs: settings.veilTextInputs,
      scope: Object.keys(tab).length ? "tab" :
        Object.keys(site).length ? "site" : "global"
    };
  }

  return Object.freeze({
    SETTINGS_KEY,
    TAB_STATE_KEY,
    SCHEMA_VERSION,
    DEFAULT_SETTINGS,
    normalizeOrigin,
    sanitizeSettings,
    migrateSettings,
    sanitizeTabState,
    resolveEffectiveState,
    isSupportedUrl
  });
});
