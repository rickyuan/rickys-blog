import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keywordsPath = join(here, '..', 'keywords.json');

type KeywordsFile = Record<string, string[]>;
const KEYWORDS: KeywordsFile = JSON.parse(readFileSync(keywordsPath, 'utf-8'));

const ALL_KEYWORDS: string[] = Object.values(KEYWORDS).flat();

// Escape regex special chars; build one OR-pattern.
const escaped = ALL_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
// Use word boundaries where possible. Multi-word terms keep raw spaces.
const KEYWORD_REGEX = new RegExp(`(?:^|\\b|[\\s\\W])(${escaped.join('|')})(?:$|\\b|[\\s\\W])`, 'i');

export function passesPreFilter(haystack: string): boolean {
  if (!haystack) return false;
  return KEYWORD_REGEX.test(haystack);
}

export function keywordCount(): number {
  return ALL_KEYWORDS.length;
}
