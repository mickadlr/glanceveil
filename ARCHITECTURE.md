# GlanceVeil architecture

## Product invariant

GlanceVeil changes what a person sees. It must not change what the person types
or submits. Its threat model is casual visual observation, not recovery by a
determined party with access to the browser, DOM, accessibility tree, clipboard,
screenshots, or extension storage.

## Runtime components

- `browser-extension/shared/core.js` is the canonical cross-platform
  transformation engine. Its range-based `planVeil()` API supplies identical
  word boundaries, rendered strings, clear-word decisions, and sensitive-range
  metadata to Chrome and Obsidian. It also owns the versioned pack contract,
  built-in packs, validation, renderer capability selection, and deterministic
  transformation.
- `browser-extension/shared/gregg.js` is the other cross-platform module. It
  owns the independently implemented phonetic normalizer and connected
  vector-stroke grammar used by the experimental Gregg pack.
- `browser-extension/shared/state.js` remains browser-specific and owns
  settings migration, URL normalization, scope precedence, and effective-state
  resolution.
- `background.js` is the central coordinator for local settings and tab-session
  state. It resolves effective state and sends only configuration—not page
  content—between extension contexts.
- `content.js` owns DOM eligibility, rendering, dynamic mutations, restoration,
  localized peek behavior, and content-free diagnostics.
- `popup.js` provides fast current-tab and current-site controls.
- `options.js` owns durable defaults, saved-rule management, custom pack
  validation, export, and reset.
- `obsidian-plugin/src/editor-renderer.ts` converts shared veil plans into
  CodeMirror decorations over visible ranges. Markdown code, frontmatter,
  URLs, link destinations, and the active selection/caret word are excluded.
- `obsidian-plugin/src/reading-renderer.ts` converts the same plans into
  disposable Reading-view spans. A render child restores its own wrappers when
  settings change or the view unloads.
- `obsidian-plugin/src/main.ts` owns per-vault settings, commands, status, and
  registration of the two Obsidian render surfaces. It never calls a vault
  write API.
- `tmux-plugin/lib/terminal.js` adapts the shared Unicode transformer to plain
  terminal text, preserves ANSI control sequences for filter use, and supplies
  terminal-width clipping.
- `tmux-plugin/bin/glanceveil-view` captures the visible content of one source pane
  into a separate temporary tmux window. It refreshes the transformed view and
  relays raw keyboard bytes to the source with `tmux send-keys -H`, without
  rewriting the source pane or changing its scrollback. Source cursor-key,
  keypad, and mouse flags are mirrored onto the viewer so tmux encodes input
  for full-screen applications consistently.
- `tmux-plugin/bin/glanceveil-setup` owns first-run and repeat configuration. It
  atomically writes a bounded, data-only tmux config beneath the user's config
  directory, backs up the prior generated file, and applies it to the current
  server. An unrecognized existing file is never overwritten.

The shared files remain inside `browser-extension/shared` intentionally: the
unpacked MV3 extension must package content-script dependencies beneath its own
root. The Obsidian build imports and bundles those exact source files, so there
is no copied pack table or transformation implementation to drift.

The browser command ID, DOM/data prefixes, CSS custom properties, and shared
UMD globals retain their original `greek-veil` or `GreekVeil` identifiers.
They are compatibility contracts, not display names; keeping them stable
preserves shortcuts, settings, and page cleanup behavior across the GlanceVeil
rebrand. Public package names, the Obsidian plugin ID, and tmux commands use the
`glanceveil` identifier because those distribution identities were not yet
published when the final name was selected.

## State precedence

The effective value is resolved in this order:

1. Global defaults
2. Matching normalized site rule
3. Current-tab override

Temporary localized peeks never change the saved configuration.

Tab state is stored in `chrome.storage.session` when available and removed when
the tab closes. Durable preferences use `chrome.storage.local`.

## Rendering strategies

### Visual overlay

Eligible text nodes are split into small wrapping spans. The spans retain the
original text but render a transformed `::after` layer while the source glyphs
are transparent. This preserves `textContent`, native search, copying, and
accessibility source. A forced left-to-right bidi override prevents Hebrew and
Arabic-script substitution glyphs from reordering their English source.

The tradeoff is structural: wrapping can upset pages that depend on exact child
nodes. Disabling or changing configuration unwraps connected groups back into
text nodes. Removed groups are discarded from tracking so long-lived SPAs do
not retain detached subtrees.

### Unicode text

Eligible text-node values are replaced with transformed Unicode. Weak maps hold
the last page-authored value and last rendered value. Restoration occurs only
when the node still contains the extension's own rendered value, so a later
page-authored update wins. The transform is not inverted because mappings can
be many-to-one or length-changing.

### Connected strokes

The built-in Gregg Simplified pack splits eligible text into word-sized overlay
spans and draws an inline, accessibility-hidden SVG over each veiled word. The
source word remains the span's text, preserving copying, search, and the
accessibility source. Clear-word anchors omit the SVG and display the complete
source word.

`shared/gregg.js` first reduces English spelling into a small sound-oriented
token stream, then joins deterministic curve segments at shared endpoints.
Voiced tokens use heavier strokes. This is an approximation layer with no
bundled textbook dictionary, fonts, scans, or copied outlines; verified
word-level rules can be added later without changing the content renderer.

### English-to-kana

