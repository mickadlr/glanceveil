import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./lib/release-archive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "browser-extension/manifest.json"), "utf8"));
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (manifest.version !== packageMetadata.version) {
  throw new Error(`Chrome version ${manifest.version} does not match package version ${packageMetadata.version}.`);
}

const runtimeFiles = [
  "manifest.json",
  "background.js",
  "content-bundle.js",
  "content.css",
  "google-docs-bundle.js",
  "options.css",
  "options.html",
  "options.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "assets/icon16.png",
  "assets/icon32.png",
  "assets/icon48.png",
  "assets/icon128.png",
  "assets/glanceveil-mark.svg",
  "assets/glanceveil-wordmark.svg",
  "shared/core.js",
  "shared/state.js"
];

export async function buildChromeArchive() {
  const entries = await Promise.all(runtimeFiles.map(async (relativePath) => ({
    path: relativePath,
    data: await readFile(path.join(root, "browser-extension", relativePath)),
    mode: 0o100644
  })));
  entries.push(
    { path: "LICENSE", data: await readFile(path.join(root, "LICENSE")), mode: 0o100644 },
    { path: "PRIVACY.md", data: await readFile(path.join(root, "PRIVACY.md")), mode: 0o100644 }
  );
  return createZip(entries);
}

async function main() {
  const archive = await buildChromeArchive();
  const secondBuild = await buildChromeArchive();
  if (!archive.equals(secondBuild)) throw new Error("Chrome archive generation is not deterministic.");
  if (process.argv.includes("--verify")) return;

  const outputDirectory = path.join(root, "dist", "chrome");
  const archiveName = `glanceveil-chrome-${manifest.version}.zip`;
  const archivePath = path.join(outputDirectory, archiveName);
  const temporaryPath = `${archivePath}.${process.pid}.tmp`;
  const checksum = createHash("sha256").update(archive).digest("hex");
  await mkdir(outputDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, archive, { mode: 0o644 });
    await rename(temporaryPath, archivePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  await writeFile(`${archivePath}.sha256`, `${checksum}  ${archiveName}\n`, { mode: 0o644 });
  console.log(`Packaged GlanceVeil ${manifest.version} for Chrome: ${archivePath}`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) await main();
