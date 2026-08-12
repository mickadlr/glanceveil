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

function loadBackground(initialStorage = {}, tabUrl = "https://web.whatsapp.com/") {
  const localStorage = structuredClone(initialStorage);
  let installedListener = null;
  let messageListener = null;
  let storageChangedListener = null;
  let optionsOpenCount = 0;
  const appliedStates = [];
  const pageContextRequests = [];

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
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      },
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
      onChanged: {
        addListener(listener) {
          storageChangedListener = listener;
        }
      }
    },
    tabs: {
      onRemoved: inertEvent,
      async query() {
        return [{ id: 17 }];
      },
      async get(tabId) {
        return { id: tabId };
      },
      async sendMessage(tabId, message, options) {
        if (message.type === "gv-get-page-context") {
          pageContextRequests.push({ tabId, options });
          return { url: tabUrl };
        }
        if (message.type === "gv-apply-state") {
          appliedStates.push(message.payload);
          return undefined;
        }
        return undefined;
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
    message(message, sender = {}) {
      assert.ok(messageListener, "runtime message listener was registered");
      return new Promise((resolve) => {
        messageListener(message, sender, resolve);
      }).then((response) => {
        assert.equal(response.ok, true, response.error);
        return response.value;
      });
    },
    settingsChanged() {
      assert.ok(storageChangedListener, "storage change listener was registered");
      storageChangedListener({ [State.SETTINGS_KEY]: { newValue: localStorage[State.SETTINGS_KEY] } }, "local");
    },
    localStorage,
    appliedStates,
    pageContextRequests,
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

test("popup state uses the top-frame page URL when tabs.get omits url", async () => {
  const extension = loadBackground({
    [State.SETTINGS_KEY]: State.sanitizeSettings({ enabled: true, onboardingComplete: true })
  });

  const state = await extension.message({ type: "gv-get-state", tabId: 17 });

  assert.equal(state.effective.supported, true);
  assert.equal(state.effective.enabled, true);
  assert.equal(state.effective.origin, "https://web.whatsapp.com");
  assert.equal(extension.pageContextRequests.length, 1);
  assert.equal(extension.pageContextRequests[0].tabId, 17);
  assert.equal(extension.pageContextRequests[0].options.frameId, 0);
});

test("settings broadcasts never overwrite a supported page with an empty-url state", async () => {
  const extension = loadBackground({
    [State.SETTINGS_KEY]: State.sanitizeSettings({ enabled: true, onboardingComplete: true })
  });

  extension.settingsChanged();
  await settleInstall();

  assert.equal(extension.appliedStates.length, 1);
  assert.equal(extension.appliedStates[0].effective.supported, true);
  assert.equal(extension.appliedStates[0].effective.enabled, true);
  assert.equal(extension.appliedStates[0].effective.origin, "https://web.whatsapp.com");
});
