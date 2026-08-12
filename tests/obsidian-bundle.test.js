"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bundlePath = path.resolve(__dirname, "../obsidian-plugin/main.js");

async function loadPlugin({ isMobile }) {
  const registrations = {
    commands: [],
    editorExtensions: [],
    postProcessors: [],
    ribbons: [],
    statusBars: [],
    settingTabs: []
  };
  const control = {
    addClass() {},
    setAttribute() {},
    setText() {},
    toggleClass() {}
  };

  class Plugin {
    constructor() {
      this.app = { workspace: { updateOptions() {} } };
    }
    async loadData() { return null; }
    async saveData() {}
    registerEditorExtension(extension) { registrations.editorExtensions.push(extension); }
    registerMarkdownPostProcessor(processor) { registrations.postProcessors.push(processor); }
    addCommand(command) { registrations.commands.push(command); }
    addSettingTab(tab) { registrations.settingTabs.push(tab); }
    addRibbonIcon(icon, title, callback) {
      registrations.ribbons.push({ icon, title, callback });
      return control;
    }
    addStatusBarItem() {
      registrations.statusBars.push(control);
      return control;
    }
    register() {}
    registerDomEvent() {}
  }
  class MarkdownRenderChild {
    constructor(containerEl) { this.containerEl = containerEl; }
  }
  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = {};
    }
  }
  class Setting {}
  class Notice {}

  const module = { exports: {} };
  const source = fs.readFileSync(bundlePath, "utf8");
  assert.match(source, /id:"arabic"/);
  assert.match(source, /name:"Arabic glyphs"/);
  assert.doesNotMatch(source, /https:\/\/ko-fi\.com\/mickadlr/);
  vm.runInNewContext(source, {
    console,
    globalThis: {},
    Math,
    module,
    exports: module.exports,
    require(id) {
      if (id === "obsidian") {
        return {
          MarkdownRenderChild,
          Notice,
          Platform: { isMobile },
          Plugin,
          PluginSettingTab,
          Setting
        };
      }
      return require(id);
    }
  }, { filename: bundlePath });

  const GlanceVeilPlugin = module.exports.default;
  const plugin = new GlanceVeilPlugin();
  await plugin.onload();
  return { plugin, registrations };
}

test("built Obsidian plugin clean-loads its mobile surfaces and commands", async () => {
  const { plugin, registrations } = await loadPlugin({ isMobile: true });

  assert.equal(plugin.settings.packId, "greek");
  assert.equal(plugin.settings.profileId, "dense");
  assert.equal(plugin.settings.renderer, "unicode");
  assert.equal(registrations.editorExtensions.length, 1);
  assert.equal(registrations.postProcessors.length, 1);
  assert.equal(registrations.ribbons.length, 1);
  assert.equal(registrations.ribbons[0].icon, "eye-off");
  assert.equal(registrations.statusBars.length, 0);
  assert.equal(registrations.settingTabs.length, 1);
  assert.deepEqual(
    Array.from(registrations.commands, (command) => command.id),
    ["toggle-veil", "cycle-script", "peek-selected-text"]
  );
});

test("built Obsidian plugin clean-loads its desktop status control", async () => {
  const { registrations } = await loadPlugin({ isMobile: false });
  assert.equal(registrations.ribbons.length, 1);
  assert.equal(registrations.statusBars.length, 1);
});
