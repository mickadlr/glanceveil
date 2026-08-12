import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTarGzip } from "./lib/release-archive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const archiveRoot = `glanceveil-tmux-${packageMetadata.version}`;

const releaseFiles = [
  ["glanceveil.tmux", "glanceveil.tmux", 0o100755],
  ["tmux-plugin/README.md", "README.md", 0o100644],
  ["SUPPORT.md", "SUPPORT.md", 0o100644],
  ["LICENSE", "LICENSE", 0o100644],
  ["PRIVACY.md", "PRIVACY.md", 0o100644],
  ["tmux-plugin/glanceveil.tmux", "tmux-plugin/glanceveil.tmux", 0o100755],
  ["tmux-plugin/bin/glanceveil-filter", "tmux-plugin/bin/glanceveil-filter", 0o100755],
  ["tmux-plugin/bin/glanceveil-setup", "tmux-plugin/bin/glanceveil-setup", 0o100755],
  ["tmux-plugin/bin/glanceveil-view", "tmux-plugin/bin/glanceveil-view", 0o100755],
  ["tmux-plugin/bin/open-setup", "tmux-plugin/bin/open-setup", 0o100755],
  ["tmux-plugin/bin/open-view", "tmux-plugin/bin/open-view", 0o100755],
  ["tmux-plugin/lib/terminal.js", "tmux-plugin/lib/terminal.js", 0o100644],
  ["browser-extension/shared/core.js", "browser-extension/shared/core.js", 0o100644]
];

export async function buildTmuxArchive() {
  const entries = await Promise.all(releaseFiles.map(async ([source, target, mode]) => ({
    path: `${archiveRoot}/${target}`,
    data: await readFile(path.join(root, source)),
    mode
  })));
  return createTarGzip(entries);
}

async function main() {
  const archive = await buildTmuxArchive();
  const secondBuild = await buildTmuxArchive();
  if (!archive.equals(secondBuild)) throw new Error("tmux archive generation is not deterministic.");
  if (process.argv.includes("--verify")) return;

  const outputDirectory = path.join(root, "dist", "tmux");
  const archiveName = `${archiveRoot}.tar.gz`;
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
  console.log(`Packaged GlanceVeil ${packageMetadata.version} for tmux: ${archivePath}`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) await main();
