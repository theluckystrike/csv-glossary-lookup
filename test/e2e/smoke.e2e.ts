import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
import type CsvGlossaryLookupPlugin from '../../src/main';
const csv = 'term,meaning\nbank,river edge\nbank,money service';
let noteNumber = 0;
async function readyNote() {
 const path = `Smoke ${++noteNumber}.md`;
 await obsidianPage.write(path, 'bank bank\n\nSample study note.');
 await obsidianPage.openFile(path);
 await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }, sourcePath) => {
  const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
  return app.workspace.getActiveFile()?.path === sourcePath && view?.editor.getValue() === 'bank bank\n\nSample study note.';
 }, path), { timeout: 10000, timeoutMsg: 'The source editor did not become ready.' });
}
async function lookupCommand(length = 4) {
 await browser.executeObsidian(({ app, obsidian }, n) => {
  const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
  editor.focus(); editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: n });
 }, length);
 await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }) => app.workspace.activeEditor?.editor === app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor), { timeout: 5000, timeoutMsg: 'The source editor did not receive focus.' });
 await browser.executeObsidianCommand(`${pluginId}:lookup-selection`);
 await browser.waitUntil(async () => (await browser.$('.csv-glossary-status').getText()).includes('exact'), { timeout: 5000 });
}
describe(`${pluginId} real editor and browser file flow`, function () {
 it('is enabled and reloads without captured errors', async () => {
  expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
 });
 beforeEach(async () => {
  await browser.executeObsidian(async ({ plugins }) => {
   const p = plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin;
   for (const modal of [...p.modals]) modal.close(); p.pro!.signOut(); p.settings.profiles = []; p.settings.activeId = ''; p.settings.combined = false; p.settings.ignoreCase = true; p.indexes.clear(); await p.saveSettings();
  });
  await readyNote();
 });
 afterEach(async () => {
  await browser.executeObsidian(({ plugins }) => { const p = plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin; for (const m of [...p.modals]) m.close(); p.pro!.signOut(); });
 });
 it('imports a browser file through preview and mapped columns', async () => {
  await browser.executeObsidianCommand(`${pluginId}:import-glossary`);
  await browser.executeObsidian(() => {
   const input = document.querySelector<HTMLInputElement>('.csv-glossary input[type=file]')!;
   const transfer = new DataTransfer(); transfer.items.add(new File(['definition,word\nriver edge,bank\nmoney service,bank'], 'Study.csv', { type: 'text/csv' })); input.files = transfer.files; input.dispatchEvent(new Event('change'));
  });
  await browser.waitUntil(async () => browser.executeObsidian(() => document.querySelectorAll('.csv-glossary-preview tbody tr').length === 2), { timeout: 10000 });
  expect(await browser.$('.csv-glossary-preview').getText()).toContain('river edge');
  expect(await browser.executeObsidian(() => document.querySelector<HTMLInputElement>('.csv-glossary input[type=file]')?.files?.[0]?.name)).toBe('Study.csv');
  await browser.executeObsidian(() => {
   for (const row of document.querySelectorAll<HTMLElement>('.csv-glossary .setting-item')) {
    const name = row.querySelector('.setting-item-name')?.textContent, select = row.querySelector('select');
    if (select && (name === 'Term column' || name === 'Meaning column')) { select.value = name === 'Term column' ? '1' : '0'; select.dispatchEvent(new Event('change')); }
   }
   [...document.querySelectorAll<HTMLButtonElement>('.csv-glossary button')].find((b) => b.textContent === 'Use glossary')!.click();
  });
  await browser.waitUntil(async () => browser.executeObsidian(({ plugins }) => (plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin).lookupTerm('bank').length === 2 && document.querySelector('.csv-glossary-preview') === null), { timeout: 10000 });
  await lookupCommand();
  expect(await browser.executeObsidian(() => [...document.querySelectorAll('.csv-glossary-meaning')].map((e) => e.textContent))).toEqual(['river edge', 'money service']);
 });
 it('imports the quoted single-row example as data without a header', async () => {
  await browser.executeObsidianCommand(`${pluginId}:import-glossary`);
  await browser.executeObsidian(() => {
   const input = document.querySelector<HTMLInputElement>('.csv-glossary input[type=file]')!;
   const transfer = new DataTransfer(); transfer.items.add(new File(['"ice, cream","cold, sweet"'], 'Dessert.csv')); input.files = transfer.files; input.dispatchEvent(new Event('change'));
  });
  await browser.waitUntil(async () => browser.executeObsidian(() => document.querySelectorAll('.csv-glossary-preview tbody tr').length === 1), { timeout: 10000 });
  expect(await browser.$('.csv-glossary-preview').getText()).toContain('cold, sweet');
  await browser.executeObsidian(() => { [...document.querySelectorAll<HTMLButtonElement>('.csv-glossary button')].find((b) => b.textContent === 'Use glossary')!.click(); });
  await browser.waitUntil(async () => browser.executeObsidian(({ plugins }) => (plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin).lookupTerm('ice, cream').length === 1 && document.querySelector('.csv-glossary-preview') === null), { timeout: 10000 });
  await browser.executeObsidian(({ app, obsidian }) => { app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setValue('ice, cream'); });
  await lookupCommand(10);
  expect(await browser.$('.csv-glossary-meaning').getText()).toBe('cold, sweet');
 });
 it('inserts at the original range after the cursor moves', async () => {
  await browser.executeObsidian(async ({ plugins }, text) => { await (plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin).importText('Study.csv', text, ',', { term: 0, meaning: 1 }); }, csv);
  await lookupCommand();
  await browser.executeObsidian(({ app, obsidian }) => { app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setCursor({ line: 0, ch: 9 }); document.querySelector<HTMLButtonElement>('.csv-glossary-sense button')!.click(); });
  expect(await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue())).toBe('river edge bank\n\nSample study note.');
 });
 it('refuses insertion after the source text changes', async () => {
  await browser.executeObsidian(async ({ plugins }, text) => { await (plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin).importText('Study.csv', text, ',', { term: 0, meaning: 1 }); }, csv);
  await lookupCommand();
  await browser.executeObsidian(({ app, obsidian }) => { app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.replaceRange('bark', { line: 0, ch: 0 }, { line: 0, ch: 4 }); document.querySelector<HTMLButtonElement>('.csv-glossary-sense button')!.click(); });
  expect(await browser.$('.csv-glossary-status').getText()).toContain('Start a fresh lookup');
  expect(await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue())).toBe('bark bank\n\nSample study note.');
 });
 it('refuses a broken reload and then uses an updated snapshot', async () => {
  const got = await browser.executeObsidian(async ({ plugins }, text) => {
   const p = plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin; await p.importText('Study.csv', text, ',', { term: 0, meaning: 1 });
   let refused = false; try { await p.importText('bad.csv', 'term,meaning\nbank,"broken', ',', { term: 0, meaning: 1 }); } catch { refused = true; }
   const kept = p.lookupTerm('bank').map((v) => v.meaning); await p.importText('Study.csv', 'term,meaning\nbank,new river meaning', ',', { term: 0, meaning: 1 });
   return { refused, kept, updated: p.lookupTerm('bank').map((v) => v.meaning) };
  }, csv);
  expect(got).toEqual({ refused: true, kept: ['river edge', 'money service'], updated: ['new river meaning'] });
  await browser.executeObsidianCommand(`${pluginId}:reload-glossary`);
  expect(await browser.$('.csv-glossary input[type=file]').isExisting()).toBe(true);
 });
 it('gates profiles and combined lookup through the Sponsors manager', async () => {
  const got = await browser.executeObsidian(async ({ app, plugins }, text) => {
   const p = plugins['csvGlossaryLookup'] as CsvGlossaryLookupPlugin; await p.importText('Study.csv', text, ',', { term: 0, meaning: 1 });
   let blocked = false; try { await p.importText('Engineering.csv', 'term,meaning\nbank,a row of switches', ',', { term: 0, meaning: 1 }, true); } catch { blocked = true; }
   const manager = p.pro as unknown as { opts: { http: () => Promise<unknown> }; refreshNow(): Promise<unknown>; signOut(): void };
   manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
   app.secretStorage.setSecret('csv-glossary-lookup-github-token', 'gho_' + '0'.repeat(36)); await manager.refreshNow();
   await p.importText('Engineering.csv', 'term,meaning\nbank,a row of switches', ',', { term: 0, meaning: 1 }, true, 'Engineering');
   p.settings.combined = true; const combined = p.lookupTerm('bank').map((v) => v.meaning); manager.signOut();
   return { blocked, combined, free: p.lookupTerm('bank').map((v) => v.meaning), saved: p.settings.profiles.length };
  }, csv);
  expect(got).toEqual({ blocked: true, combined: ['river edge', 'money service', 'a row of switches'], free: ['river edge', 'money service'], saved: 2 });
 });
});
