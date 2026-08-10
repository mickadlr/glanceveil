"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../browser-extension/shared/core.js");
const State = require("../browser-extension/shared/state.js");

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, "../browser-extension/background.js"),
  "utf8"
);

function loadBackground(initialStorage = {}) {
  const localStorage = structuredClone(initialStorage);
  let installedListener = null;
  let optionsOpenCount = 0;

  const inertEvent = { addListener() {} };
  const chrome = {
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    },
    commands: { onCommand: inertEvent },
    runtime: {
      onInstalled: {
        addListener(listener) {
          installedListener = listener;
        }
      },
      onMessage: inertEvent,
      onStartup: inertEvent,
      async openOptionsPage() {
        optionsOpenCount += 1;
      }
    },
    storage: {
      local: {
        async get() {
          return structuredClone(localStorage);
        },
        async set(patch) {
          Object.assign(localStorage, structuredClone(patch));
        }
      },
      session: {
        async get() {
          return {};
        },
        async set() {}
      },
      onChanged: inertEvent
    },
    tabs: {
      onRemoved: inertEvent,
      async query() {
        return [];
      }
    }
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    console,
    GreekVeilCore: Core,
    GreekVeilState: State,
    importScripts() {},
    URL
  }, { filename: "background.js" });

  return {
    install(details) {
      assert.ok(installedListener, "onInstalled listener was registered");
      installedListener(details);
    },
    localStorage,
    get optionsOpenCount() {
      return optionsOpenCount;
    }
  };
}

async function settleInstall() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("a genuinely fresh install persists defaults and opens setup", async () => {
  const extension = loadBackground();

  extension.install({ reason: "install" });
  await settleInstall();

  assert.equal(extension.optionsOpenCount, 1);
  assert.equal(extension.localStorage[State.SETTINGS_KEY].onboardingComplete, false);
  assert.equal(extension.localStorage[State.SETTINGS_KEY].defaultPackId, "greek");
  assert.equal(extension.localStorage[State.SETTINGS_KEY].defaultRenderer, "unicode");
});

test("install handling does not interrupt an existing user", async () => {
  const extension = loadBackground({
    [State.SETTINGS_KEY]: State.sanitizeSettings({ onboardingComplete: true })
  });

  extension.install({ reason: "install" });
  await settleInstall();

  assert.equal(extension.optionsOpenCount, 0);
  assert.equal(extension.localStorage[State.SETTINGS_KEY].onboardingComplete, true);
});

test("updates never open first-run setup", async () => {
  const extension = loadBackground();

  extension.install({ reason: "update" });
  await settleInstall();

  assert.equal(extension.optionsOpenCount, 0);
});
