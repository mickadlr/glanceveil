"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extensionRoot = path.resolve(__dirname, "../browser-extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));

test("manifest references only existing local runtime files", () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])])
  ];
  for (const relativePath of referenced) {
    assert.equal(fs.existsSync(path.join(extensionRoot, relativePath)), true, relativePath);
    assert.doesNotMatch(relativePath, /^https?:/);
  }
});

test("extension presents the Kalima identity and a complete local icon set", () => {
  assert.equal(manifest.name, "Kalima");
  assert.equal(manifest.action.default_title, "Kalima");
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);

  const popup = fs.readFileSync(path.join(extensionRoot, "popup.html"), "utf8");
  const options = fs.readFileSync(path.join(extensionRoot, "options.html"), "utf8");
  assert.match(popup, /aria-label="Kalima">Ka<span aria-hidden="true">λ<\/span>ima/);
  assert.match(options, /aria-label="Kalima">Ka<span aria-hidden="true">λ<\/span>ima/);
  assert.match(options, /id="onboarding"/);
  assert.match(options, /Only sites I explicitly enable/);
  assert.doesNotMatch(options, /Reduce visual transitions/);
});

test("extension pages use external local scripts under the default MV3 CSP", () => {
  for (const name of ["popup.html", "options.html"]) {
    const html = fs.readFileSync(path.join(extensionRoot, name), "utf8");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, name);
    assert.doesNotMatch(html, /https?:\/\//i, name);
  }
});

test("declared permissions stay within the reviewed minimum", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["storage"]);
  assert.equal(manifest.manifest_version, 3);
  const ordinaryContent = manifest.content_scripts.find(
    (entry) => entry.matches.includes("<all_urls>")
  );
  assert.ok(ordinaryContent);
  assert.equal(ordinaryContent.all_frames, true);
});

test("Google Docs uses a narrowly scoped main-world canvas adapter", () => {
  const docsContent = manifest.content_scripts.find((entry) => entry.world === "MAIN");
  assert.ok(docsContent);
  assert.deepEqual(docsContent.matches, ["https://docs.google.com/document/*"]);
  assert.deepEqual(docsContent.js, ["google-docs-bundle.js"]);
  assert.equal(docsContent.run_at, "document_start");
  assert.equal(docsContent.all_frames, undefined);
});

test("content dependencies are shipped in atomic generated bundles", () => {
  const ordinaryContent = manifest.content_scripts.find(
    (entry) => entry.matches.includes("<all_urls>")
  );
  const contentBundle = fs.readFileSync(
    path.join(extensionRoot, ordinaryContent.js[0]),
    "utf8"
  );
  const docsContent = manifest.content_scripts.find((entry) => entry.world === "MAIN");
  const docsBundle = fs.readFileSync(path.join(extensionRoot, docsContent.js[0]), "utf8");

  assert.deepEqual(ordinaryContent.js, ["content-bundle.js"]);
  assert.match(contentBundle, /Source: browser-extension\/shared\/core\.js/);
  assert.match(contentBundle, /Source: browser-extension\/shared\/state\.js/);
  assert.match(contentBundle, /Source: browser-extension\/shared\/gregg\.js/);
  assert.match(contentBundle, /Source: browser-extension\/content\.js/);
  assert.match(docsBundle, /Source: browser-extension\/shared\/core\.js/);
  assert.match(docsBundle, /Source: browser-extension\/google-docs-main\.js/);
});

test("content runtime avoids recurring whole-document polling", () => {
  const content = fs.readFileSync(path.join(extensionRoot, "content.js"), "utf8");
  assert.doesNotMatch(content, /\bsetInterval\s*\(/);
  assert.match(content, /SHADOW_AUDIT_INTERVAL_MS = 30_000/);
  assert.match(content, /requestIdleCallback/);
  assert.match(content, /SHADOW_AUDIT_SLICE_SIZE/);
});

test("fresh installs open the local calibration flow", () => {
  const background = fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8");
  const options = fs.readFileSync(path.join(extensionRoot, "options.html"), "utf8");
  const optionsScript = fs.readFileSync(path.join(extensionRoot, "options.js"), "utf8");
  const optionsStyles = fs.readFileSync(path.join(extensionRoot, "options.css"), "utf8");
  assert.match(background, /details\.reason === "install"/);
  assert.match(background, /chrome\.runtime\.openOptionsPage\(\)/);
  assert.match(background, /typeof stored\.enabled === "boolean"/);
  assert.match(options, /id="onboardingSample"[^>]*tabindex="0"/);
  assert.match(options, /Start using Kalima/);
  assert.match(optionsScript, /onboardingComplete: true/);
  assert.match(optionsScript, /document\.body\.classList\.toggle\("setup-active", visible\)/);
  assert.match(optionsScript, /revealOnboardingSample/);
  assert.match(optionsScript, /item\.renderers\.includes\(renderer\)/);
  assert.match(optionsScript, /className = "sample-overlay-part"/);
  assert.match(optionsStyles, /\.setup-active main > section:not\(\.onboarding\)/);
  assert.match(optionsStyles, /\.sample-overlay-part::after/);
  assert.match(optionsStyles, /unicode-bidi: isolate-override/);
});

test("appearance changes activate the tab and Google Docs mutations repaint", () => {
  const background = fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8");
  const popup = fs.readFileSync(path.join(extensionRoot, "popup.js"), "utf8");
  assert.match(background, /case "gv-set-tab-preferences":[\s\S]*enabled: true/);
  assert.match(background, /isGoogleDocsDocument\(url\)[\s\S]*chrome\.tabs\.reload\(tab\.id\)/);
  assert.match(popup, /Google Docs reloads after appearance changes/);
});
