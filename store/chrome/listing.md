# GlanceVeil Chrome Web Store listing

## Product details

**Name:** GlanceVeil

**Summary:** A familiar-script veil for casual visual privacy while browsing.

**Category:** Productivity

**Language:** English

**Homepage:** https://github.com/mickadlr/glanceveil

**Support:** https://github.com/mickadlr/glanceveil/issues

**Privacy policy:** https://github.com/mickadlr/glanceveil/blob/main/PRIVACY.md

## Detailed description

GlanceVeil makes webpage text harder for someone nearby to read at a glance while
keeping the page usable for you.

Choose Greek-looking, Cyrillic, Hebrew-glyph, Arabic-glyph, Katakana,
Hiragana, or experimental connected-stroke rendering. Adjust the reading
strength, leave a controlled fraction of words visible, and save rules for
individual sites. Hold Alt or Option for a momentary localized peek, or use the
toolbar button and keyboard shortcut to toggle the current tab.

GlanceVeil works locally. It does not send page text, form content, browsing data,
settings, or telemetry to the developer or to any external service. Supported
text fields and chat composers use a visual mirror so their submitted value
remains unchanged. Password fields are never processed.

Google Docs uses a dedicated best-effort canvas adapter. A document may need to
be reloaded after installation or after changing its script. Pages that use
images, video, PDFs, closed shadow roots, or unusual canvas rendering may remain
clear.

GlanceVeil is visual obscurity, not encryption. It cannot prevent copying,
screenshots, DOM inspection, accessibility access, other extensions, or a
determined observer from recovering text.

Key features:

- Fast Greek Unicode rendering by default
- Multiple familiar-script styles and reading strengths
- Global, per-site, and temporary per-tab activation
- Localized hold-to-peek and selected-text peek
- Non-mutating visual treatment for supported text inputs
- Local-only settings with no account, ads, analytics, or background network service
- Dedicated Google Docs document-canvas support
- Clear compatibility diagnostics and complete reset

## Reviewer notes

GlanceVeil's single purpose is to change the local visual presentation of webpage
text for casual shoulder-surfing resistance. The broad site match is necessary
because users may apply that same purpose to arbitrary webpages.

Suggested review path:

1. Install the extension and complete the local setup page.
2. Open a text-heavy webpage and confirm Greek Unicode text appears.
3. Open the toolbar popup to change Script, Strength, or Rendering.
4. Select page text and use **Peek selected text**, or hold Alt/Option over a
   paragraph.
5. Type two words in a supported ordinary text field. The completed word is
   visually veiled while the underlying input value remains unchanged.
6. Open a Google Docs document and reload once if its status requests it.

The package contains no remotely hosted code and makes no background network
requests. Its optional support link opens Ko-fi only after a user clicks it.
