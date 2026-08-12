"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const Core = require("../browser-extension/shared/core.js");
const adapterSource = fs.readFileSync(
  path.resolve(__dirname, "../browser-extension/google-docs-main.js"),
  "utf8"
);

const STATE_CHANNEL = "glanceveil-google-docs-state-v1";
const STATUS_CHANNEL = "glanceveil-google-docs-status-v1";

function createHarness({
  hostname = "docs.google.com",
  pathname = "/document/d/example/edit"
} = {}) {
  class FakeCanvas {
    constructor(classes = []) {
      this.classList = {
        contains: (name) => classes.includes(name)
      };
    }
  }

  class FakeContext {
    constructor(canvas) {
      this.canvas = canvas;
      this.calls = [];
      this.measureCalls = [];
      this.direction = "inherit";
      this.letterSpacing = "0px";
      this.stack = [];
    }

    fillText(text, x, y, maxWidth) {
      this.calls.push({
        method: "fillText",
        text,
        x,
        y,
        maxWidth,
        direction: this.direction,
        letterSpacing: this.letterSpacing
      });
    }

    strokeText(text, x, y, maxWidth) {
      this.calls.push({
        method: "strokeText",
        text,
        x,
        y,
        maxWidth,
        direction: this.direction,
        letterSpacing: this.letterSpacing
      });
    }

    measureText(text) {
      this.measureCalls.push(String(text));
      return { width: String(text).length * 10 };
    }

    save() {
      this.stack.push({
        direction: this.direction,
        letterSpacing: this.letterSpacing
      });
    }

    restore() {
      const prior = this.stack.pop();
      if (prior) Object.assign(this, prior);
    }
  }

  const listeners = new Map();
  const posted = [];
  const timers = new Map();
  let nextTimerId = 1;
  const window = {
    addEventListener(type, listener) {
      const group = listeners.get(type) || [];
      group.push(listener);
      listeners.set(type, group);
    },
    postMessage(data, targetOrigin) {
      posted.push({ data, targetOrigin });
    }
  };
  window.top = window;

  const nativeFillText = FakeContext.prototype.fillText;
  const context = {
    GreekVeilCore: Core,
    CanvasRenderingContext2D: FakeContext,
    HTMLCanvasElement: FakeCanvas,
    location: {
      hostname,
      pathname,
      origin: `https://${hostname}`
    },
    window,
    queueMicrotask,
    setTimeout(callback) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  vm.runInNewContext(adapterSource, context, { filename: "google-docs-main.js" });

  function sendState(patch = {}) {
    const pack = patch.pack || Core.getPack(patch.packId || "greek");
    const state = {
      enabled: true,
      renderer: "unicode",
      packId: pack.id,
      pack,
      profileId: pack.defaultProfile,
      sensitiveMode: "off",
      sensitivePackId: "",
      sensitivePack: null,
      clearWordFraction: 0,
      sessionVariation: false,
      sessionSeed: 1234,
      letterSpacing: 0,
      ...patch
    };
    for (const listener of listeners.get("message") || []) {
      listener({
        source: window,
        data: { channel: STATE_CHANNEL, state }
      });
    }
  }

  return {
    Canvas: FakeCanvas,
    Context: FakeContext,
    context,
    nativeFillText,
    posted,
    sendState,
    runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    }
  };
}

function latestStatus(harness) {
  return harness.posted
    .filter((entry) => entry.data?.channel === STATUS_CHANNEL)
    .at(-1)?.data.status;
}

async function flushStatus() {
  await new Promise((resolve) => queueMicrotask(resolve));
}

test("adapter installs only on Google Docs document pages", () => {
  const elsewhere = createHarness({
    hostname: "example.com",
    pathname: "/document/d/example/edit"
  });
  assert.equal(elsewhere.Context.prototype.fillText, elsewhere.nativeFillText);
  assert.equal(elsewhere.context.__glanceveilGoogleDocsAdapterInstalled, undefined);

  const docsHome = createHarness({
    hostname: "docs.google.com",
    pathname: "/spreadsheets/d/example/edit"
  });
  assert.equal(docsHome.Context.prototype.fillText, docsHome.nativeFillText);
  assert.equal(docsHome.context.__glanceveilGoogleDocsAdapterInstalled, undefined);
});

