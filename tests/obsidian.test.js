"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pluginRoot = path.join(root, "obsidian-plugin");

test("Obsidian manifest is mobile-compatible and references a semantic version", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "glanceveil");
  assert.equal(manifest.name, "GlanceVeil");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.isDesktopOnly, false);
  assert.ok(manifest.minAppVersion);
});

test("Obsidian distribution metadata has one canonical copy at repository root", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
  assert.equal(fs.existsSync(path.join(pluginRoot, "manifest.json")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "versions.json")), false);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
});

test("distribution declares restrictive source-available licensing and security reporting", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.equal(packageJson.license, "SEE LICENSE IN LICENSE");
  assert.match(license, /PROPRIETARY LICENSE/);
  assert.match(license, /personal, non-commercial use/);
  assert.match(license, /no permission is granted to copy/);
  assert.match(readme, /not open source/);
  assert.equal(fs.existsSync(path.join(root, "SECURITY.md")), true);
});

test("Obsidian package script produces only the expected public release assets", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageScript = fs.readFileSync(
    path.join(root, "scripts", "package-obsidian.mjs"),
    "utf8"
  );
  assert.match(packageJson.scripts["package:obsidian"], /package-obsidian\.mjs/);
  assert.match(packageScript, /main\.js/);
  assert.match(packageScript, /manifest\.json/);
  assert.match(packageScript, /styles\.css/);
  assert.doesNotMatch(packageScript, /data\.json/);
});

test("Obsidian adapters consume the canonical browser-shared veil engine", () => {
  const files = ["editor-renderer.ts", "reading-renderer.ts"];
  for (const file of files) {
    const source = fs.readFileSync(path.join(pluginRoot, "src", file), "utf8");
    assert.match(source, /browser-extension\/shared\/core/);
    assert.doesNotMatch(source, /vault\.(?:modify|process|create|delete|trash)/);
  }
});

test("Obsidian exposes a mobile control without relying on the desktop status bar", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "src", "main.ts"), "utf8");
  assert.match(source, /addRibbonIcon\(/);
  assert.match(source, /if \(!Platform\.isMobile\)/);
});

test("Obsidian runtime source has no desktop-only module dependency", () => {
  const sourcePaths = fs.readdirSync(path.join(pluginRoot, "src"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => path.join(pluginRoot, "src", file));
  sourcePaths.push(path.join(root, "browser-extension", "shared", "core.js"));

  for (const sourcePath of sourcePaths) {
    const source = fs.readFileSync(sourcePath, "utf8");
    assert.doesNotMatch(source, /(?:from|require\()\s*["'](?:electron|node:|fs|path|os)/);
    assert.doesNotMatch(source, /\(\?<[-=!]/, "mobile runtime must avoid regex lookbehind");
    assert.doesNotMatch(source, /\bprocess\.platform\b/);
    assert.doesNotMatch(source, /\bFileSystemAdapter\b/);
    assert.doesNotMatch(source, /\b(?:fetch|axios\.get)\s*\(/);
  }
});

test("the shared core exposes a platform-neutral range plan", () => {
  const core = require("../browser-extension/shared/core.js");
  const spans = core.planVeil("private note", core.getPack("greek"), "dense");
  assert.deepEqual(spans.map(({ from, to }) => [from, to]), [[0, 7], [8, 12]]);
});
