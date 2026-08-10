"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const gregg = require("../browser-extension/shared/gregg.js");

test("phonetic normalization is deterministic and uses connected-sound tokens", () => {
  assert.deepEqual(gregg.phoneticTokens("knight"), ["n", "i", "t"]);
  assert.deepEqual(gregg.phoneticTokens("phone"), ["f", "o", "n"]);
  assert.deepEqual(gregg.phoneticTokens("action"), ["a", "k", "S", "u", "n"]);
  assert.deepEqual(gregg.phoneticTokens("can't"), ["k", "a", "n", "t"]);
});

test("Gregg outlines are bounded SVG path data with joined endpoints", () => {
  const outline = gregg.outlineWord("library");
  assert.ok(outline);
  assert.match(outline.viewBox, /^0 -?\d/);
  assert.ok(outline.width > 20);
  assert.ok(outline.paths.length >= 4);
  let priorEnd = null;
  for (const segment of outline.paths) {
    assert.match(segment.d, /^M[\d.-]+ [\d.-]+ C/);
    assert.ok(segment.width >= 1);
    assert.doesNotMatch(segment.d, /(?:NaN|Infinity|[<>])/);
    const coordinates = segment.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const start = coordinates.slice(0, 2);
    const end = coordinates.slice(-2);
    if (priorEnd) assert.deepEqual(start, priorEnd);
    priorEnd = end;
  }
});

test("non-word input does not produce an outline", () => {
  assert.equal(gregg.outlineWord("..."), null);
});
