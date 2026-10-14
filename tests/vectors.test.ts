import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import vectors from './fixtures/glossary-vectors.json';
import { parseDelimited, buildGlossary, lookup, canInsert, type Delimiter } from '../src/glossary';
const noPause = async () => {};
async function means(text: string, delimiter: Delimiter, term: number, meaning: number, selected: string, folded: boolean) {
 return lookup(await buildGlossary(await parseDelimited(text, delimiter, noPause), { term, meaning }, noPause), selected, folded).map((v) => v.meaning);
}
describe('golden vectors', () => {
 it('contains at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 const path = '../../packages/spec/vectors/csv-glossary-lookup.json';
 it.skipIf(!existsSync(path))('matches the factory source when present', () => expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(vectors));
 for (const c of vectors.cases) it(c.name, async () => {
  const a = c.args as unknown[]; let got: unknown;
  if (c.operation === 'parse') got = await parseDelimited(a[0] as string, a[1] as Delimiter, noPause);
  else if (c.operation === 'lookup') got = await means(...a as [string, Delimiter, number, number, string, boolean]);
  else if (c.operation === 'headerless') got = lookup(await buildGlossary(await parseDelimited(a[0] as string, a[1] as Delimiter, noPause), { term: a[2] as number, meaning: a[3] as number }, noPause, false), a[4] as string, a[5] as boolean).map((v) => v.meaning);
  else if (c.operation === 'guard') got = canInsert(...a as [string,string,string,string,boolean]);
  else if (c.operation === 'reload') { await means(a[0] as string, ',', 0, 1, a[2] as string, false); got = await means(a[1] as string, ',', 0, 1, a[2] as string, false); }
  else if (c.operation === 'large') {
   let yields = 0; const pause = async () => { yields++; };
   const count = a[0] as number, text = 'term,meaning\n' + Array.from({ length: count }, (_, i) => `term${i},meaning ${i}`).join('\n');
   const g = await buildGlossary(await parseDelimited(text, ',', pause), { term: 0, meaning: 1 }, pause);
   got = { rows: g.senses.length, last: lookup(g, `term${count - 1}`, false)[0]?.meaning, yielded: yields > 50 };
  } else if (c.operation === 'refuse' || c.operation === 'oversize') {
   const old = await means(a[0] as string, ',', 0, 1, 'bank', false);
   let message = ''; try { await parseDelimited(c.operation === 'oversize' ? 'x'.repeat(a[1] as number) : a[1] as string, ',', noPause); } catch (e) { message = (e as Error).message; }
   got = { message, meanings: old };
  } else {
   try { const rows = await parseDelimited(a[0] as string, a[1] as Delimiter, noPause); if (c.operation === 'error') await buildGlossary(rows, { term: a[2] as number, meaning: a[3] as number }, noPause); }
   catch (e) { got = (e as Error).message; }
  }
  expect(got).toEqual(c.expected);
 });
});
