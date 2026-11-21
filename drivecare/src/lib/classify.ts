import type { CategoryDef } from './types';

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keyword rule: must start at a word boundary. Short keywords (< 5 chars, e.g. "PT", "RMT", "Dr")
 * must also end at a word boundary; longer ones may be a prefix ("physio" → "physiotherapy").
 */
export function keywordRegex(kw: string): RegExp | null {
  const k = kw.trim();
  if (!k) return null;
  const body = escapeRe(k).replace(/\s+/g, '\\s+');
  const tail = k.length < 5 ? '(?=$|[^\\p{L}\\p{N}])' : '';
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}${tail}`, 'iu');
}

export interface Classification {
  categoryId: string;
  keyword: string;
}

/** Classifies by the event title only (locations contain words like "Dr" for Drive). */
export function classify(summary: string, categories: CategoryDef[]): Classification | null {
  const text = summary || '';
  if (!text.trim()) return null;
  const ordered = [...categories.filter((c) => !c.builtIn), ...categories.filter((c) => c.builtIn)];
  for (const c of ordered) {
    for (const kw of c.keywords) {
      const re = keywordRegex(kw);
      if (re && re.test(text)) return { categoryId: c.id, keyword: kw };
    }
  }
  return null;
}
