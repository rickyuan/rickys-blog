/**
 * Pinyin ruby annotation: align a space-separated pinyin string to the Han
 * characters of a Chinese string, one syllable per character.
 *
 * The guide's `pinyin` / `family_pinyin` fields are stored as space-separated
 * syllables with tone marks (e.g. 茶色蟆口鸱 -> "chá sè má kǒu chī"). Only Han
 * characters take a syllable; punctuation, Latin letters and digits pass
 * through unannotated, so 绿皇鸠（栗颈亚种）needs 7 syllables, not 9.
 *
 * `\p{Script=Han}` (not [一-鿿]) is required: several bird-name
 * characters live outside the main CJK block — 䴕 (U+4D15, CJK Ext A) among
 * them — and a narrow range silently drops them, shifting every later syllable
 * onto the wrong character.
 */

export type RubySegment = {
  /** one character of the source text */
  ch: string;
  /** its pinyin syllable, when the character is Han and alignment succeeded */
  py?: string;
};

const HAN = /\p{Script=Han}/u;

export function hanCount(text: string): number {
  let n = 0;
  for (const ch of text) if (HAN.test(ch)) n++;
  return n;
}

/**
 * Zip text with its pinyin. Returns plain (unannotated) segments when there is
 * no pinyin or when the syllable count does not match the Han-character count —
 * a misaligned annotation puts the wrong sound over every following character,
 * which is worse than no annotation at all.
 *
 * `label` is only used to make a build-time warning findable.
 */
export function zipRuby(text: string, pinyin?: string, label?: string): RubySegment[] {
  const chars = [...text];
  if (!pinyin) return chars.map((ch) => ({ ch }));

  const syllables = pinyin.trim().split(/\s+/).filter(Boolean);
  const expected = hanCount(text);
  if (syllables.length !== expected) {
    console.warn(
      `[ruby] pinyin/character mismatch${label ? ` for ${label}` : ''}: ` +
        `"${text}" has ${expected} Han character(s) but "${pinyin}" has ${syllables.length} syllable(s) — annotation skipped`,
    );
    return chars.map((ch) => ({ ch }));
  }

  let i = 0;
  return chars.map((ch) => (HAN.test(ch) ? { ch, py: syllables[i++] } : { ch }));
}

/** True when every Han character in `text` will get a syllable. */
export function isAligned(text: string, pinyin?: string): boolean {
  if (!pinyin) return false;
  return pinyin.trim().split(/\s+/).filter(Boolean).length === hanCount(text);
}

/** Plain-text reading, e.g. for a title attribute: "chá sè má kǒu chī". */
export function pinyinLine(pinyin?: string): string {
  return pinyin ? pinyin.trim().split(/\s+/).filter(Boolean).join(' ') : '';
}
