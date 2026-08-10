(function initGreekVeilGregg(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.GreekVeilGregg = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /*
   * An independently implemented, deliberately conservative first pass at
   * connected Gregg Simplified-style outlines. It does not copy a manual,
   * dictionary, font, or scanned artwork. The phonetic normalizer and stroke
   * grammar are kept separate so verified outlines can replace approximations
   * incrementally without changing the DOM renderer.
   */

  const TOKEN_RULES = [
    ["tion", "Sun"], ["sion", "Sun"], ["tch", "C"], ["dge", "j"],
    ["igh", "i"], ["eigh", "a"], ["ph", "f"], ["ck", "k"],
    ["qu", "kw"], ["wh", "w"], ["wr", "r"], ["kn", "n"],
    ["sh", "S"], ["ch", "C"], ["th", "T"], ["ng", "N"],
    ["ee", "e"], ["ea", "e"], ["ie", "e"], ["oo", "u"],
    ["ou", "u"], ["ue", "u"], ["ai", "a"], ["ay", "a"],
    ["ei", "a"], ["oa", "o"], ["ow", "o"], ["oi", "O"],
    ["oy", "O"], ["au", "A"], ["aw", "A"]
  ];

  const VOICED = new Set(["b", "d", "g", "v", "z", "j"]);
  const VOWELS = new Set(["a", "e", "i", "o", "u", "O", "A"]);

  function phoneticTokens(input) {
    let word = String(input || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!word) return [];

    word = word
      .replace(/^x/, "z")
      .replace(/([^aeiou])e$/, "$1")
      .replace(/(.)\1+/g, "$1");

    const tokens = [];
    for (let index = 0; index < word.length;) {
      let matched = false;
      const remainder = word.slice(index);
      for (const [source, replacement] of TOKEN_RULES) {
        if (!remainder.startsWith(source)) continue;
        tokens.push(...replacement.split(""));
        index += source.length;
        matched = true;
        break;
      }
      if (matched) continue;

      const letter = word[index];
      if (letter === "c") {
        tokens.push(/[eiy]/.test(word[index + 1] || "") ? "s" : "k");
      } else if (letter === "x") {
        tokens.push("k", "s");
      } else if (letter === "q") {
        tokens.push("k");
      } else if (letter === "y") {
        tokens.push(index === word.length - 1 ? "e" : "i");
      } else {
        tokens.push(letter);
      }
      index += 1;
    }

    return tokens.filter((token, index) =>
      !(VOWELS.has(token) && token === tokens[index - 1])
    );
  }

  function number(value) {
    return Math.round(value * 100) / 100;
  }

  function curve(x, y, dx, dy, bend) {
    const endX = x + dx;
    const endY = y + dy;
    return {
      d: `M${number(x)} ${number(y)} C${number(x + dx * 0.3)} ${number(y + bend)} ` +
        `${number(x + dx * 0.7)} ${number(endY - bend)} ${number(endX)} ${number(endY)}`,
      endX,
      endY
    };
  }

  function loop(x, y, token) {
    const direction = token === "i" || token === "u" || token === "O" ? -1 : 1;
    const width = token === "e" || token === "i" ? 3.1 : token === "O" || token === "A" ? 5.1 : 4.1;
    const height = token === "u" || token === "A" ? 3.4 : 2.6;
    const endX = x + width;
    const endY = y + direction * 0.35;
    return {
      d: `M${number(x)} ${number(y)} ` +
        `C${number(x + width * 0.12)} ${number(y - direction * height)} ` +
        `${number(x + width * 0.66)} ${number(y - direction * height)} ` +
        `${number(x + width * 0.58)} ${number(y)} ` +
        `C${number(x + width * 0.62)} ${number(y + direction * height * 0.7)} ` +
        `${number(x + width * 0.9)} ${number(y + direction * height * 0.55)} ` +
        `${number(endX)} ${number(endY)}`,
      endX,
      endY
    };
  }

  function strokeFor(token, x, y) {
    if (VOWELS.has(token)) return loop(x, y, token);
    const shapes = {
      t: [3.6, -2.3, -1.8], d: [5.2, -3.2, -2.4],
      n: [4.4, 1.2, -1.7], m: [6.2, 1.6, -2.1],
      k: [5.7, -0.7, 2.5], g: [7.2, -1.0, 3.1],
      p: [4.4, 4.7, -1.8], b: [5.5, 5.8, -2.2],
      f: [5.8, -4.5, 1.8], v: [7.0, -5.3, 2.2],
      r: [4.8, -1.5, -3.1], l: [6.5, -2.0, -4.0],
      s: [3.2, 0.2, 2.2], z: [4.5, 0.3, 3.0],
      h: [4.2, -3.5, 3.2], w: [5.5, 2.8, -3.0],
      S: [6.3, 2.3, 4.1], C: [7.0, -2.8, -4.6],
      T: [4.8, 0.4, -3.8], N: [6.4, 3.1, -2.8],
      j: [6.8, -4.0, 4.0]
    };
    const [dx, dy, bend] = shapes[token] || [4.1, 0, token.charCodeAt(0) % 2 ? 2.1 : -2.1];
    return curve(x, y, dx, dy, bend);
  }

  function outlineWord(word) {
    const tokens = phoneticTokens(word);
    if (!tokens.length) return null;

    const paths = [];
    let x = 2;
    let y = 12;
    let minY = y;
    let maxY = y;
    for (const token of tokens) {
      const stroke = strokeFor(token, x, y);
      paths.push({
        d: stroke.d,
        width: VOICED.has(token) ? 2.25 : 1.45
      });
      x = stroke.endX;
      y = stroke.endY;
      minY = Math.min(minY, y - 4);
      maxY = Math.max(maxY, y + 4);
    }

    const top = Math.min(0, minY - 1);
    const height = Math.max(24, maxY - top + 1);
    return Object.freeze({
      tokens: Object.freeze(tokens.slice()),
      width: number(Math.max(8, x + 2)),
      height: number(height),
      viewBox: `0 ${number(top)} ${number(Math.max(8, x + 2))} ${number(height)}`,
      paths: Object.freeze(paths.map(Object.freeze))
    });
  }

  return Object.freeze({ phoneticTokens, outlineWord });
});
