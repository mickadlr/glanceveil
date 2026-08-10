"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "../browser-extension");

for (const [relativePath, globalName] of [
  ["shared/core.js", "GreekVeilCore"],
  ["shared/state.js", "GreekVeilState"],
  ["shared/gregg.js", "GreekVeilGregg"]
]) {
  test(`${relativePath} binds its browser global even when module exists`, () => {
    const source = fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
    const sandbox = { module: { exports: {} }, URL };

    vm.runInNewContext(source, sandbox, { filename: relativePath });

    assert.ok(sandbox[globalName]);
    assert.equal(sandbox[globalName], sandbox.module.exports);
  });
}

test("content startup fails clear once when required globals are unavailable", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "content.js"), "utf8");
  const errors = [];

  assert.doesNotThrow(() => {
    vm.runInNewContext(source, {
      console: {
        error(message) {
          errors.push(message);
        }
      }
    }, { filename: "content.js" });
  });

  assert.deepEqual(errors, [
    "[Kalima] The shared runtime did not initialize. " +
    "The page was left unchanged; reload Kalima and then reload this tab."
  ]);
});
