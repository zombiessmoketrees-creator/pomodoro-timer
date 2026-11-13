export type Token = { text: string; emphasis: boolean };

/** Splits text into words, flagging the ones wrapped in **double asterisks**. */
export const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  const parts = input.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    const emphasis = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    const clean = emphasis ? part.slice(2, -2) : part;
    for (const word of clean.split(/\s+/)) {
      if (word) {
        tokens.push({ text: word, emphasis });
      }
    }
  }
  return tokens;
};

export const stripEmphasis = (input: string): string => input.replace(/\*\*/g, "");

/** Groups tokens into short chunks for kinetic (one-phrase-at-a-time) display. */
export const chunkTokens = (tokens: Token[], maxWords: number, maxChars = 18): Token[][] => {
  const chunks: Token[][] = [];
  let current: Token[] = [];
  let chars = 0;
  for (const token of tokens) {
    const tooLong = current.length >= maxWords || (current.length > 0 && chars + token.text.length > maxChars);
    if (tooLong) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(token);
    chars += token.text.length + 1;
    if (/[.!?;:]$/.test(token.text)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
};
