"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../browser-extension/shared/core.js");

test("all bundled packs validate", () => {
  for (const pack of core.BUILTIN_PACKS) {
    assert.deepEqual(core.validatePack(pack), { valid: true, errors: [] }, pack.id);
    if (pack.renderers.includes("unicode")) {
      assert.equal(pack.defaultRenderer, "unicode", `${pack.id} should prefer Unicode`);
      assert.equal(pack.renderers[0], "unicode", `${pack.id} should list Unicode first`);
    }
  }
});

test("legacy Greek familiar output remains compatible", () => {
  const pack = core.getPack("greek");
  assert.equal(pack.defaultProfile, "dense");
  assert.equal(pack.defaultRenderer, "unicode");
  assert.equal(pack.renderers[0], "unicode");
  assert.equal(core.transform("meet me at the library", pack, "familiar"), "μεετ με ατ τηε λιμπραρυ");
  assert.equal(core.transform("BJ", pack, "familiar"), "ΜΠΤΖ");
});

test("token profiles use longest matching token", () => {
  const greek = core.getPack("greek");
  assert.equal(core.transform("three", greek, "fluent").startsWith("θ"), true);
  assert.equal(core.transform("psst phooey", greek, "fluent"), "ψστ φοοευ");

  const katakana = core.getPack("katakana");
  assert.equal(core.transform("shi", katakana, "familiar"), "シ");
  assert.equal(core.transform("kyo", katakana, "familiar"), "キョ");
});

test("compiled Greek profiles preserve exact casing and repeated-call output", () => {
  const greek = core.getPack("greek");
  const source = "THREE things, then three PHOTOS.";
  const expected = core.transform(source, greek, "fluent", {
    variationSeed: 42,
    sourceOffset: 17
  });

  for (let iteration = 0; iteration < 100; iteration += 1) {
    assert.equal(
      core.transform(source, greek, "fluent", {
        variationSeed: 42,
        sourceOffset: 17
      }),
      expected
    );
  }
  assert.equal(expected, "ΘΡΕΕ θινγσ, θεν θρεε ΦΟΤΟΣ.");
});

test("Unicode lowercase expansion retains legacy token matching semantics", () => {
  const pack = {
    profiles: {
      test: {
        mapping: {},
        tokens: { "i\u0307": "x" }
      }
    },
    defaultProfile: "test",
    renderers: ["unicode"],
    defaultRenderer: "unicode"
  };

  assert.equal(core.transform("\u0130Z", pack, "test"), "X");
});

test("mutable direct-call profiles are not cached across edits", () => {
  const pack = {
    profiles: {
      test: {
        mapping: {},
        tokens: { ab: "x" }
      }
    },
    defaultProfile: "test",
    renderers: ["unicode"],
    defaultRenderer: "unicode"
  };

  assert.equal(core.transform("ab", pack, "test"), "x");
  pack.profiles.test.tokens.ab = "y";
  assert.equal(core.transform("ab", pack, "test"), "y");
});

test("Japanese packs use word-level English phonetics", () => {
  const katakana = core.getPack("katakana");
  const hiragana = core.getPack("hiragana");
  assert.equal(
    core.transform("meet me at the library", katakana, "familiar"),
    "ミート ミー アット ザ ライブラリー"
  );
  assert.equal(
    core.transform("meet me at the library", hiragana, "familiar"),
    "みーと みー あっと ざ らいぶらりー"
  );
  assert.equal(core.transform("shi", hiragana, "familiar"), "し");
  assert.equal(core.transform("kyo", hiragana, "familiar"), "きょ");
  assert.match(core.transform("library", hiragana, "dense"), /^[\u3040-\u309fー]+$/u);
});

test("Japanese phonetic fallback handles whole unfamiliar words and punctuation", () => {
  const katakana = core.getPack("katakana");
  assert.deepEqual(core.englishPhonemes("knightly"), ["N", "AY", "T", "L", "IY"]);
  assert.equal(core.englishWordToKana("privacy"), "プライバシー");
  assert.equal(core.transform("action, quick!", katakana, "familiar"), "アクション, クイック!");
  assert.doesNotMatch(core.transform("unfamiliar", katakana, "familiar"), /[A-Za-z]/);
});

test("clear-word anchors bypass the English-to-kana engine by full word", () => {
  const katakana = core.getPack("katakana");
  const source = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const output = core.transform(source, katakana, "familiar", {
    clearWordFraction: 0.2,
    wordSeed: 42
  });
  const visibleWords = output.split(" ").filter((word) => /[A-Za-z]/.test(word));
  assert.equal(visibleWords.length, 2);
  assert.ok(visibleWords.every((word) => source.split(" ").includes(word)));
});

test("Gregg Simplified uses only the connected-stroke renderer", () => {
  const pack = core.getPack("gregg-simplified");
  assert.equal(pack.engine, "gregg-simplified");
  assert.deepEqual(pack.renderers, ["strokes"]);
  assert.equal(core.resolveRenderer(pack, "unicode"), "strokes");
});

