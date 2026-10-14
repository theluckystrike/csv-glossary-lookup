export const MAX_BYTES = 4 * 1024 * 1024;
export type Delimiter = ',' | '\t';
export interface Mapping { term: number; meaning: number }
export interface Sense { term: string; meaning: string; row: number }
export interface Glossary { headers: string[]; rows: string[][]; senses: Sense[]; exact: Map<string, Sense[]>; folded: Map<string, Sense[]> }
export const yieldUi = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

/** Parse in character batches, including quoted fields that cross batch boundaries. */
export async function parseDelimited(text: string, delimiter: Delimiter, pause: () => Promise<void> = yieldUi): Promise<string[][]> {
 if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('The file is larger than 4 MiB.');
 const source = text.replace(/^\uFEFF/, '');
 const rows: string[][] = [];
 let row: string[] = [], field = '', quoted = false, closed = false, nextYield = 32768;
 const finishRow = () => { row.push(field); if (row.some((v) => v !== '')) rows.push(row); row = []; field = ''; closed = false; };
 for (let i = 0; i < source.length; i++) {
  const c = source[i]!;
  if (quoted) {
   if (c === '"') {
    if (source[i + 1] === '"') { field += '"'; i++; }
    else { quoted = false; closed = true; }
   } else field += c;
  } else if (c === delimiter) { row.push(field); field = ''; closed = false; }
  else if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; finishRow(); }
  else if (closed) throw new Error('A quoted field has text after its closing quote.');
  else if (c === '"') { if (field !== '') throw new Error('A quote must start at the start of a field.'); quoted = true; }
  else field += c;
  if (i >= nextYield) { nextYield = i + 32768; await pause(); }
 }
 if (quoted) throw new Error('The file has an unclosed quote.');
 if (field !== '' || row.length > 0 || closed) finishRow();
 return rows;
}

export async function buildGlossary(rows: string[][], mapping: Mapping, pause: () => Promise<void> = yieldUi, hasHeader = true): Promise<Glossary> {
 const first = rows[0] ?? [];
 const headers = hasHeader ? first : first.map((_, i) => `Column ${i + 1}`);
 if (headers.length < 2) throw new Error('The file needs two columns.');
 if (![mapping.term, mapping.meaning].every((n) => Number.isInteger(n) && n >= 0 && n < headers.length) || mapping.term === mapping.meaning) throw new Error('Select two different columns.');
 const exact = new Map<string, Sense[]>(), folded = new Map<string, Sense[]>(), senses: Sense[] = [];
 for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
  const row = rows[i]!;
  if (row.length !== headers.length) throw new Error(`Row ${i + 1} has ${row.length} columns; expected ${headers.length}.`);
  const term = row[mapping.term]!.trim(), meaning = row[mapping.meaning]!;
  if (term && meaning.trim()) {
   const sense = { term, meaning, row: i + 1 }; senses.push(sense);
   for (const [index, key] of [[exact, term], [folded, term.toLowerCase()]] as const) {
    const list = index.get(key) ?? []; list.push(sense); index.set(key, list);
   }
  }
  if (i % 1000 === 0) await pause();
 }
 if (senses.length === 0) throw new Error('The mapped columns have no terms with meanings.');
 return { headers, rows, senses, exact, folded };
}
export function lookup(glossary: Glossary, selected: string, ignoreCase: boolean): Sense[] {
 const key = selected.trim();
 return (ignoreCase ? glossary.folded.get(key.toLowerCase()) : glossary.exact.get(key)) ?? [];
}
export function canInsert(original: string, current: string, term: string, range: string, sameFile: boolean): boolean {
 return sameFile && original === current && term === range && term.length > 0;
}