Katakana and Hiragana packs use the fixed `english-kana` engine instead of
mapping isolated Latin letters. The engine first checks a bounded local table
for common established loanword spellings. Unknown words pass through
deterministic English spelling-to-sound rules, consonant-cluster handling, and
Japanese consonant–vowel shaping. Katakana output is converted codepoint by
codepoint for the Hiragana pack; the prolonged sound mark is retained.

This intentionally remains a heuristic. It runs entirely in the extension and
does not send page words to a pronunciation service.

## Eligibility and dynamic content

The content runtime excludes scripts, styles, code, preformatted content, form
controls, editable regions, SVG, MathML, and canvas from ordinary text-node
rendering. A `MutationObserver` handles added nodes and page-authored character
changes. Mutation records that arrive while a renderer is restoring are replayed
after that restoration so same-task page updates are not lost. Extension-owned
overlay/UI subtrees are marked and skipped.

Initial traversal and mutation-local walks discover ordinary open Shadow DOM.
The uncommon case where a page attaches a shadow root to an already-connected
host without another observable DOM mutation is covered by a 30-second audit.
That audit advances through at most 300 elements per idle slice; there is no
recurring whole-document element or input-control scan.

When `veilTextInputs` is enabled (the default), text-like `input` elements,
`textarea` elements, and supported contenteditable chat composers use a
separate fixed-position visual mirror. The real form value and editable DOM are
never rewritten. Words followed by whitespace are transformed; the word
containing the caret remains clear for editing. Position, typography, and input
scrolling are synchronized locally. Composition events temporarily remove the
mirror so an IME remains usable. Password and non-text input types are never
eligible.

The content script starts early so it can preload effective state, but it does
not write to the page DOM until `DOMContentLoaded`. This avoids interfering
with parser-owned structures such as render-blocking `link rel="expect"`
markers.

Open Shadow DOM can be traversed only when encountered through accessible DOM.
Closed Shadow DOM, images, video, arbitrary canvas, PDF viewers, and browser UI
are unsupported surfaces and must never be represented as protected.

Google Docs is the sole canvas exception. A `document_start`, main-world
adapter wraps `CanvasRenderingContext2D.fillText` and `strokeText`, but acts
only when the canvas has Docs' `kix-canvas-tile-content` class. It transforms
the string passed to a document-canvas draw while leaving `measureText`, the
Docs model, event targets, and all non-Docs canvases unchanged. Transformed
draws are constrained to the source width to avoid crossing layout boundaries.
The isolated content runtime sends validated, data-only pack state over a
versioned same-window channel and receives counters only; no document text is
sent back or stored. Connected strokes fail clear. Because an existing canvas
cannot be safely restored and Docs may not repaint it, the adapter queues
initial text draws for up to 750 milliseconds while local state arrives,
capturing the drawing context required for replay. A missing bridge times out
to clear source text instead of leaving the document blank. State changes after
paint are reported as reload-required and the active paint state is frozen
instead of mixing settings silently.

## Packs

A pack declares:

- schema version, stable ID, name, script, and maturity
- supported and default renderers (`overlay`, `unicode`, or the fixed
  `strokes` engine)
- default and named profiles
- character mappings and/or longest-match token rules
- an optional fixed built-in engine identifier and inert engine metadata
- sample and descriptive metadata

Custom packs pass the same validator as built-ins and remain data-only.
Built-in IDs cannot be shadowed. Complexity and serialized-size limits bound
runtime work and storage. A custom pack can opt into the fixed
`gregg-simplified` engine, but cannot supply executable rendering code.

## Clear-word anchors

`clearWordFraction` is resolved through the same global, site, and tab
precedence as appearance settings and is bounded to 0–0.5. The default is zero.
Eligible word occurrences are selected with a page-session-seeded,
low-discrepancy cadence so the requested fraction is distributed across text
nodes without adjacent clear words at supported values.

One-letter words and common sensitive-looking patterns such as email addresses,
URLs, currency values, and long numeric identifiers are not eligible. This is
best-effort leak reduction, not sensitive-data classification. Overlay mode
still wraps a clear word and renders its unchanged source through the visual
layer; Unicode mode leaves the selected source range untouched.

## Testing strategy

- `tests/core.test.js` covers bundled/custom pack validation, legacy Greek
  compatibility, token precedence, renderer safety, and complexity limits.
- `tests/gregg.test.js` covers phonetic normalization and bounded,
  deterministic SVG path output.
- `tests/state.test.js` covers migration, precedence, legacy-field cleanup,
  restricted URLs, and adaptive-setting bounds.
- `tests/tmux.test.js` covers shared-core parity, ANSI preservation,
  terminal-only renderer rejection, column fitting, the CLI filter, and an
  isolated tmux-server first-run, persistence, and interaction
  lifecycle—including UTF-8, Escape, arrow, and control-key forwarding—when
  tmux is installed.
- `tests/extension-smoke.mjs` replays the renderer in branded Chrome, or loads
  the full unpacked extension when given Chromium/Chrome for Testing. It
  measures eligible-text coverage and verifies synthetic open-Shadow-DOM,
  ChatGPT, Lexical, ProseMirror, IME, large-chat, and SPA route fixtures through
  DevTools. It also checks renderer transitions, bounded overlay-group cleanup,
  and the absence of recurring audit work during ordinary activity. The
  coverage gate specifically protects against structural DOM traversal skipping
  nodes while overlay wrappers are inserted.

Failure diagnostics should use fixture IDs, counts, versions, and state
transitions. They must not contain real browsed page text.
