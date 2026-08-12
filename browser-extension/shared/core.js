(function initGreekVeilCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.GreekVeilCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const PACK_SCHEMA_VERSION = 1;

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
  }

  const GREEK = {
    a: "α", b: "μπ", c: "κ", d: "δ", e: "ε", f: "φ", g: "γ",
    h: "η", i: "ι", j: "τζ", k: "κ", l: "λ", m: "μ", n: "ν",
    o: "ο", p: "π", q: "θ", r: "ρ", s: "σ", t: "τ", u: "υ",
    v: "β", w: "ω", x: "ξ", y: "υ", z: "ζ"
  };

  const CYRILLIC = {
    a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г",
    h: "х", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н",
    o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у",
    v: "в", w: "в", x: "кс", y: "й", z: "з"
  };

  const HEBREW_GLYPHS = {
    a: "א", b: "ב", c: "כ", d: "ד", e: "ע", f: "פ", g: "ג",
    h: "ה", i: "י", j: "ז", k: "ק", l: "ל", m: "מ", n: "נ",
    o: "ו", p: "ף", q: "ק", r: "ר", s: "ס", t: "ט", u: "ו",
    v: "ב", w: "ש", x: "צ", y: "י", z: "ז"
  };

  const ARABIC_GLYPHS = {
    a: "ا", b: "ب", c: "ك", d: "د", e: "ع", f: "ف", g: "غ",
    h: "ه", i: "ي", j: "ج", k: "ك", l: "ل", m: "م", n: "ن",
    o: "و", p: "پ", q: "ق", r: "ر", s: "س", t: "ت", u: "و",
    v: "ڤ", w: "و", x: "خ", y: "ي", z: "ز"
  };

  const KATAKANA_TOKENS = {
    kya: "キャ", kyu: "キュ", kyo: "キョ",
    sha: "シャ", shu: "シュ", sho: "ショ",
    cha: "チャ", chu: "チュ", cho: "チョ",
    nya: "ニャ", nyu: "ニュ", nyo: "ニョ",
    hya: "ヒャ", hyu: "ヒュ", hyo: "ヒョ",
    mya: "ミャ", myu: "ミュ", myo: "ミョ",
    rya: "リャ", ryu: "リュ", ryo: "リョ",
    gya: "ギャ", gyu: "ギュ", gyo: "ギョ",
    ja: "ジャ", ju: "ジュ", jo: "ジョ",
    bya: "ビャ", byu: "ビュ", byo: "ビョ",
    pya: "ピャ", pyu: "ピュ", pyo: "ピョ",
    shi: "シ", chi: "チ", tsu: "ツ",
    dzu: "ヅ", dji: "ヂ",
    ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ",
    sa: "サ", su: "ス", se: "セ", so: "ソ",
    ta: "タ", te: "テ", to: "ト",
    na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
    ha: "ハ", hi: "ヒ", fu: "フ", he: "ヘ", ho: "ホ",
    ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ",
    ya: "ヤ", yu: "ユ", yo: "ヨ",
    ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ",
    wa: "ワ", wo: "ヲ",
    ga: "ガ", gi: "ギ", gu: "グ", ge: "ゲ", go: "ゴ",
    za: "ザ", ji: "ジ", zu: "ズ", ze: "ゼ", zo: "ゾ",
    da: "ダ", de: "デ", do: "ド",
    ba: "バ", bi: "ビ", bu: "ブ", be: "ベ", bo: "ボ",
    pa: "パ", pi: "ピ", pu: "プ", pe: "ペ", po: "ポ",
    a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ", n: "ン"
  };

  const KATAKANA_FALLBACK = {
    b: "ブ", c: "ク", d: "ド", f: "フ", g: "グ", h: "ホ", j: "ジ",
    k: "ク", l: "ル", m: "ム", p: "プ", q: "ク", r: "ル", s: "ス",
    t: "ト", v: "ヴ", w: "ウ", x: "クス", y: "イ", z: "ズ"
  };

  function katakanaToHiragana(text) {
    return [...text].map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0x30A1 && codePoint <= 0x30F6
        ? String.fromCodePoint(codePoint - 0x60)
        : character;
    }).join("");
  }

  const HIRAGANA_TOKENS = Object.fromEntries(
    Object.entries(KATAKANA_TOKENS).map(([token, rendered]) => [token, katakanaToHiragana(rendered)])
  );
  const HIRAGANA_FALLBACK = Object.fromEntries(
    Object.entries(KATAKANA_FALLBACK).map(([letter, rendered]) => [letter, katakanaToHiragana(rendered)])
  );

  const ENGLISH_KANA_WORDS = {
    a: "ア", about: "アバウト", after: "アフター", all: "オール", also: "オールソー",
    an: "アン", and: "アンド", any: "エニー", are: "アー", area: "エリア", as: "アズ",
    at: "アット", be: "ビー", because: "ビコーズ", been: "ビーン", before: "ビフォー",
    action: "アクション", better: "ベター", browser: "ブラウザー", brown: "ブラウン",
    build: "ビルド", button: "ボタン", but: "バット", by: "バイ", can: "キャン",
    cannot: "キャノット", cant: "キャント", click: "クリック", color: "カラー",
    colors: "カラーズ", contact: "コンタクト", create: "クリエイト", customize: "カスタマイズ",
    computer: "コンピューター", content: "コンテンツ", could: "クッド", data: "データ",
    delete: "デリート", description: "ディスクリプション", developer: "デベロッパー",
    do: "ドゥー", does: "ダズ", dont: "ドント", download: "ダウンロード",
    edit: "エディット", education: "エデュケーション", email: "メール",
    experience: "エクスペリエンス", export: "エクスポート",
    extension: "エクステンション", familiar: "ファミリアー", file: "ファイル",
    fast: "ファスト", faster: "ファスター", for: "フォー", from: "フロム",
    fox: "フォックス", game: "ゲーム", github: "ギットハブ", greek: "グリーク",
    had: "ハッド", has: "ハズ", have: "ハブ",
    he: "ヒー", hello: "ハロー", her: "ハー", here: "ヒア", hiragana: "ヒラガナ",
    how: "ハウ", i: "アイ", if: "イフ", in: "イン", into: "イントゥー", is: "イズ",
    it: "イット", its: "イッツ", japanese: "ジャパニーズ", katakana: "カタカナ",
    kyo: "キョ", library: "ライブラリー", make: "メイク", may: "メイ", me: "ミー",
    meet: "ミート",
    link: "リンク", links: "リンクス", message: "メッセージ", modern: "モダン",
    more: "モア", most: "モースト", my: "マイ", name: "ネーム", no: "ノー",
    not: "ノット", now: "ナウ", of: "オブ", on: "オン", one: "ワン", only: "オンリー",
    open: "オープン", or: "オア", other: "アザー", our: "アワー", out: "アウト",
    obsidian: "オブシディアン", page: "ページ", parser: "パーサー", parsing: "パーシング",
    pdf: "ピーディーエフ", phone: "フォン", portfolio: "ポートフォリオ",
    private: "プライベート", profile: "プロフィール", project: "プロジェクト",
    privacy: "プライバシー", quick: "クイック",
    read: "リード", renderer: "レンダラー", resume: "レジュメ", save: "セーブ",
    script: "スクリプト", search: "サーチ", section: "セクション",
    sections: "セクションズ", selected: "セレクテッド", settings: "セッティングス",
    she: "シー", shi: "シ", skills: "スキルズ",
    should: "シュッド",
    shorthand: "ショートハンド", so: "ソー", some: "サム", text: "テキスト",
    template: "テンプレート", than: "ザン", that: "ザット", the: "ザ", title: "タイトル",
    their: "ゼア", them: "ゼム",
    then: "ゼン", there: "ゼア", these: "ジーズ", they: "ゼイ", think: "シンク",
    this: "ディス", those: "ゾーズ", through: "スルー", time: "タイム", to: "トゥー",
    typography: "タイポグラフィー", upload: "アップロード", use: "ユーズ",
    user: "ユーザー", veil: "ベール", view: "ビュー", visible: "ビジブル",
    want: "ウォント",
    was: "ワズ", we: "ウィー", web: "ウェブ", webpage: "ウェブページ",
    website: "ウェブサイト", were: "ワー", what: "ワット", when: "ウェン",
    where: "ウェア", which: "ウィッチ", who: "フー", will: "ウィル", with: "ウィズ",
    word: "ワード", words: "ワーズ", work: "ワーク", would: "ウッド",
    you: "ユー", your: "ユア"
  };

  const KANA_ROWS = {
    "": ["ア", "イ", "ウ", "エ", "オ"],
    B: ["バ", "ビ", "ブ", "ベ", "ボ"],
    CH: ["チャ", "チ", "チュ", "チェ", "チョ"],
    D: ["ダ", "ディ", "ドゥ", "デ", "ド"],
    DH: ["ザ", "ジ", "ズ", "ゼ", "ゾ"],
    F: ["ファ", "フィ", "フ", "フェ", "フォ"],
    G: ["ガ", "ギ", "グ", "ゲ", "ゴ"],
    H: ["ハ", "ヒ", "フ", "ヘ", "ホ"],
    J: ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
    K: ["カ", "キ", "ク", "ケ", "コ"],
    L: ["ラ", "リ", "ル", "レ", "ロ"],
    M: ["マ", "ミ", "ム", "メ", "モ"],
    N: ["ナ", "ニ", "ヌ", "ネ", "ノ"],
    NG: ["ガ", "ギ", "グ", "ゲ", "ゴ"],
    P: ["パ", "ピ", "プ", "ペ", "ポ"],
    R: ["ラ", "リ", "ル", "レ", "ロ"],
    S: ["サ", "シ", "ス", "セ", "ソ"],
    SH: ["シャ", "シ", "シュ", "シェ", "ショ"],
    T: ["タ", "ティ", "トゥ", "テ", "ト"],
    TH: ["サ", "シ", "ス", "セ", "ソ"],
    V: ["ヴァ", "ヴィ", "ヴ", "ヴェ", "ヴォ"],
    W: ["ワ", "ウィ", "ウ", "ウェ", "ウォ"],
    Y: ["ヤ", "イ", "ユ", "イェ", "ヨ"],
    Z: ["ザ", "ジ", "ズ", "ゼ", "ゾ"]
  };

  const KANA_VOWELS = {
    AE: [0, ""], AH: [0, ""], AA: [0, "ー"], AO: [4, "ー"],
    EH: [3, ""], ER: [0, "ー"], IH: [1, ""], IY: [1, "ー"],
    UH: [2, ""], UW: [2, "ー"], OH: [4, ""], EY: [3, "イ"], AY: [0, "イ"],
    OW: [4, "ー"], AW: [0, "ウ"], OY: [4, "イ"]
  };

  const ENGLISH_SOUND_RULES = [
    ["tion", ["SH", "OH", "N"]], ["sion", ["ZH", "OH", "N"]],
    ["ture", ["CH", "ER"]], ["eigh", ["EY"]], ["igh", ["AY"]],
    ["tch", ["CH"]], ["dge", ["J"]], ["sch", ["S", "K"]],
    ["sh", ["SH"]], ["ch", ["CH"]], ["th", ["TH"]], ["ph", ["F"]],
    ["ng", ["NG"]], ["ck", ["K"]], ["qu", ["K", "W"]],
    ["wh", ["W"]], ["wr", ["R"]], ["kn", ["N"]],
    ["ee", ["IY"]], ["ea", ["IY"]], ["oo", ["UW"]], ["ou", ["AW"]],
    ["oa", ["OW"]], ["ai", ["EY"]], ["ay", ["EY"]], ["ei", ["EY"]],
    ["oi", ["OY"]], ["oy", ["OY"]], ["au", ["AO"]], ["aw", ["AO"]],
    ["ew", ["UW"]], ["er", ["ER"]], ["ir", ["ER"]], ["ur", ["ER"]],
    ["ar", ["AA", "R"]], ["or", ["AO", "R"]]
  ];

  function englishPhonemes(input) {
    const word = String(input || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z]/g, "");
    if (!word) return [];

    const silentFinalE = word.length > 2 && /[^aeiou]e$/.test(word);
    const sounds = [];
    for (let index = 0; index < word.length;) {
      if (silentFinalE && index === word.length - 1) break;
      const remainder = word.slice(index);
      const rule = ENGLISH_SOUND_RULES.find(([source]) => remainder.startsWith(source));
      if (rule) {
        sounds.push(...rule[1]);
        index += rule[0].length;
        continue;
      }

      const letter = word[index];
      const longByFinalE = silentFinalE && index + 2 === word.length - 1;
      if (/[aeiou]/.test(letter)) {
        const short = { a: "AE", e: "EH", i: "IH", o: "OH", u: "AH" };
        const long = { a: "EY", e: "IY", i: "AY", o: "OW", u: "UW" };
        sounds.push((longByFinalE ? long : short)[letter]);
      } else if (letter === "c") {
        sounds.push(/[eiy]/.test(word[index + 1] || "") ? "S" : "K");
      } else if (letter === "g") {
        sounds.push(/[eiy]/.test(word[index + 1] || "") ? "J" : "G");
      } else if (letter === "x") {
        sounds.push("K", "S");
      } else if (letter === "q") {
        sounds.push("K");
      } else if (letter === "y") {
        sounds.push(index === word.length - 1 ? "IY" : "Y");
      } else {
        const consonants = {
          b: "B", d: "D", f: "F", h: "H", j: "J", k: "K", l: "L",
          m: "M", n: "N", p: "P", r: "R", s: "S", t: "T", v: "V",
          w: "W", z: "Z"
        };
        const previousSound = sounds.length ? sounds[sounds.length - 1] : undefined;
        if (consonants[letter] && previousSound !== consonants[letter]) sounds.push(consonants[letter]);
      }
      index += 1;
    }
    return sounds;
  }

  function consonantFallback(sound, nextSound) {
    if (sound === "N") return "ン";
    if (sound === "M") return nextSound ? "ン" : "ム";
    if (sound === "NG") return "ング";
    if (sound === "SH") return "シュ";
    if (sound === "CH") return "チ";
    if (sound === "J") return "ジ";
    if (sound === "TH") return "ス";
    if (sound === "DH") return "ズ";
    if (sound === "T" || sound === "D") return KANA_ROWS[sound][4];
    if (sound === "H") return "フ";
    if (sound === "Y") return "イ";
    if (sound === "W") return "ウ";
    if (sound === "R" || sound === "L") return "ル";
    if (nextSound === sound && KANA_ROWS[sound]) return "ッ";
    return KANA_ROWS[sound]?.[2] || "";
  }

  function phonemesToKatakana(sounds, mode = "standard") {
    let output = "";
    for (let index = 0; index < sounds.length;) {
      let sound = sounds[index];
      if (sound === "R" && KANA_VOWELS[sounds[index - 1]] && !KANA_VOWELS[sounds[index + 1]]) {
        index += 1;
        continue;
      }
      const vowel = KANA_VOWELS[sounds[index + 1]];
      if (vowel && KANA_ROWS[sound]) {
        if (mode !== "source-close" && sound === "V") sound = "B";
        output += (KANA_ROWS[sound] || KANA_ROWS.B)[vowel[0]] + vowel[1];
        index += 2;
        continue;
      }
      const standaloneVowel = KANA_VOWELS[sound];
      if (standaloneVowel) {
        output += KANA_ROWS[""][standaloneVowel[0]] + standaloneVowel[1];
        index += 1;
        continue;
      }
      output += consonantFallback(sound, sounds[index + 1]);
      index += 1;
    }
    return output;
  }

  function englishWordToKana(word, script = "katakana", mode = "standard") {
    const normalized = String(word || "").toLowerCase().replace(/[’']/g, "");
    let katakana = ENGLISH_KANA_WORDS[normalized];
    if (!katakana) katakana = phonemesToKatakana(englishPhonemes(normalized), mode);
    return script === "hiragana" ? katakanaToHiragana(katakana) : katakana;
  }

  function transformEnglishKana(text, pack, profile) {
    const script = pack.kanaScript === "hiragana" ? "hiragana" : "katakana";
    const mode = profile.kanaMode || "standard";
    return text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, (word) =>
      englishWordToKana(word, script, mode)
    );
  }

  const BUILTIN_PACKS = deepFreeze([
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "greek",
      name: "Greek",
      script: "Greek",
      maturity: "production",
      description: "The original Greek-looking veil.",
      renderers: ["unicode", "overlay"],
      defaultRenderer: "unicode",
      defaultProfile: "dense",
      profiles: {
        familiar: { name: "Familiar", mapping: GREEK, alternates: { s: ["σ", "ς"], y: ["υ", "γ"] } },
        fluent: {
          name: "Fluent",
          mapping: GREEK,
          tokens: { th: "θ", ph: "φ", ch: "χ", ps: "ψ", ou: "ου", ai: "αι", ei: "ει" }
        },
        dense: {
          name: "Dense",
          mapping: { ...GREEK, h: "χ", q: "κ", y: "γ" },
          tokens: { th: "θ", ph: "φ", ch: "χ", ps: "ψ", ou: "ου", ai: "αι", ei: "ει", ng: "γγ" }
        }
      },
      sample: "meet me at the library"
    },
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "cyrillic",
      name: "Cyrillic",
      script: "Cyrillic",
      maturity: "production",
      description: "Phonetic Cyrillic-looking substitutions.",
      renderers: ["unicode", "overlay"],
      defaultRenderer: "unicode",
      defaultProfile: "familiar",
      profiles: {
        familiar: { name: "Familiar", mapping: CYRILLIC, alternates: { y: ["й", "ы"], w: ["в", "ш"] } },
        fluent: {
          name: "Fluent",
          mapping: CYRILLIC,
          tokens: { sh: "ш", ch: "ч", zh: "ж", kh: "х", ts: "ц", ya: "я", yu: "ю", yo: "ё" }
        },
        dense: {
          name: "Dense",
          mapping: { ...CYRILLIC, w: "ш", y: "ы" },
          tokens: { sh: "ш", ch: "ч", zh: "ж", kh: "х", ts: "ц", ya: "я", yu: "ю", yo: "ё", sch: "щ" }
        }
      },
      sample: "meet me at the library"
    },
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "hebrew",
      name: "Hebrew glyphs",
      script: "Hebrew",
      maturity: "beta",
      description: "A left-to-right visual overlay using Hebrew glyphs.",
      renderers: ["overlay"],
      defaultRenderer: "overlay",
      defaultProfile: "familiar",
      profiles: {
        familiar: { name: "Familiar", mapping: HEBREW_GLYPHS, alternates: { a: ["א", "ע"], v: ["ב", "ו"] } },
        fluent: { name: "Fluent", mapping: { ...HEBREW_GLYPHS, c: "צ", q: "ח", x: "ש" } },
        dense: { name: "Dense", mapping: { ...HEBREW_GLYPHS, e: "ח", i: "ע", o: "א", u: "צ", y: "ע" } }
      },
      sample: "meet me at the library"
    },
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "arabic",
      name: "Arabic glyphs",
      script: "Arabic",
      maturity: "beta",
      description: "A left-to-right visual overlay using Arabic-script glyph substitutions.",
      renderers: ["overlay"],
      defaultRenderer: "overlay",
      defaultProfile: "familiar",
      profiles: {
        familiar: {
          name: "Familiar",
          mapping: ARABIC_GLYPHS,
          alternates: { a: ["ا", "ع"], h: ["ه", "ح"] }
        },
        fluent: {
          name: "Fluent",
          mapping: ARABIC_GLYPHS,
          tokens: { sh: "ش", ch: "چ", th: "ث", dh: "ذ", kh: "خ", gh: "غ", ph: "ف" }
        },
        dense: {
          name: "Dense",
          mapping: { ...ARABIC_GLYPHS, e: "ح", i: "ئ", o: "ؤ", u: "ء", y: "ى" },
          tokens: {
            sh: "ش", ch: "چ", th: "ث", dh: "ذ", kh: "خ", gh: "غ", ph: "ف", aa: "آ"
          }
        }
      },
      sample: "meet me at the library"
    },
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "katakana",
      name: "Katakana",
      script: "Katakana",
      maturity: "experimental",
      description: "Word-level English phonetics rendered as Japanese loanword sounds.",
      engine: "english-kana",
      kanaScript: "katakana",
      renderers: ["unicode", "overlay"],
      defaultRenderer: "unicode",
      defaultProfile: "familiar",
      profiles: {
        familiar: {
          name: "Familiar", kanaMode: "standard",
          tokens: KATAKANA_TOKENS, mapping: KATAKANA_FALLBACK
        },
        fluent: {
          name: "Fluent", kanaMode: "source-close",
          tokens: KATAKANA_TOKENS, mapping: KATAKANA_FALLBACK
        },
        dense: {
          name: "Dense",
          kanaMode: "standard",
          tokens: KATAKANA_TOKENS,
          mapping: { ...KATAKANA_FALLBACK, a: "ア", e: "エ", i: "イ", o: "オ", u: "ウ" }
        }
      },
      sample: "meet me at the library"
    },
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "hiragana",
      name: "Hiragana",
      script: "Hiragana",
      maturity: "experimental",
      description: "Word-level English phonetics rendered in rounded Hiragana.",
      engine: "english-kana",
      kanaScript: "hiragana",
      renderers: ["unicode", "overlay"],
      defaultRenderer: "unicode",
      defaultProfile: "familiar",
      profiles: {
        familiar: {
          name: "Familiar", kanaMode: "standard",
          tokens: HIRAGANA_TOKENS, mapping: HIRAGANA_FALLBACK
        },
        fluent: {
          name: "Fluent", kanaMode: "source-close",
          tokens: HIRAGANA_TOKENS, mapping: HIRAGANA_FALLBACK
        },
        dense: {
          name: "Dense",
          kanaMode: "standard",
          tokens: HIRAGANA_TOKENS,
          mapping: {
            ...HIRAGANA_FALLBACK,
            a: "あ", e: "え", i: "い", o: "お", u: "う"
          }
        }
      },
      sample: "meet me at the library"
    },
    {
      schemaVersion: PACK_SCHEMA_VERSION,
      id: "gregg-simplified",
      name: "Gregg Simplified",
      script: "Shorthand",
      maturity: "experimental",
      description: "Connected SVG strokes using an approximate Simplified phonetic grammar.",
      engine: "gregg-simplified",
      renderers: ["strokes"],
      defaultRenderer: "strokes",
      defaultProfile: "simplified",
      profiles: {
        simplified: { name: "Simplified", mapping: {} }
      },
      sample: "meet me at the library"
    }
  ]);
  const compiledProfileCache = new WeakMap();

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function validateStringMap(value, path, errors) {
    if (!isPlainObject(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const entries = Object.entries(value);
    if (entries.length > 500) errors.push(`${path} cannot contain more than 500 rules`);
    for (const [key, result] of entries) {
      if (!key || typeof result !== "string" || !result) {
        errors.push(`${path}.${key || "<empty>"} must map to a non-empty string`);
      }
      if (key.length > 16) errors.push(`${path}.${key} exceeds the 16-character token limit`);
      if (typeof result === "string" && result.length > 32) errors.push(`${path}.${key} exceeds the 32-character output limit`);
    }
  }

  function validatePack(pack) {
    const errors = [];
    if (!isPlainObject(pack)) return { valid: false, errors: ["pack must be an object"] };
    try {
      if (JSON.stringify(pack).length > 200_000) errors.push("pack exceeds the 200 KB data limit");
    } catch {
      errors.push("pack must be serializable JSON data");
    }
    if (pack.schemaVersion !== PACK_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PACK_SCHEMA_VERSION}`);
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(pack.id || "")) errors.push("id must be a 2-48 character lowercase slug");
    if (typeof pack.name !== "string" || !pack.name.trim()) errors.push("name is required");
    if (!["experimental", "beta", "production"].includes(pack.maturity)) errors.push("maturity is invalid");
    if (!Array.isArray(pack.renderers) || !pack.renderers.length ||
        pack.renderers.some((renderer) => !["overlay", "unicode", "strokes"].includes(renderer))) {
      errors.push("renderers must contain overlay, unicode, and/or strokes");
    }
    if (pack.engine !== undefined && !["gregg-simplified", "english-kana"].includes(pack.engine)) {
      errors.push("engine is unsupported");
    }
    if (pack.engine === "english-kana" && !["katakana", "hiragana"].includes(pack.kanaScript)) {
      errors.push("english-kana engine requires a katakana or hiragana kanaScript");
    }
    if (pack.renderers?.includes("strokes") && pack.engine !== "gregg-simplified") {
      errors.push("strokes renderer requires the gregg-simplified engine");
    }
    if (!isPlainObject(pack.profiles) || !Object.keys(pack.profiles).length) {
      errors.push("profiles must contain at least one profile");
    } else {
      if (Object.keys(pack.profiles).length > 10) errors.push("profiles cannot contain more than 10 profiles");
      for (const [profileId, profile] of Object.entries(pack.profiles)) {
        if (!/^[a-z0-9-]+$/.test(profileId)) errors.push(`profiles.${profileId} has an invalid id`);
        if (!isPlainObject(profile)) {
          errors.push(`profiles.${profileId} must be an object`);
          continue;
        }
        if (!profile.mapping && !profile.tokens) errors.push(`profiles.${profileId} needs mapping or tokens`);
        if (profile.mapping) validateStringMap(profile.mapping, `profiles.${profileId}.mapping`, errors);
        if (profile.tokens) validateStringMap(profile.tokens, `profiles.${profileId}.tokens`, errors);
        if (profile.alternates) {
          if (!isPlainObject(profile.alternates)) {
            errors.push(`profiles.${profileId}.alternates must be an object`);
          } else {
            for (const [key, choices] of Object.entries(profile.alternates)) {
              if (!Array.isArray(choices) || choices.length < 2 || choices.length > 8 ||
                  choices.some((choice) => typeof choice !== "string" || !choice || choice.length > 32)) {
                errors.push(`profiles.${profileId}.alternates.${key} must contain 2-8 bounded strings`);
              }
            }
          }
        }
      }
    }
    if (pack.defaultProfile && !pack.profiles?.[pack.defaultProfile]) errors.push("defaultProfile is missing");
    if (pack.defaultRenderer && !pack.renderers?.includes(pack.defaultRenderer)) errors.push("defaultRenderer is unsupported");
    return { valid: errors.length === 0, errors };
  }

  function getCatalog(customPacks = []) {
    const custom = [];
    const builtInIds = new Set(BUILTIN_PACKS.map((pack) => pack.id));
    for (const pack of Array.isArray(customPacks) ? customPacks : []) {
      const result = validatePack(pack);
      if (result.valid && !builtInIds.has(pack.id)) custom.push(deepFreeze(structuredClone(pack)));
    }
    return [...BUILTIN_PACKS, ...custom];
  }

  function getPack(packId, customPacks = []) {
    const catalog = getCatalog(customPacks);
    return catalog.find((pack) => pack.id === packId) || catalog[0];
  }

  function getProfile(pack, profileId) {
    return pack.profiles[profileId] || pack.profiles[pack.defaultProfile] || Object.values(pack.profiles)[0];
  }

  function compileProfile(profile) {
    const cached = compiledProfileCache.get(profile);
    if (cached) return cached;
    const tokens = Object.entries(profile.tokens || {})
      .sort((a, b) => b[0].length - a[0].length)
      .map(([source, rendered]) => Object.freeze({
        source,
        lower: source.toLowerCase(),
        rendered
      }));
    const tokensByFirstCharacter = Object.create(null);
    for (const token of tokens) {
      const firstCharacter = token.lower[0] || "";
      const bucket = tokensByFirstCharacter[firstCharacter] || [];
      bucket.push(token);
      tokensByFirstCharacter[firstCharacter] = bucket;
    }
    for (const bucket of Object.values(tokensByFirstCharacter)) Object.freeze(bucket);
    const compiled = Object.freeze({
      tokens: Object.freeze(tokens),
      tokensByFirstCharacter: Object.freeze(tokensByFirstCharacter),
      indexStable: tokens.every((token) => token.source.length === token.lower.length)
    });
    // Built-in and validated catalog profiles are deeply frozen. Do not cache
    // arbitrary mutable profiles because callers may intentionally edit them
    // between transform calls.
    if (Object.isFrozen(profile)) compiledProfileCache.set(profile, compiled);
    return compiled;
  }

  function preserveCase(source, rendered) {
    return source && source === source.toUpperCase() && source !== source.toLowerCase()
      ? rendered.toUpperCase()
      : rendered;
  }

  function variationChoice(profile, key, fallback, seed, index) {
    const choices = profile.alternates?.[key.toLowerCase()];
    if (!seed || !Array.isArray(choices) || choices.length < 2) return fallback;
    let hash = Number(seed) | 0;
    for (let offset = 0; offset < key.length; offset += 1) hash = Math.imul(hash ^ key.charCodeAt(offset), 16777619);
    hash = Math.imul(hash ^ index, 16777619);
    return choices[Math.abs(hash) % choices.length] || fallback;
  }

  function boundedFraction(value) {
    return Number.isFinite(value) ? Math.min(0.5, Math.max(0, value)) : 0;
  }

  function hashUnit(text, seed = 0) {
    let hash = (Number(seed) | 0) ^ 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function sensitiveRanges(text) {
    const ranges = [];
    const pattern = /(?:https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\p{Sc}\s?\d[\d.,]*|\b(?:\d[ -]?){8,}\d\b)/giu;
    let match;
    while ((match = pattern.exec(text))) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    return ranges;
  }

  function clearWordCandidates(text) {
    if (typeof text !== "string") return [];
    const protectedRanges = sensitiveRanges(text);
    const candidates = [];
    const words = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let match;
    while ((match = words.exec(text))) {
      const range = { start: match.index, end: match.index + match[0].length };
      if (match[0].replace(/['’]/g, "").length <= 1) continue;
      if (protectedRanges.some((protectedRange) =>
        range.start < protectedRange.end && range.end > protectedRange.start
      )) continue;
      candidates.push(range);
    }
    return candidates;
  }

  function countClearWordCandidates(text) {
    return clearWordCandidates(text).length;
  }

  function selectClearWordRanges(text, fraction, seed = 0, wordOffset = 0) {
    const bounded = boundedFraction(fraction);
    if (!bounded) return [];
    const candidates = clearWordCandidates(text);
    const phase = hashUnit("clear-word-phase", seed);
    const offset = Math.max(0, Math.floor(Number(wordOffset) || 0));
    const selected = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const position = offset + index;
      if (Math.floor((position + 1) * bounded + phase) >
          Math.floor(position * bounded + phase)) {
        selected.push(candidates[index]);
      }
    }
    return selected;
  }

  function transformMapped(text, profile, compiled, mapping, options, sourceOffset = 0) {
    let output = "";
    const lowerText = compiled.tokens.length ? text.toLowerCase() : "";
    const indexStable = compiled.indexStable && lowerText.length === text.length;
    for (let index = 0; index < text.length;) {
      let matchedToken = null;
      if (indexStable) {
        const candidates = compiled.tokensByFirstCharacter[lowerText[index]] || [];
        for (const token of candidates) {
          if (lowerText.startsWith(token.lower, index)) {
            matchedToken = token;
            break;
          }
        }
      } else {
        // Some Unicode lowercase mappings expand to multiple code units. Keep
        // the original suffix-based matching semantics for those uncommon
        // inputs so the fast path cannot change transform output.
        const lowerRemainder = text.slice(index).toLowerCase();
        const candidates = compiled.tokensByFirstCharacter[lowerRemainder[0]] || [];
        for (const token of candidates) {
          if (lowerRemainder.startsWith(token.lower)) {
            matchedToken = token;
            break;
          }
        }
      }
      if (matchedToken) {
        const source = text.slice(index, index + matchedToken.source.length);
        output += preserveCase(
          source,
          variationChoice(
            profile,
            matchedToken.source,
            matchedToken.rendered,
            options.variationSeed,
            sourceOffset + index
          )
        );
        index += matchedToken.source.length;
        continue;
      }

      const source = text[index];
      const rendered = mapping[source.toLowerCase()];
      const varied = rendered
        ? variationChoice(profile, source, rendered, options.variationSeed, sourceOffset + index)
        : source;
      output += rendered ? preserveCase(source, varied) : source;
      index += 1;
    }
    return output;
  }

  function transform(text, pack, profileId, options = {}) {
    if (typeof text !== "string" || !text || !pack) return text || "";
    const profile = getProfile(pack, profileId);
    const compiled = compileProfile(profile);
    const mapping = profile.mapping || {};
    const baseSourceOffset = Math.max(0, Math.floor(Number(options.sourceOffset) || 0));
    const clearRanges = Array.isArray(options.clearWordRanges)
      ? options.clearWordRanges
      : selectClearWordRanges(text, options.clearWordFraction, options.wordSeed, options.wordOffset);
    let output = "";
    let cursor = 0;
    const renderSegment = (segment, sourceOffset) => pack.engine === "english-kana"
      ? transformEnglishKana(segment, pack, profile)
      : transformMapped(segment, profile, compiled, mapping, options, baseSourceOffset + sourceOffset);
    for (const range of clearRanges) {
      const start = Math.min(text.length, Math.max(cursor, Number(range?.start) || 0));
      const end = Math.min(text.length, Math.max(start, Number(range?.end) || start));
      output += renderSegment(text.slice(cursor, start), cursor);
      output += text.slice(start, end);
      cursor = end;
    }
    output += renderSegment(text.slice(cursor), cursor);
    return output;
  }

  function planVeil(text, pack, profileId, options = {}) {
    if (typeof text !== "string" || !text || !pack) return [];
    const clearRanges = Array.isArray(options.clearWordRanges)
      ? options.clearWordRanges
      : selectClearWordRanges(text, options.clearWordFraction, options.wordSeed, options.wordOffset);
    const protectedRanges = sensitiveRanges(text);
    const spans = [];
    const words = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let match;
    while ((match = words.exec(text))) {
      const from = match.index;
      const to = from + match[0].length;
      const clear = clearRanges.some((range) =>
        from < Number(range?.end) && to > Number(range?.start)
      );
      const sensitive = protectedRanges.some((range) => from < range.end && to > range.start);
      spans.push(Object.freeze({
        from,
        to,
        original: match[0],
        rendered: clear
          ? match[0]
          : transform(match[0], pack, profileId, {
            ...options,
            clearWordFraction: 0,
            clearWordRanges: [],
            sourceOffset: (Number(options.sourceOffset) || 0) + from
          }),
        clear,
        sensitive
      }));
    }
    return Object.freeze(spans);
  }

  function resolveRenderer(pack, requested) {
    if (pack.renderers.includes(requested)) return requested;
    return pack.defaultRenderer || pack.renderers[0];
  }

  return deepFreeze({
    PACK_SCHEMA_VERSION,
    BUILTIN_PACKS,
    validatePack,
    getCatalog,
    getPack,
    getProfile,
    countClearWordCandidates,
    selectClearWordRanges,
    planVeil,
    englishPhonemes,
    englishWordToKana,
    transform,
    resolveRenderer
  });
});
