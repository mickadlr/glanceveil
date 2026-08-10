export interface GreggOutline {
  tokens: readonly string[];
  width: number;
  height: number;
  viewBox: string;
  paths: ReadonlyArray<{ d: string; width: number }>;
}

export function phoneticTokens(input: string): string[];
export function outlineWord(word: string): GreggOutline | null;
