"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const Core = require("../browser-extension/shared/core.js");
const {
  createTerminalTransformer,
  resolveTerminalOptions,
  transformTerminalText,
  truncateToColumns
} = require("../tmux-plugin/lib/terminal.js");

const projectRoot = path.resolve(__dirname, "..");
const filterPath = path.join(projectRoot, "tmux-plugin/bin/kalima-filter");
const pluginPath = path.join(projectRoot, "tmux-plugin/kalima.tmux");
const openViewPath = path.join(projectRoot, "tmux-plugin/bin/open-view");
const setupPath = path.join(projectRoot, "tmux-plugin/bin/kalima-setup");

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runTmux(socket, arguments_, options = {}) {
  const { cleanConfig = false, ...spawnOptions } = options;
  const globalArguments = cleanConfig ? ["-f", "/dev/null"] : [];
  return spawnSync("tmux", ["-L", socket, ...globalArguments, ...arguments_], {
    cwd: projectRoot,
    encoding: "utf8",
    ...spawnOptions
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("tmux transformer uses the canonical Greek transform", () => {
  const source = "Meet me at the library";
  const expected = Core.transform(source, Core.getPack("greek"), "dense");
  assert.equal(transformTerminalText(source), expected);
});

test("tmux transformer preserves ANSI control sequences exactly", () => {
  const source = "\u001b[31mmeet\u001b[0m \u001b]0;terminal title\u0007library";
  const rendered = transformTerminalText(source);
  assert.match(rendered, /^\u001b\[31m/);
  assert.ok(rendered.includes("\u001b[0m"));
  assert.ok(rendered.includes("\u001b]0;terminal title\u0007"));
  assert.equal(
    rendered,
    `\u001b[31m${transformTerminalText("meet")}\u001b[0m ` +
      `\u001b]0;terminal title\u0007${transformTerminalText("library")}`
  );
});

test("tmux supports only packs with a Unicode renderer", () => {
  assert.equal(resolveTerminalOptions({ packId: "cyrillic" }).packId, "cyrillic");
  assert.throws(
    () => resolveTerminalOptions({ packId: "arabic" }),
    /requires a visual overlay and is not terminal-safe/
  );
  assert.throws(
    () => resolveTerminalOptions({ profileId: "missing" }),
    /Unknown Greek profile/
  );
});

test("tmux refresh settings are bounded and transformed lines fit the view", () => {
  assert.equal(resolveTerminalOptions({ refreshMs: 1 }).refreshMs, 100);
  assert.equal(resolveTerminalOptions({ refreshMs: 99999 }).refreshMs, 5000);
  assert.equal(truncateToColumns("abcdef", 4), "abcd");
  assert.equal(truncateToColumns("カタカナ", 5), "カタ");
  assert.equal(
    truncateToColumns("\u001b[31mabcdef\u001b[0m", 4),
    "\u001b[31mabcd\u001b[0m"
  );
});

test("kalima-filter transforms stdin and keeps ANSI intact", () => {
  const result = spawnSync(
    process.execPath,
    [filterPath, "--pack", "greek", "--profile", "dense"],
    { cwd: projectRoot, encoding: "utf8", input: "\u001b[1mhello\u001b[0m\n" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `\u001b[1m${createTerminalTransformer().transform("hello")}\u001b[0m\n`
  );
});

test("tmux plugin files are executable", () => {
  for (const file of [filterPath, pluginPath, openViewPath, setupPath]) {
    assert.ok(fs.statSync(file).mode & 0o111, `${file} should be executable`);
  }
});

const tmuxAvailable = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0;

test("tmux setup writes bounded persistent settings and preserves a backup", () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "kalima-setup-test-"));
  const configPath = path.join(temporaryDirectory, "tmux.conf");
  try {
    let result = spawnSync(
      process.execPath,
      [
        setupPath,
        "--config", configPath,
        "--write",
        "--no-apply",
        "--pack", "cyrillic",
        "--profile", "fluent",
        "--clear-words", "0.2",
        "--refresh-ms", "400"
      ],
      { cwd: projectRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    let settings = fs.readFileSync(configPath, "utf8");
    assert.match(settings, /^# Kalima tmux settings v1/);
    assert.match(settings, /@kalima-pack cyrillic/);
    assert.match(settings, /@kalima-profile fluent/);
    assert.match(settings, /@kalima-clear-words 0.2/);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);

    result = spawnSync(
      process.execPath,
      [
        setupPath,
        "--config", configPath,
        "--write",
        "--no-apply",
        "--profile", "dense"
      ],
      { cwd: projectRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    settings = fs.readFileSync(configPath, "utf8");
    assert.match(settings, /@kalima-profile dense/);
    assert.match(fs.readFileSync(`${configPath}.bak`, "utf8"), /@kalima-profile fluent/);

    result = spawnSync(
      process.execPath,
      [
        setupPath,
        "--config", configPath,
        "--write",
        "--no-apply",
        "--pack", "arabic"
      ],
      { cwd: projectRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not terminal-safe/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("tmux plugin routes first use to setup and loads saved settings", {
  skip: tmuxAvailable ? false : "tmux is not installed"
}, () => {
  const socket = `kalima-first-run-${process.pid}-${Date.now()}`;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "kalima-first-run-"));
  const configPath = path.join(temporaryDirectory, "tmux.conf");
  try {
    let result = runTmux(socket, [
      "new-session", "-d", "-s", "first-run", "-x", "80", "-y", "24", "sleep 30"
    ], { cleanConfig: true });
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, [
      "set-environment", "-g", "KALIMA_TMUX_CONFIG", configPath
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, ["run-shell", shellQuote(pluginPath)]);
    assert.equal(result.status, 0, result.stderr);
    let binding = runTmux(socket, ["list-keys", "-T", "prefix", "K"]);
    assert.equal(binding.status, 0, binding.stderr);
    assert.match(binding.stdout, /open-setup/);

    result = spawnSync(
      process.execPath,
      [
        setupPath,
        "--config", configPath,
        "--write",
        "--no-apply",
        "--pack", "greek",
        "--profile", "familiar",
        "--clear-words", "0.1"
      ],
      { cwd: projectRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, ["run-shell", shellQuote(pluginPath)]);
    assert.equal(result.status, 0, result.stderr);
    binding = runTmux(socket, ["list-keys", "-T", "prefix", "K"]);
    assert.equal(binding.status, 0, binding.stderr);
    assert.match(binding.stdout, /open-view/);
    assert.equal(
      runTmux(socket, ["show-options", "-gqv", "@kalima-profile"]).stdout.trim(),
      "familiar"
    );
    assert.equal(
      runTmux(socket, ["show-options", "-gqv", "@kalima-clear-words"]).stdout.trim(),
      "0.1"
    );
  } finally {
    runTmux(socket, ["kill-server"]);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("tmux plugin opens, interacts with, and closes an isolated veiled window", {
  skip: tmuxAvailable ? false : "tmux is not installed"
}, async () => {
  const socket = `kalima-test-${process.pid}-${Date.now()}`;
  const sessionName = "kalima-test";
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "kalima-view-test-"));
  const configPath = path.join(temporaryDirectory, "tmux.conf");
  try {
    let setup = spawnSync(
      process.execPath,
      [
        setupPath,
        "--config", configPath,
        "--write",
        "--no-apply",
        "--pack", "greek",
        "--profile", "dense"
      ],
      { cwd: projectRoot, encoding: "utf8" }
    );
    assert.equal(setup.status, 0, setup.stderr);
    let result = runTmux(socket, [
      "new-session", "-d", "-s", sessionName, "-x", "80", "-y", "24",
      "printf '\\033[?1h\\033[?1000h\\033[?1006hmeet me at the library\\n'; " +
        "while IFS= read -r line; do printf 'received:%s\\n' \"$line\"; done"
    ], { cleanConfig: true });
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, [
      "set-environment", "-g", "KALIMA_TMUX_CONFIG", configPath
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = runTmux(socket, ["run-shell", shellQuote(pluginPath)]);
    assert.equal(result.status, 0, result.stderr);
    const binding = runTmux(socket, ["list-keys", "-T", "prefix", "K"]);
    assert.equal(binding.status, 0, binding.stderr);
    assert.match(binding.stdout, /open-view/);

    const sourcePane = runTmux(socket, [
      "display-message", "-p", "-t", `${sessionName}:0.0`, "#{pane_id}"
    ]).stdout.trim();
    const sessionId = runTmux(socket, [
      "display-message", "-p", "-t", sessionName, "#{session_id}"
    ]).stdout.trim();
    const launch = `${shellQuote(openViewPath)} ${shellQuote(sourcePane)} ${shellQuote(sessionId)}`;
    result = runTmux(socket, ["run-shell", launch]);
    assert.equal(result.status, 0, result.stderr);

    await delay(600);
    const windows = runTmux(socket, [
      "list-windows", "-t", sessionName, "-F", "#{window_name}:#{window_id}"
    ]);
    assert.equal(windows.status, 0, windows.stderr);
    const kalimaWindow = windows.stdout
      .trim()
      .split("\n")
      .find((line) => line.startsWith("Kaλima:"));
    assert.ok(kalimaWindow, windows.stdout);

    const windowId = kalimaWindow.slice(kalimaWindow.indexOf(":") + 1);
    const view = runTmux(socket, ["capture-pane", "-p", "-t", windowId]);
    assert.equal(view.status, 0, view.stderr);
    assert.ok(
      view.stdout.includes(transformTerminalText("meet me at the library")),
      view.stdout
    );
    const mirroredModes = runTmux(socket, [
      "display-message", "-p", "-t", windowId,
      "#{keypad_cursor_flag}:#{mouse_standard_flag}:#{mouse_sgr_flag}"
    ]);
    assert.equal(mirroredModes.status, 0, mirroredModes.stderr);
    assert.equal(mirroredModes.stdout.trim(), "1:1:1");

    result = runTmux(socket, ["send-keys", "-t", windowId, "-l", "discard"]);
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, ["send-keys", "-t", windowId, "Escape", "Up", "C-u"]);
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, ["send-keys", "-t", windowId, "-l", "hello α"]);
    assert.equal(result.status, 0, result.stderr);
    result = runTmux(socket, ["send-keys", "-t", windowId, "Enter"]);
    assert.equal(result.status, 0, result.stderr);
    await delay(600);
    const interactedSource = runTmux(socket, ["capture-pane", "-p", "-t", sourcePane]);
    assert.equal(interactedSource.status, 0, interactedSource.stderr);
    assert.match(interactedSource.stdout, /received:hello α/);
    assert.doesNotMatch(interactedSource.stdout, /received:discard/);
    const interactedView = runTmux(socket, ["capture-pane", "-p", "-t", windowId]);
    assert.equal(interactedView.status, 0, interactedView.stderr);
    assert.ok(
      interactedView.stdout.includes(transformTerminalText("received:hello α")),
      interactedView.stdout
    );

    result = runTmux(socket, [
      "send-keys", "-H", "-t", windowId,
      "07", "07"
    ]);
    assert.equal(result.status, 0, result.stderr);
    await delay(250);
    const remaining = runTmux(socket, [
      "list-windows", "-t", sessionName, "-F", "#{window_name}"
    ]);
    assert.equal(remaining.status, 0, remaining.stderr);
    assert.doesNotMatch(remaining.stdout, /Kaλima/);
  } finally {
    runTmux(socket, ["kill-server"]);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
