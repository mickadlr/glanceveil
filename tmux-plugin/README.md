# Kalima for tmux

Kalima for tmux opens a live, interactive Unicode view of the current pane. The
source pane keeps running in its original window. Keyboard input—including
text, Enter, Escape, arrows, function keys, and control shortcuts—is forwarded
as its original bytes, while the refreshed display is veiled. Application
cursor, keypad, and mouse modes are mirrored for full-screen terminal tools.
Press `Ctrl-G` twice to close the view and return to the original pane.

tmux cannot place a visual DOM-style overlay over a pane. Rewriting an
interactive PTY stream would also break cursor positioning when a mapping
changes display width. Kalima therefore captures only the pane's visible
screen into memory, renders it in a temporary window, and relays keyboard bytes
back to the original PTY through tmux. Nothing is written to disk or sent over
the network. A single `Ctrl-G` is forwarded after a short chord timeout, so
applications that use it remain available.

## Install

Kalima for tmux requires tmux 3.2 or newer and Node.js 18 or newer.

With [Tmux Plugin Manager](https://github.com/tmux-plugins/tpm), add this before
the TPM initialization line in `.tmux.conf`:

```tmux
set -g @plugin 'mickadlr/kalima'
```

Press prefix followed by `I` to install it. To use a direct checkout instead,
add the repository's root loader to `.tmux.conf`:

```tmux
run-shell "/absolute/path/to/kalima/kalima.tmux"
```

Reload the file:

```sh
tmux source-file ~/.tmux.conf
```

On the first press of prefix followed by `K`, Kalima opens a local setup wizard.
Choose the script, reading strength, clear-word percentage, and refresh rate.
The wizard saves those choices to `~/.config/kalima/tmux.conf` and applies them
immediately. Press prefix followed by `K` again to open the interactive veil.

## Settings

Press prefix followed by `Ctrl-k` to reopen the setup wizard. The shortcut is
installed only when that key is not already bound. You can always launch the
same wizard directly:

```sh
./tmux-plugin/bin/kalima-setup
```

The wizard keeps its previous file as `tmux.conf.bak` when saving a change. To
manage settings yourself instead, put options before the `run-shell` line:

```tmux
set -g @kalima-key K
set -g @kalima-setup-key C-k
set -g @kalima-pack greek
set -g @kalima-profile dense
set -g @kalima-clear-words 0
set -g @kalima-refresh-ms 250
set -g @kalima-variation-seed 0
```

Manually specifying `@kalima-pack` counts as completed setup. Set
`@kalima-config-file` before `run-shell` to load the generated settings from a
different location.

Terminal-safe packs are `greek`, `cyrillic`, `katakana`, and `hiragana`.
Hebrew, Arabic, and Gregg remain unavailable because their safe renderers
require browser or Obsidian visual layers.

The included filter can also transform piped output while retaining ANSI
control sequences:

```sh
printf 'meet me at the library\n' | ./tmux-plugin/bin/kalima-filter
```