test("adapter transforms only the Docs document canvas and preserves measurement", async () => {
  const harness = createHarness();
  harness.sendState({ letterSpacing: 0.5 });

  const docsContext = new harness.Context(
    new harness.Canvas(["kix-canvas-tile-content"])
  );
  const arbitraryContext = new harness.Context(new harness.Canvas(["chart"]));
  const source = "Bubble notes";

  const measured = docsContext.measureText(source);
  docsContext.fillText(source, 20, 30);
  arbitraryContext.fillText(source, 20, 30);
  await flushStatus();

  assert.equal(measured.width, source.length * 10);
  assert.equal(source, "Bubble notes");
  assert.match(docsContext.calls[0].text, /[\u0370-\u03ff]/iu);
  assert.ok(docsContext.calls[0].maxWidth <= measured.width);
  assert.equal(docsContext.calls[0].direction, "ltr");
  assert.equal(docsContext.calls[0].letterSpacing, "0.5px");
  assert.equal(arbitraryContext.calls[0].text, source);
  assert.deepEqual({ ...latestStatus(harness) }, {
    patched: true,
    detected: true,
    supported: true,
    targetDrawCalls: 1,
    transformedDrawCalls: 1,
    drawsBeforeState: 0,
    queuedDrawCalls: 0,
    replayedDrawCalls: 0,
    droppedQueuedDrawCalls: 0,
    queueTimedOut: false,
    reloadRequired: false,
    renderer: "unicode",
    packId: "greek"
  });
});

test("adapter preserves Arabic glyph order without changing the source string", () => {
  const harness = createHarness();
  const arabic = Core.getPack("arabic");
  harness.sendState({
    packId: arabic.id,
    pack: arabic,
    profileId: arabic.defaultProfile
  });
  const context = new harness.Context(
    new harness.Canvas(["kix-canvas-tile-content"])
  );
  const source = "Secret plan";

  context.fillText(source, 4, 8);

  assert.equal(source, "Secret plan");
  assert.match(context.calls[0].text, /^\u202d.*[\u0600-\u06ff].*\u202c$/u);
});

test("initial Docs draws wait for state and replay through the renderer", async () => {
  const harness = createHarness();
  const context = new harness.Context(
    new harness.Canvas(["kix-canvas-tile-content"])
  );

  context.fillText("Already painted", 1, 2);
  assert.equal(context.calls.length, 0);
  harness.sendState();
  await flushStatus();
  assert.match(context.calls.at(-1).text, /[\u0370-\u03ff]/iu);
  assert.equal(latestStatus(harness).drawsBeforeState, 1);
  assert.equal(latestStatus(harness).queuedDrawCalls, 1);
  assert.equal(latestStatus(harness).replayedDrawCalls, 1);
  assert.equal(latestStatus(harness).reloadRequired, false);
});

test("a missing state bridge times out to clear text instead of a blank canvas", async () => {
  const harness = createHarness();
  const context = new harness.Context(
    new harness.Canvas(["kix-canvas-tile-content"])
  );

  context.fillText("Never leave this blank", 1, 2);
  harness.runTimers();
  await flushStatus();
  assert.equal(context.calls.at(-1).text, "Never leave this blank");
  assert.equal(latestStatus(harness).queueTimedOut, true);
  assert.equal(latestStatus(harness).reloadRequired, true);

  harness.sendState();
  context.fillText("Still clear", 1, 2);
  assert.equal(context.calls.at(-1).text, "Still clear");
});

test("setting changes freeze the current canvas renderer until reload", async () => {
  const harness = createHarness();
  const context = new harness.Context(
    new harness.Canvas(["kix-canvas-tile-content"])
  );
  harness.sendState();
  context.fillText("Greek first", 1, 2);

  const arabic = Core.getPack("arabic");
  harness.sendState({
    renderer: "overlay",
    packId: arabic.id,
    pack: arabic,
    profileId: arabic.defaultProfile
  });
  context.fillText("Same renderer", 1, 2);
  await flushStatus();

  assert.match(context.calls.at(-1).text, /[\u0370-\u03ff]/iu);
  assert.doesNotMatch(context.calls.at(-1).text, /[\u0600-\u06ff]/u);
  assert.equal(latestStatus(harness).packId, "greek");
  assert.equal(latestStatus(harness).reloadRequired, true);
});

test("connected strokes fail clear on the Docs canvas", async () => {
  const harness = createHarness();
  const context = new harness.Context(
    new harness.Canvas(["kix-canvas-tile-content"])
  );
  const gregg = Core.getPack("gregg-simplified");
  harness.sendState({
    renderer: "strokes",
    packId: gregg.id,
    pack: gregg,
    profileId: gregg.defaultProfile
  });

  context.strokeText("No canvas strokes", 1, 2);
  await flushStatus();
  assert.equal(context.calls.at(-1).text, "No canvas strokes");
  assert.equal(latestStatus(harness).supported, false);
});
