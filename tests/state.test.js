"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../browser-extension/shared/state.js");

test("migrates the original enabled boolean", () => {
  const migrated = state.migrateSettings({ enabled: false });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.enabled, false);
  assert.equal(migrated.defaultPackId, "greek");
  assert.equal(migrated.defaultProfileId, "dense");
  assert.equal(migrated.defaultRenderer, "unicode");
  assert.equal(migrated.veilTextInputs, true);
  assert.equal(migrated.onboardingComplete, true);
});

test("fresh settings default to the dense Unicode veil", () => {
  assert.equal(state.DEFAULT_SETTINGS.defaultProfileId, "dense");
  assert.equal(state.DEFAULT_SETTINGS.defaultRenderer, "unicode");
  const effective = state.resolveEffectiveState({}, {}, "https://example.com");
  assert.equal(effective.profileId, "dense");
  assert.equal(effective.renderer, "unicode");
  assert.equal(state.migrateSettings({}).onboardingComplete, false);
});

test("schema 4 preserves explicit editor veiling and onboarding choices", () => {
  const migrated = state.migrateSettings({
    schemaVersion: 3,
    veilTextInputs: false
  });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.veilTextInputs, false);
  assert.equal(migrated.onboardingComplete, true);
  assert.equal(state.sanitizeSettings({}).veilTextInputs, true);
  assert.equal(state.sanitizeSettings({ onboardingComplete: true }).onboardingComplete, true);
});

test("tab state overrides site state, which overrides global state", () => {
  const settings = state.sanitizeSettings({
    enabled: false,
    clearWordFraction: 0.1,
    siteRules: {
      "https://example.com": { enabled: true, packId: "cyrillic", clearWordFraction: 0.3 }
    }
  });
  const siteResult = state.resolveEffectiveState(settings, {}, "https://example.com/mail");
  assert.equal(siteResult.enabled, true);
  assert.equal(siteResult.packId, "cyrillic");
  assert.equal(siteResult.clearWordFraction, 0.3);
  assert.equal(siteResult.scope, "site");

  const tabResult = state.resolveEffectiveState(
    settings,
    { enabled: false, packId: "greek", clearWordFraction: 0 },
    "https://example.com/mail"
  );
  assert.equal(tabResult.enabled, false);
  assert.equal(tabResult.packId, "greek");
  assert.equal(tabResult.clearWordFraction, 0);
  assert.equal(tabResult.scope, "tab");
});

test("legacy timed-pause state is discarded", () => {
  const settings = state.sanitizeSettings({ enabled: true });
  assert.deepEqual(state.sanitizeTabState({ pauseUntil: 2000 }), {});
  assert.equal(state.resolveEffectiveState(settings, { pauseUntil: 2000 }, "https://example.com").enabled, true);
});

test("restricted browser pages are unsupported", () => {
  const result = state.resolveEffectiveState(state.DEFAULT_SETTINGS, {}, "chrome://extensions");
  assert.equal(result.supported, false);
  assert.equal(result.enabled, false);
});

test("legacy area-picker fields are discarded", () => {
  const settings = state.sanitizeSettings({
    siteRules: {
      "https://example.com": {
        selectiveZones: true,
        zones: [{ selector: ".message", action: "veil" }],
        enabled: false
      }
    }
  });
  assert.deepEqual(settings.siteRules["https://example.com"], { enabled: false });
});

test("adaptive settings are clamped and resolved without page data", () => {
  const settings = state.sanitizeSettings({
    glyphScale: 9,
    letterSpacing: -9,
    autoVeilAfterMinutes: 999,
    sensitiveMode: "pack",
    sensitivePackId: "hebrew",
    sessionVariation: true,
    learningHints: true
  });
  const effective = state.resolveEffectiveState(settings, {}, "https://example.com");
  assert.equal(effective.glyphScale, 1.2);
  assert.equal(effective.letterSpacing, -1);
  assert.equal(effective.autoVeilAfterMinutes, 120);
  assert.equal(effective.sensitiveMode, "pack");
  assert.equal(effective.sensitivePackId, "hebrew");
  assert.equal(effective.sessionVariation, true);
  assert.equal(effective.learningHints, true);
});

test("clear-word fractions are bounded in every scope", () => {
  const settings = state.sanitizeSettings({
    clearWordFraction: 9,
    siteRules: { "https://example.com": { clearWordFraction: -2 } }
  });
  assert.equal(settings.clearWordFraction, 0.5);
  assert.equal(settings.siteRules["https://example.com"].clearWordFraction, 0);
  assert.equal(state.sanitizeTabState({ clearWordFraction: 4 }).clearWordFraction, 0.5);
});

test("connected-stroke renderer survives settings and tab sanitization", () => {
  assert.equal(state.sanitizeSettings({ defaultRenderer: "strokes" }).defaultRenderer, "strokes");
  assert.equal(state.sanitizeTabState({ renderer: "strokes" }).renderer, "strokes");
});

test("text-input and chat-editor veiling defaults on but remains configurable", () => {
  assert.equal(state.DEFAULT_SETTINGS.veilTextInputs, true);
  assert.equal(state.sanitizeSettings({ veilTextInputs: false }).veilTextInputs, false);
  assert.equal(
    state.resolveEffectiveState({ veilTextInputs: true }, {}, "https://example.com").veilTextInputs,
    true
  );
});
