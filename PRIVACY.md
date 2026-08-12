# GlanceVeil privacy policy

Effective: 12 August 2026

GlanceVeil is a local visual-obscurity tool for webpages, Obsidian notes, and tmux
panes. It does not operate a network service, include advertising or analytics,
or send user data to the developer or any third party.

## Data GlanceVeil processes

GlanceVeil processes text locally only to produce its visible veil:

- The browser extension reads eligible text displayed by webpages. If input
  veiling is enabled, it also reads the current local value of supported text
  controls to draw a visual mirror. Its Google Docs adapter processes document
  text passed to the page's canvas drawing functions.
- The Obsidian plugin processes rendered note text and editor ranges. It does
  not write transformed text to Markdown files.
- The tmux integration captures the selected pane's visible screen in memory
  and forwards keyboard bytes to that pane while its interactive view is open.

This processing can involve website content, user-generated content, personal
communications, and form data. It happens on the user's device. GlanceVeil does
not collect, transmit, sell, share, or permit the developer or another person
to read that content. Password controls are excluded.

## Data stored locally

The browser extension stores preferences, custom declarative script packs, and
site rules in `chrome.storage.local`. A site rule contains an origin, such as
`https://example.com`, and the user's chosen behavior for that origin. Temporary
tab overrides are kept in `chrome.storage.session` when the browser provides
it. Page text, transformed text, complete visited URLs, browsing history, and
usage telemetry are not stored.

The Obsidian plugin stores only its settings through Obsidian's plugin-data
API. The tmux setup wizard stores only GlanceVeil options in the user's selected
configuration file, normally `~/.config/glanceveil/tmux.conf`, and may retain one
local backup when settings are changed.

These records remain on the user's device until the user resets GlanceVeil, removes
the relevant files, or the host platform removes them. Platform backup or sync
features configured by the user may copy local settings under that platform's
own terms; GlanceVeil does not initiate such copying.

## Network access and sharing

GlanceVeil makes no background network requests and has no developer-operated
backend. It does not share data with the developer, advertisers, analytics
providers, data brokers, or other third parties.

The browser popup, browser settings page, and Obsidian settings contain an
optional link to GlanceVeil's Ko-fi support page. GlanceVeil opens that page only after
the user activates the link. It does not send page text, note text, browsing
activity, settings, or other GlanceVeil data to Ko-fi. The resulting webpage is
governed by Ko-fi's own privacy practices. Website scripts, other extensions,
Obsidian, tmux, the operating system, and synchronization services also remain
outside GlanceVeil's control and are governed by their own privacy practices.

GlanceVeil's use of information received from Google APIs will adhere to the Chrome
Web Store User Data Policy, including the Limited Use requirements.

## User controls

Browser users can disable GlanceVeil globally or for a tab or site, remove saved
site rules, export or reset settings, and disable input veiling. Obsidian users
can disable either editor or Reading-view coverage and can remove the plugin's
local data. tmux users can close the interactive view and delete its dedicated
configuration file.

## Security and reports

GlanceVeil is visual obscurity, not encryption. Its threat model and limitations
are documented in the project README. Report a privacy or security issue using
the private process in [SECURITY.md](SECURITY.md); do not include private page,
note, form, or terminal content in a public report.

## Changes

Material changes to this policy will be dated here and reflected in the
extension's disclosures before a release using the changed practices is
published.
