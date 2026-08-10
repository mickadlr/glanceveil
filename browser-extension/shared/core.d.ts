export interface VeilProfile {
  name?: string;
  mapping?: Record<string, string>;
  tokens?: Record<string, string>;
  alternates?: Record<string, string[]>;
  kanaMode?: string;
}

export interface VeilPack {
  schemaVersion: number;
  id: string;
  name: string;
  script?: string;
  maturity: "experimental" | "beta" | "production";
  description?: string;
  engine?: "english-kana" | "gregg-simplified";
  kanaScript?: "katakana" | "hiragana";
  renderers: Array<"overlay" | "unicode" | "strokes">;
  defaultRenderer: "overlay" | "unicode" | "strokes";
  defaultProfile: string;
  profiles: Record<string, VeilProfile>;
  sample?: string;
}

export interface VeilOptions {
  clearWordFraction?: number;
  clearWordRanges?: Array<{ start: number; end: number }>;
  wordSeed?: number;
  wordOffset?: number;
  variationSeed?: number;
  sourceOffset?: number;
}

export interface VeilSpan {
  from: number;
  to: number;
  original: string;
  rendered: string;
  clear: boolean;
  sensitive: boolean;
}

export const PACK_SCHEMA_VERSION: number;
export const BUILTIN_PACKS: readonly VeilPack[];
export function validatePack(pack: unknown): { valid: boolean; errors: string[] };
export function getCatalog(customPacks?: unknown[]): VeilPack[];
export function getPack(packId: string, customPacks?: unknown[]): VeilPack;
export function getProfile(pack: VeilPack, profileId: string): VeilProfile;
export function countClearWordCandidates(text: string): number;
export function selectClearWordRanges(
  text: string,
  fraction: number,
  seed?: number,
  wordOffset?: number
): Array<{ start: number; end: number }>;
export function planVeil(
  text: string,
  pack: VeilPack,
  profileId: string,
  options?: VeilOptions
): readonly VeilSpan[];
export function englishPhonemes(input: string): string[];
export function englishWordToKana(
  word: string,
  script?: "katakana" | "hiragana",
  mode?: string
): string;
export function transform(
  text: string,
  pack: VeilPack,
  profileId: string,
  options?: VeilOptions
): string;
export function resolveRenderer(
  pack: VeilPack,
  requested: string
): "overlay" | "unicode" | "strokes";
