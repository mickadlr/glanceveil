# GlanceVeil for Obsidian

This plugin veils rendered note text with the same script packs used by the
GlanceVeil browser extension. It never writes transformed text to Markdown
files.

## Local installation

1. From the repository root, run `npm ci` and `npm run package:obsidian`.
2. Create `.obsidian/plugins/glanceveil` inside a test vault.
3. Copy `main.js`, `manifest.json`, and `styles.css` from `dist/obsidian` into
   that plugin directory.
4. Reload Obsidian, open **Settings → Community plugins**, and enable
   **GlanceVeil**.

The plugin starts with Greek Dense and Unicode rendering. Its settings control
the script, profile, renderer, visible-word fraction, typography, editor
coverage, and reading-view coverage.

Commands are available for toggling the veil, cycling scripts, and peeking
selected reading-view text. Selected editor text and the word containing the
caret reveal automatically.

## Mobile

GlanceVeil uses the Obsidian ribbon for its one-tap toggle on desktop and mobile.
The status-bar control remains desktop-only because Obsidian does not provide a
status bar on mobile.

To use the plugin on a phone or tablet, sync the complete
`.obsidian/plugins/glanceveil` directory with the vault, including `main.js`,
`manifest.json`, and `styles.css`. Then restart Obsidian mobile and enable
GlanceVeil under **Settings → Community plugins**. The plugin has no Node.js,
Electron, or network dependency at runtime.

## Scope

The plugin covers Markdown editor and reading views. It does not currently veil
file names, search results, backlinks, properties, Canvas, browser chrome, or
arbitrary interfaces created by other plugins. It has no network behavior and
does not modify vault files.

GlanceVeil is for personal, non-commercial use only. If it is useful to you,
[supporting its maintenance on Ko-fi](https://ko-fi.com/mickadlr) is optional
and does not unlock features or grant additional rights.
