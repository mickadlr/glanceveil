import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "dist", "obsidian");
const sourceBundle = path.join(root, "obsidian-plugin", "main.js");
const sourceManifest = path.join(root, "manifest.json");
const sourceStyles = path.join(root, "obsidian-plugin", "styles.css");

const manifest = JSON.parse(await readFile(sourceManifest, "utf8"));
if (manifest.id !== "glanceveil") {
  throw new Error(`Expected manifest id "glanceveil", received ${JSON.stringify(manifest.id)}`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
  throw new Error(`Invalid release version ${JSON.stringify(manifest.version)}`);
}
if (manifest.isDesktopOnly !== false) {
  throw new Error("The Obsidian release manifest must remain mobile-compatible.");
}

const bundle = await readFile(sourceBundle, "utf8");
if (bundle.includes("sourceMappingURL=")) {
  throw new Error("Refusing to package a development bundle with an inline source map.");
}
if (/require\(["'](?:electron|node:|fs|path|os)["']\)/.test(bundle)) {
  throw new Error("Refusing to package a bundle with a desktop-only runtime dependency.");
}

const bundleStats = await stat(sourceBundle);
if (!bundleStats.isFile() || bundleStats.size === 0) {
  throw new Error("The Obsidian production bundle is missing or empty.");
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  copyFile(sourceBundle, path.join(outputDirectory, "main.js")),
  copyFile(sourceManifest, path.join(outputDirectory, "manifest.json")),
  copyFile(sourceStyles, path.join(outputDirectory, "styles.css"))
]);

const packagedFiles = (await readdir(outputDirectory)).sort();
const expectedFiles = ["main.js", "manifest.json", "styles.css"];
if (JSON.stringify(packagedFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected Obsidian package contents: ${packagedFiles.join(", ")}`);
}

console.log(`Packaged GlanceVeil ${manifest.version} for Obsidian in dist/obsidian`);
