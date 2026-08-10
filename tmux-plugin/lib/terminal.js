"use strict";

const Core = require("../../browser-extension/shared/core.js");

const DEFAULT_PACK_ID = "greek";
const DEFAULT_REFRESH_MS = 250;
const MIN_REFRESH_MS = 100;
const MAX_REFRESH_MS = 5000;

function terminalError(message) {
  const error = new Error(message);
  error.name = "KalimaTerminalError";
  return error;
}

function resolveTerminalOptions(options = {}) {
  const packId = String(options.packId || DEFAULT_PACK_ID).trim().toLowerCase();
  const pack = Core.BUILTIN_PACKS.find((candidate) => candidate.id === packId);
  if (!pack) {
    const supported = Core.BUILTIN_PACKS
      .filter((candidate) => candidate.renderers.includes("unicode"))
      .map((candidate) => candidate.id)
      .join(", ");
    throw terminalError(`Unknown Kalima pack "${packId}". Terminal packs: ${supported}.`);
  }
  if (!pack.renderers.includes("unicode")) {
    throw terminalError(
      `${pack.name} requires a visual overlay and is not terminal-safe. ` +
      "Use greek, cyrillic, katakana, or hiragana."
    );
  }

  const requestedProfile = String(options.profileId || pack.defaultProfile).trim().toLowerCase();
  if (!pack.profiles[requestedProfile]) {
    throw terminalError(
      `Unknown ${pack.name} profile "${requestedProfile}". ` +
      `Profiles: ${Object.keys(pack.profiles).join(", ")}.`
    );
  }
  const profileId = requestedProfile;
  const clearWordFraction = Math.min(
    0.5,
    Math.max(0, Number(options.clearWordFraction) || 0)
  );
  const variationSeed = Number(options.variationSeed) >>> 0;
  const wordSeed = Number(options.wordSeed ?? variationSeed) >>> 0;
  const refreshMs = Math.min(
    MAX_REFRESH_MS,
    Math.max(MIN_REFRESH_MS, Math.round(Number(options.refreshMs) || DEFAULT_REFRESH_MS))
  );

  return Object.freeze({
    pack,
    packId: pack.id,
    profileId,
    clearWordFraction,
    variationSeed,
    wordSeed,
    refreshMs
  });
}

function ansiSequenceEnd(text, index) {
  if (text.charCodeAt(index) !== 0x1b) return index;
  if (index + 1 >= text.length) return text.length;

  const introducer = text[index + 1];
  if (introducer === "[") {
    for (let cursor = index + 2; cursor < text.length; cursor += 1) {
      const code = text.charCodeAt(cursor);
      if (code >= 0x40 && code <= 0x7e) return cursor + 1;
    }
    return text.length;
  }

  if (introducer === "]" || introducer === "P" ||
      introducer === "X" || introducer === "^" || introducer === "_") {
    for (let cursor = index + 2; cursor < text.length; cursor += 1) {
      if (text.charCodeAt(cursor) === 0x07) return cursor + 1;
      if (text.charCodeAt(cursor) === 0x1b && text[cursor + 1] === "\\") {
        return cursor + 2;
      }
    }
    return text.length;
  }

  return Math.min(text.length, index + 2);
}

function createTerminalTransformer(options = {}) {
  const resolved = resolveTerminalOptions(options);

  return Object.freeze({
    options: resolved,
    transform(input) {
      const text = String(input ?? "");
      if (!text) return "";

      let output = "";
      let plainStart = 0;
      let cursor = 0;
      let visibleOffset = 0;
      let wordOffset = 0;

      const appendPlain = (end) => {
        if (end <= plainStart) return;
        const plain = text.slice(plainStart, end);
        output += Core.transform(plain, resolved.pack, resolved.profileId, {
          clearWordFraction: resolved.clearWordFraction,
          variationSeed: resolved.variationSeed,
          wordSeed: resolved.wordSeed,
          wordOffset,
          sourceOffset: visibleOffset
        });
        visibleOffset += plain.length;
        wordOffset += Core.countClearWordCandidates(plain);
      };

      while (cursor < text.length) {
        if (text.charCodeAt(cursor) !== 0x1b) {
          cursor += 1;
          continue;
        }
        appendPlain(cursor);
        const end = ansiSequenceEnd(text, cursor);
        output += text.slice(cursor, end);
        cursor = end;
        plainStart = end;
      }
      appendPlain(text.length);
      return output;
    }
  });
}

function transformTerminalText(input, options = {}) {
  return createTerminalTransformer(options).transform(input);
}

function isWideCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function characterWidth(character, column = 0) {
  if (character === "\t") return 8 - (column % 8);
  const codePoint = character.codePointAt(0);
  if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (/\p{Mark}/u.test(character) ||
      codePoint === 0x200b ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) {
    return 0;
  }
  return isWideCodePoint(codePoint) ? 2 : 1;
}

function truncateToColumns(line, columns) {
  const limit = Math.max(0, Math.floor(Number(columns) || 0));
  if (!limit) return "";
  let output = "";
  let width = 0;
  let cursor = 0;
  let containsAnsi = false;
  const text = String(line ?? "");
  while (cursor < text.length) {
    if (text.charCodeAt(cursor) === 0x1b) {
      const end = ansiSequenceEnd(text, cursor);
      output += text.slice(cursor, end);
      cursor = end;
      containsAnsi = true;
      continue;
    }
    const codePoint = text.codePointAt(cursor);
    const character = String.fromCodePoint(codePoint);
    const characterColumns = characterWidth(character, width);
    if (width + characterColumns > limit) break;
    output += character;
    width += characterColumns;
    cursor += character.length;
  }
  return containsAnsi ? `${output}\u001b[0m` : output;
}

module.exports = Object.freeze({
  DEFAULT_PACK_ID,
  DEFAULT_REFRESH_MS,
  MIN_REFRESH_MS,
  MAX_REFRESH_MS,
  ansiSequenceEnd,
  createTerminalTransformer,
  resolveTerminalOptions,
  transformTerminalText,
  truncateToColumns
});
