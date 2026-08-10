import { context } from "esbuild";
import process from "node:process";

const production = process.argv.includes("--production");
const build = await context({
  entryPoints: ["obsidian-plugin/src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/language",
    "@codemirror/state",
    "@codemirror/view"
  ],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "obsidian-plugin/main.js",
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2020",
  treeShaking: true
});

if (production) {
  await build.rebuild();
  await build.dispose();
} else {
  await build.watch();
}
