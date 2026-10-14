import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import CsvGlossaryLookupPlugin, { type Selection } from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS, PRO_UI } from '../src/pro';
import { parseDelimited, buildGlossary } from '../src/glossary';
import manifest from '../manifest.json';
import { ResultsModal } from '../src/modals';
const csv = 'term,meaning\nbank,river edge\nbank,money service';
function plugin() {
 const app = App.createConfigured__({ files: { 'Study.md': 'bank' } });
 const p = new CsvGlossaryLookupPlugin(app as never, manifest as never);
 vi.spyOn(p, 'saveData').mockResolvedValue(undefined);
 return p;
}
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => {} } as never); }
afterEach(() => resetPro());
async function importBank(p: CsvGlossaryLookupPlugin) { return p.importText('Study.csv', csv, ',', { term: 0, meaning: 1 }); }
describe('plugin lifecycle and stored snapshots', () => {
 it('loads the free default without a Sponsors request', async () => { const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS); expect(isPro()).toBe(false); });
 it('repairs malformed saved data', () => {
  expect(normalizeSettings({ ignoreCase: 5 as never, profiles: [null as never] })).toEqual(DEFAULT_SETTINGS);
  expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
 });
 it('stores the snapshot and rebuilds it after a restart', async () => {
  const p = plugin(); await importBank(p);
  const next = plugin(); vi.spyOn(next, 'loadData').mockResolvedValue(p.settings); await next.loadSettings(); await next.loadIndexes();
  expect(next.lookupTerm('Bank').map((v) => v.meaning)).toEqual(['river edge', 'money service']);
 });
 it('does not parse stored snapshots in loadSettings', async () => {
  const p = plugin(); await importBank(p);
  const next = plugin(); vi.spyOn(next, 'loadData').mockResolvedValue(p.settings); await next.loadSettings();
  expect(next.indexes.size).toBe(0); expect(next.settings.profiles).toHaveLength(1);
 });
 it('keeps a newer import when the startup rebuild finishes later', async () => {
  const p = plugin(); await p.importText('Study.csv', csv + '\n' + Array.from({ length: 3000 }, (_, i) => `t${i},m${i}`).join('\n'), ',', { term: 0, meaning: 1 });
  const next = plugin(); vi.spyOn(next, 'loadData').mockResolvedValue(p.settings); await next.loadSettings();
  const rebuild = next.loadIndexes();
  await next.importText('Study.csv', 'term,meaning\nbank,new meaning', ',', { term: 0, meaning: 1 });
  await rebuild;
  expect(next.lookupTerm('bank').map((v) => v.meaning)).toEqual(['new meaning']);
 });
 it('replaces rather than appends the old index on reload', async () => {
  const p = plugin(); const old = await importBank(p); await p.importText('Study.csv', 'term,meaning\nbank,new meaning', ',', { term: 0, meaning: 1 });
  expect(p.settings.profiles).toHaveLength(1); expect(p.currentProfile()?.id).toBe(old.id);
  expect(p.lookupTerm('bank').map((v) => v.meaning)).toEqual(['new meaning']);
 });
 it('looks up the literal quoted single-row file without a header', async () => {
  const p = plugin(); const stored = await p.importText('Dessert.csv', '"ice, cream","cold, sweet"', ',', { term: 0, meaning: 1 }, false, 'Dessert', false);
  expect(p.lookupTerm('ice, cream').map((v) => [v.meaning, v.row])).toEqual([['cold, sweet', 1]]);
  expect(stored.hasHeader).toBe(false);
  const next = plugin(); vi.spyOn(next, 'loadData').mockResolvedValue(p.settings); await next.loadSettings(); await next.loadIndexes();
  expect(next.lookupTerm('ice, cream')[0]?.meaning).toBe('cold, sweet');
 });
 it('keeps the old snapshot when validation fails', async () => {
  const p = plugin(); await importBank(p); const old = p.settings;
  await expect(p.importText('bad.csv', 'term,meaning\nbank,"broken', ',', { term: 0, meaning: 1 })).rejects.toThrow('unclosed quote');
  expect(p.settings).toBe(old); expect(p.lookupTerm('bank')).toHaveLength(2);
  await expect(p.importText('large.csv', 'x'.repeat(4194305), ',', { term: 0, meaning: 1 })).rejects.toThrow('4 MiB');
  expect(p.settings).toBe(old); expect(p.lookupTerm('bank')).toHaveLength(2);
 });
 it('keeps the old index and stored state when saving fails', async () => {
  const p = plugin(); await importBank(p); const old = p.settings;
  vi.mocked(p.saveData).mockRejectedValueOnce(new Error('disk write failed'));
  await expect(p.importText('new.csv', 'term,meaning\nbank,new', ',', { term: 0, meaning: 1 })).rejects.toThrow('disk write failed');
  expect(p.settings).toBe(old); expect(p.lookupTerm('bank').map((v) => v.meaning)).toEqual(['river edge', 'money service']);
 });
 it('lets event-loop work run between batches of 50001 valid rows', async () => {
  const text = 'term,meaning\n' + Array.from({ length: 50001 }, (_, i) => `t${i},m${i}`).join('\n');
  let available = false; window.setTimeout(() => { available = true; }, 0);
  const g = await buildGlossary(await parseDelimited(text, ','), { term: 0, meaning: 1 });
  expect(available).toBe(true); expect(g.senses).toHaveLength(50001); expect(g.exact.get('t50000')?.[0]?.meaning).toBe('m50000');
 });
 it('rejects invalid UTF-8 and large browser files before import', async () => {
  const p = plugin(); await importBank(p);
  await expect(p.readFile(new File([new Uint8Array([255,254,0])], 'bad.csv'))).rejects.toThrow('UTF-8');
  await expect(p.readFile(new File(['x'.repeat(4194305)], 'large.csv'))).rejects.toThrow('4 MiB');
  expect(p.lookupTerm('bank')).toHaveLength(2);
 });
 it('discards an earlier import when a new import arrives during its batch pause', async () => {
  const p = plugin(); const slow = p.importText('slow.csv', 'term,meaning\n' + Array.from({ length: 4000 }, (_, i) => `t${i},m${i}`).join('\n'), ',', { term: 0, meaning: 1 });
  const rejected = expect(slow).rejects.toThrow('newer import');
  await importBank(p); await rejected; expect(p.lookupTerm('bank')).toHaveLength(2); expect(p.lookupTerm('t1')).toHaveLength(0);
 });
});
describe('Pro boundaries', () => {
 it('uses the reference payment values', () => { expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }); expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.'); });
 it('refuses a second profile when Pro is off', async () => {
  const p = plugin(); await importBank(p); await expect(p.importText('second.csv', csv, ',', { term: 0, meaning: 1 }, true)).rejects.toThrow('Pro');
  expect(p.settings.profiles).toHaveLength(1); expect(await p.selectProfile('missing')).toBe(false); expect(await p.removeProfile(p.settings.profiles[0]!.id)).toBe(false);
 });
 it('searches profiles in order only while Pro is on', async () => {
  const p = plugin(); await importBank(p); pro(true);
  const second = await p.importText('Engineering.csv', 'term,meaning\nbank,a row of switches', ',', { term: 0, meaning: 1 }, true, 'Engineering');
  expect(p.lookupTerm('bank').map((v) => v.meaning)).toEqual(['a row of switches']);
  p.settings.combined = true; expect(p.lookupTerm('bank').map((v) => v.meaning)).toEqual(['river edge', 'money service', 'a row of switches']);
  pro(false); expect(p.lookupTerm('bank').map((v) => v.meaning)).toEqual(['river edge', 'money service']);
  expect(p.settings.profiles).toHaveLength(2); expect(p.settings.activeId).toBe(second.id);
 });
 it('keeps the selected profile separate and can remove its snapshot with Pro', async () => {
  const p = plugin(); const first = await importBank(p); pro(true); const second = await p.importText('Other.csv', 'term,meaning\nx,y', ',', { term: 0, meaning: 1 }, true);
  expect(await p.selectProfile(first.id)).toBe(true); expect(p.currentProfile()?.id).toBe(first.id);
  expect(await p.removeProfile(second.id)).toBe(true); expect(p.indexes.has(second.id)).toBe(false); expect(p.settings.profiles).toHaveLength(1);
 });
});
describe('original editor insertion', () => {
 function capture(p: CsvGlossaryLookupPlugin) {
  let value = 'bank bank'; const file = { path: 'Study.md' }; const editor = { getValue: () => value, getRange: () => value.slice(0, 4), replaceRange: vi.fn((s: string) => { value = s + value.slice(4); }) };
  vi.spyOn(p.app.workspace, 'getActiveFile').mockReturnValue(file as never);
  const selection: Selection = { editor: editor as never, file: file as never, original: value, term: 'bank', from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } };
  return { editor, selection, change: (v: string) => { value = v; }, value: () => value };
 }
 it('inserts at the captured range even after a cursor move', () => { const p = plugin(), s = capture(p); expect(p.insert(s.selection, 'river edge')).toBe(true); expect(s.value()).toBe('river edge bank'); expect(s.editor.replaceRange).toHaveBeenCalledWith('river edge', { line: 0, ch: 0 }, { line: 0, ch: 4 }); });
 it('keeps captured editor state separate from the modal selection field', () => {
  const p = plugin(), s = capture(p);
  const modal = new ResultsModal(p, s.selection, [{ term: 'bank', meaning: 'river edge', row: 2, profile: 'Study' }]);
  Object.assign(modal, { selection: 'bank' });
  modal.onOpen();
  expect(modal.contentEl.querySelector('.csv-glossary-meaning')?.textContent).toBe('river edge');
  modal.contentEl.querySelector<HTMLButtonElement>('button')!.click();
  expect(s.value()).toBe('river edge bank');
 });
 it('keeps spaces at the ends of the selection', () => {
  const p = plugin(); let value = 'a bank b'; const file = { path: 'Study.md' };
  const editor = { getValue: () => value, getRange: () => value.slice(1, 7), replaceRange: vi.fn((s: string) => { value = value.slice(0, 1) + s + value.slice(7); }) };
  vi.spyOn(p.app.workspace, 'getActiveFile').mockReturnValue(file as never);
  const selection: Selection = { editor: editor as never, file: file as never, original: value, term: ' bank ', from: { line: 0, ch: 1 }, to: { line: 0, ch: 7 } };
  expect(p.insert(selection, 'river edge')).toBe(true); expect(value).toBe('a river edge b');
 });
 it('refuses a changed range and a same-term range that moved', () => { const p = plugin(), s = capture(p); s.change('bark bank'); expect(p.insert(s.selection, 'river edge')).toBe(false); s.change('bank bank suffix'); expect(p.insert(s.selection, 'river edge')).toBe(false); expect(s.editor.replaceRange).not.toHaveBeenCalled(); });
 it('refuses insertion after a file switch or plugin unload', () => { const p = plugin(), s = capture(p); vi.mocked(p.app.workspace.getActiveFile).mockReturnValue({ path: 'Other.md' } as never); expect(p.insert(s.selection, 'river edge')).toBe(false); p.onunload(); expect(p.insert(s.selection, 'river edge')).toBe(false); expect(s.editor.replaceRange).not.toHaveBeenCalled(); });
});
