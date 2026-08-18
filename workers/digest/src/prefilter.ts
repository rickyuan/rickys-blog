import KEYWORDS from './keywords.json';

const ALL_KEYWORDS: string[] = Object.values(KEYWORDS as Record<string, string[]>).flat();

const escaped = ALL_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const KEYWORD_REGEX = new RegExp(
  `(?:^|\\b|[\\s\\W])(${escaped.join('|')})(?:$|\\b|[\\s\\W])`,
  'i',
);

export function passesPreFilter(haystack: string): boolean {
  if (!haystack) return false;
  return KEYWORD_REGEX.test(haystack);
}

export function keywordCount(): number {
  return ALL_KEYWORDS.length;
}
