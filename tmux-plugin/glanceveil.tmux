#!/bin/sh
set -eu

plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  tmux display-message "GlanceVeil requires Node.js"
  exit 1
fi

config_file=$(tmux show-options -gqv @glanceveil-config-file)
if [ -z "$config_file" ]; then
  config_file=$(node "$plugin_dir/bin/glanceveil-setup" --config-path)
fi
if [ -f "$config_file" ]; then
  tmux source-file "$config_file"
fi

key=$(tmux show-options -gqv @glanceveil-key)
if [ -z "$key" ]; then key=K; fi
setup_key=$(tmux show-options -gqv @glanceveil-setup-key)
if [ -z "$setup_key" ]; then setup_key=C-k; fi

open_command="'$(printf '%s' "$plugin_dir/bin/open-view" | sed "s/'/'\\\\''/g")' '#{pane_id}' '#{session_id}'"
quoted_config_file="'$(printf '%s' "$config_file" | sed "s/'/'\\\\''/g")'"
setup_command="'$(printf '%s' "$plugin_dir/bin/open-setup" | sed "s/'/'\\\\''/g")' '#{client_name}' $quoted_config_file"
configured=$(tmux show-options -gqv @glanceveil-configured)
manual_pack=$(tmux show-options -gqv @glanceveil-pack)

if [ "$configured" = "1" ] || [ -n "$manual_pack" ]; then
  tmux bind-key -N "GlanceVeil: open interactive veil" "$key" run-shell "$open_command"
else
  tmux bind-key -N "GlanceVeil: first-run setup" "$key" run-shell "$setup_command"
fi

existing_setup_binding=$(tmux list-keys -T prefix "$setup_key" 2>/dev/null || true)
if [ -z "$existing_setup_binding" ] ||
    printf '%s' "$existing_setup_binding" | grep -Fq "$plugin_dir/bin/open-setup"; then
  tmux bind-key -N "GlanceVeil: settings" "$setup_key" run-shell "$setup_command"
fi