test("Hebrew pack refuses the bidi-unsafe unicode renderer", () => {
  const pack = core.getPack("hebrew");
  assert.equal(core.resolveRenderer(pack, "unicode"), "overlay");
});

test("Arabic glyphs use left-to-right overlay rendering only", () => {
  const pack = core.getPack("arabic");
  assert.equal(pack.defaultRenderer, "overlay");
  assert.deepEqual(pack.renderers, ["overlay"]);
  assert.equal(core.resolveRenderer(pack, "unicode"), "overlay");
  assert.equal(core.transform("meet", pack, "familiar"), "مععت");
  assert.equal(core.transform("sh kh th", pack, "fluent"), "ش خ ث");
  assert.match(core.transform("library", pack, "dense"), /^[\u0600-\u06ff]+$/u);
});

test("invalid custom packs are excluded and cannot shadow built-ins", () => {
  const invalid = { id: "bad" };
  const shadow = structuredClone(core.getPack("greek"));
  shadow.name = "Shadow";
  assert.equal(core.getCatalog([invalid, shadow]).length, core.BUILTIN_PACKS.length);
  assert.equal(core.getPack("greek", [shadow]).name, "Greek");
});

test("a valid custom data-only pack is accepted", () => {
  const pack = {
    schemaVersion: 1,
    id: "my-pack",
    name: "My Pack",
    maturity: "experimental",
    renderers: ["overlay"],
    defaultRenderer: "overlay",
    defaultProfile: "familiar",
    profiles: {
      familiar: { name: "Familiar", mapping: { a: "∆" } }
    }
  };
  assert.equal(core.validatePack(pack).valid, true);
  assert.equal(core.getPack("my-pack", [pack]).id, "my-pack");
});

test("custom packs enforce bounded rule complexity", () => {
  const pack = {
    schemaVersion: 1,
    id: "too-large",
    name: "Too large",
    maturity: "experimental",
    renderers: ["overlay"],
    defaultRenderer: "overlay",
    defaultProfile: "familiar",
    profiles: {
      familiar: {
        name: "Familiar",
        mapping: Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`x${index}`, "∆"]))
      }
    }
  };
  const result = core.validatePack(pack);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /500 rules/);
});

test("custom stroke packs must select the supported data-only engine", () => {
  const pack = {
    schemaVersion: 1,
    id: "bad-strokes",
    name: "Bad strokes",
    maturity: "experimental",
    renderers: ["strokes"],
    defaultRenderer: "strokes",
    defaultProfile: "familiar",
    profiles: { familiar: { name: "Familiar", mapping: {} } }
  };
  const result = core.validatePack(pack);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /gregg-simplified engine/);
});

test("session variation is deterministic and bounded to declared alternates", () => {
  const pack = core.getPack("greek");
  const first = core.transform("sassy", pack, "familiar", { variationSeed: 42 });
  const repeated = core.transform("sassy", pack, "familiar", { variationSeed: 42 });
  assert.equal(first, repeated);
  assert.match(first, /^[σαγςυ]+$/);
  assert.equal(core.transform("sassy", pack, "familiar"), "σασσυ");
});

test("clear-word fractions reveal evenly distributed whole words", () => {
  const pack = core.getPack("greek");
  const source = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const options = { clearWordFraction: 0.2, wordSeed: 42 };
  const first = core.transform(source, pack, "familiar", options);
  const repeated = core.transform(source, pack, "familiar", options);
  const sourceWords = source.split(" ");
  const outputWords = first.split(" ");
  const visibleIndexes = sourceWords
    .map((word, index) => word === outputWords[index] ? index : -1)
    .filter((index) => index >= 0);

  assert.equal(first, repeated);
  assert.equal(visibleIndexes.length, 2);
  assert.ok(visibleIndexes[1] - visibleIndexes[0] > 1);
});

test("clear-word selection never exposes sensitive-looking tokens", () => {
  const pack = core.getPack("greek");
  const source = "contact alice@example.com today please now";
  const output = core.transform(source, pack, "familiar", {
    clearWordFraction: 0.5,
    wordSeed: 42
  });

  assert.doesNotMatch(output, /alice|example|com/);
  assert.match(output, /contact|today|please|now/);
});

test("veil plans preserve source offsets and share clear-word decisions with adapters", () => {
  const pack = core.getPack("greek");
  const plan = core.planVeil("meet me alice@example.com", pack, "dense", {
    clearWordRanges: [{ start: 0, end: 4 }]
  });
  assert.deepEqual(
    plan.map(({ from, to, original, rendered, clear, sensitive }) =>
      ({ from, to, original, rendered, clear, sensitive })),
    [
      { from: 0, to: 4, original: "meet", rendered: "meet", clear: true, sensitive: false },
      { from: 5, to: 7, original: "me", rendered: "με", clear: false, sensitive: false },
      { from: 8, to: 13, original: "alice", rendered: "αλικε", clear: false, sensitive: true },
      { from: 14, to: 21, original: "example", rendered: "εξαμπλε", clear: false, sensitive: true },
      { from: 22, to: 25, original: "com", rendered: "κομ", clear: false, sensitive: true }
    ]
  );
});
