"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

function zipEntryNames(archive) {
  const names = [];
  for (let offset = 0; offset + 46 <= archive.length;) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function tarEntries(compressed) {
  const archive = gunzipSync(compressed);
  const entries = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const mode = Number.parseInt(
      header.subarray(100, 108).toString("ascii").replace(/\0.*$/, "").trim(),
      8
    );
    const size = Number.parseInt(
      header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(),
      8
    );
    entries.push({ name, mode, size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function pngDimensions(file) {
  const image = fs.readFileSync(file);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

test("Chrome release archive is deterministic and contains only release files", async () => {
  const { buildChromeArchive } = await import("../scripts/package-chrome.mjs");
  const first = await buildChromeArchive();
  const second = await buildChromeArchive();
  assert.deepEqual(first, second);
  assert.deepEqual(zipEntryNames(first), [
    "assets/glanceveil-mark.svg",
    "assets/glanceveil-wordmark.svg",
    "assets/icon128.png",
    "assets/icon16.png",
    "assets/icon32.png",
    "assets/icon48.png",
    "background.js",
    "content-bundle.js",
    "content.css",
    "google-docs-bundle.js",
    "LICENSE",
    "manifest.json",
    "options.css",
    "options.html",
    "options.js",
    "popup.css",
    "popup.html",
    "popup.js",
    "PRIVACY.md",
    "shared/core.js",
    "shared/state.js"
  ]);
});

test("tmux release archive is deterministic, standalone, and executable", async () => {
  const { buildTmuxArchive } = await import("../scripts/package-tmux.mjs");
  const first = await buildTmuxArchive();
  const second = await buildTmuxArchive();
  assert.deepEqual(first, second);
  const entries = tarEntries(first);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.some((name) => name.endsWith("/glanceveil.tmux")));
  assert.ok(names.some((name) => name.endsWith("/browser-extension/shared/core.js")));
  assert.ok(names.some((name) => name.endsWith("/SUPPORT.md")));
  for (const entry of entries.filter((candidate) =>
    candidate.name.endsWith(".tmux") || candidate.name.includes("/bin/"))) {
    assert.equal(entry.mode, 0o755, entry.name);
  }
  assert.ok(entries.every((entry) => entry.size > 0));
});

test("store submission copy and correctly sized artwork are present", () => {
  const store = path.join(root, "store", "chrome");
  const listing = fs.readFileSync(path.join(store, "listing.md"), "utf8");
  const privacyFields = fs.readFileSync(path.join(store, "privacy-fields.md"), "utf8");
  assert.match(listing, /visual obscurity, not encryption/i);
  assert.match(listing, /makes no background network\s+requests/i);
  assert.match(privacyFields, /Single purpose/);
  assert.match(privacyFields, /<all_urls>/);
  assert.match(privacyFields, /Limited Use requirements/);
  assert.deepEqual(
    pngDimensions(path.join(store, "assets", "promo-small-440x280.png")),
    [440, 280]
  );
  for (const file of [
    "screenshot-01-page-and-controls-1280x800.png",
    "screenshot-02-setup-1280x800.png"
  ]) {
    assert.deepEqual(pngDimensions(path.join(store, "assets", file)), [1280, 800]);
  }
});

test("privacy and license cover every shipped integration without weakening restrictions", () => {
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  const privacy = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");
  assert.match(license, /browser, Obsidian installation,\s+or tmux-compatible/);
  assert.match(license, /tmux integration only/);
  assert.match(license, /does not grant permission to modify/);
  assert.match(license, /personal, non-commercial use/);
  for (const surface of ["browser extension", "Obsidian plugin", "tmux integration"]) {
    assert.match(privacy, new RegExp(surface, "i"));
  }
  assert.match(privacy, /does\s+not collect, transmit, sell, share/);
  assert.match(privacy, /Limited Use requirements/);
});

test("support is voluntary, user-activated, and grants no commercial rights", () => {
  const supportUrl = "https://ko-fi.com/mickadlr";
  const support = fs.readFileSync(path.join(root, "SUPPORT.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const popup = fs.readFileSync(path.join(root, "browser-extension", "popup.html"), "utf8");
  const options = fs.readFileSync(path.join(root, "browser-extension", "options.html"), "utf8");
  const obsidianManifest = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
  const tmux = fs.readFileSync(path.join(root, "tmux-plugin", "README.md"), "utf8");
  const privacy = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");
  const funding = fs.readFileSync(path.join(root, ".github", "FUNDING.yml"), "utf8");
  const escapedSupportUrl = supportUrl.replace(/[./]/g, "\\$&");

  for (const surface of [support, readme, popup, options, obsidianManifest, tmux, funding]) {
    assert.match(surface, new RegExp(escapedSupportUrl));
  }
  assert.match(support, /Support is voluntary/);
  assert.match(support, /does not unlock features/);
  assert.match(support, /commercial[\s\S]+use is prohibited/i);
  assert.match(privacy, /only after\s+the user activates the link/);
  assert.match(privacy, /does not send page text, note text, browsing\s+activity, settings/);
});
