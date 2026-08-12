# GlanceVeil release checklist

Do not publish an Obsidian release until every automated check passes and the
manual device matrix has been completed for the release candidate.

## Automated gate

Run from the repository root:

```bash
npm ci
npm run check
npm test
npm run test:extension
npm run package:release
```

Confirm that `dist/chrome` contains a versioned ZIP and matching SHA-256 file,
that the ZIP opens with `manifest.json` at its root, and that no source maps,
tests, development dependencies, or unbundled content-script sources are
present.

Confirm that `dist/obsidian` contains exactly:

```text
main.js
manifest.json
styles.css
```

The release must not contain `data.json`, a vault directory, source maps,
development dependencies, or personal files. The GitHub tag must match the
version in `manifest.json` exactly.

Confirm that `dist/tmux` contains a versioned `.tar.gz` and matching SHA-256
file. Extract it in a temporary directory and confirm that `glanceveil.tmux` and
every file under `tmux-plugin/bin` retain executable permissions.

## Chrome Web Store material

- [ ] `store/chrome/listing.md` matches the release's actual behavior
- [ ] `store/chrome/privacy-fields.md` matches `PRIVACY.md` and dashboard fields
- [ ] Privacy policy URL is publicly accessible before submission
- [ ] Small promotional image is exactly 440×280 PNG
- [ ] Every screenshot is exactly 1280×800 or 640×400 PNG
- [ ] Screenshots use only synthetic content and show current product behavior
- [ ] Permission and `<all_urls>` justifications are pasted without omissions
- [ ] The uploaded ZIP hash matches the locally approved candidate

## Manual Obsidian matrix

Use synthetic notes containing headings, paragraphs, links, inline code, code
blocks, frontmatter, lists, punctuation, long lines, and at least one long note.
Record the Obsidian version, operating-system version, and device model.

### Desktop

- [ ] Clean installation in a disposable vault
- [ ] Live Preview renders and reveals the word at the caret
- [ ] Source mode renders and reveals selected text
- [ ] Reading view renders and the peek command works
- [ ] Ribbon toggle works
- [ ] Desktop status control works
- [ ] Greek Unicode is the fresh-install default
- [ ] Script, profile, renderer, and typography settings persist after restart
- [ ] Long-note scrolling and typing remain responsive
- [ ] A before-and-after hash confirms the Markdown file is unchanged

### Android

- [ ] Clean installation on a physical Android device
- [ ] Live Preview, source mode, and Reading view render
- [ ] Mobile ribbon toggle works
- [ ] Typing, selection, and caret reveal work with the software keyboard
- [ ] Settings persist after fully closing and reopening Obsidian
- [ ] Long-note scrolling and typing remain responsive
- [ ] The underlying Markdown remains unchanged

### iPhone or iPad

- [ ] Clean installation on a physical iOS or iPadOS device
- [ ] Live Preview, source mode, and Reading view render
- [ ] Mobile ribbon toggle works
- [ ] Typing, selection, and caret reveal work with the software keyboard
- [ ] Settings persist after fully closing and reopening Obsidian
- [ ] Long-note scrolling and typing remain responsive
- [ ] The underlying Markdown remains unchanged

## Privacy and licensing gate

- [ ] README states that GlanceVeil is visual obscurity, not encryption
- [ ] README discloses no telemetry, network use, or Markdown writes
- [ ] `LICENSE` identifies GlanceVeil as proprietary source-available software
- [ ] `LICENSE` permits unmodified official browser, Obsidian, and tmux releases
- [ ] `PRIVACY.md` accurately covers local text handling and stored settings
- [ ] Release notes do not imply that the project is open source
- [ ] Bug reports and screenshots contain only synthetic content
