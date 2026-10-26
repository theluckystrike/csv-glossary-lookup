import { Plugin, Notice, type Editor, type TFile, type Modal } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { buildGlossary, parseDelimited, lookup, canInsert, MAX_BYTES, type Glossary, type Mapping, type Delimiter, type Sense } from './glossary';
import { CsvGlossaryLookupSettingTab, DEFAULT_SETTINGS, normalizeSettings, type CsvGlossaryLookupSettings, type Profile } from './settings';
import { ImportModal, ProfilesModal, ResultsModal } from './modals';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export interface Result extends Sense { profile: string }
export interface Selection { editor: Editor; file: TFile | null; original: string; term: string; from: { line: number; ch: number }; to: { line: number; ch: number } }
export default class CsvGlossaryLookupPlugin extends Plugin {
 settings: CsvGlossaryLookupSettings = { ...DEFAULT_SETTINGS, profiles: [] };
 pro: SponsorsManager | null = null;
 indexes = new Map<string, Glossary>();
 settingTab: CsvGlossaryLookupSettingTab | null = null;
 private revision = 0;
 private stopped = false;
 readonly modals = new Set<Modal>();
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  this.settingTab = new CsvGlossaryLookupSettingTab(this.app, this); this.addSettingTab(this.settingTab);
  this.register(pro.onChange(() => this.settingTab?.update()));
  this.addCommand({ id: 'import-glossary', name: 'Import a local glossary', callback: () => this.openImport() });
  this.addCommand({ id: 'reload-glossary', name: 'Reload the glossary', callback: () => { void this.reloadGlossary(); } });
  this.addCommand({ id: 'lookup-selection', name: 'Look up selected text', editorCallback: (editor, ctx) => { this.openLookup(editor, ctx.file); } });
  this.addCommand({ id: 'profiles', name: 'Manage glossary profiles', callback: () => this.openProfiles() });
  this.app.workspace.onLayoutReady(() => { void this.loadIndexes(); void pro.refresh(); this.registerInterval(window.setInterval(() => { void pro.refresh(); }, 6 * 60 * 60 * 1000)); });
 }
 onunload(): void { this.stopped = true; this.revision++; for (const modal of this.modals) modal.close(); this.indexes.clear(); resetPro(); }
 async loadSettings(): Promise<void> {
  this.settings = normalizeSettings(await this.loadData() as Partial<CsvGlossaryLookupSettings> | null);
 }
 /** Rebuilds stored snapshots after layout ready so that large glossaries do not slow app start. */
 async loadIndexes(): Promise<void> {
  for (const p of this.settings.profiles) {
   if (this.stopped) return;
   try {
    const glossary = await buildGlossary(await parseDelimited(p.text, p.delimiter), p.mapping, undefined, p.hasHeader);
    // An import or removal during the rebuild replaces the profile object; keep its newer state.
    if (!this.stopped && this.settings.profiles.includes(p)) this.indexes.set(p.id, glossary);
   } catch (e) { new Notice(`Could not load ${p.name}: ${errorText(e)}`); }
  }
 }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 currentProfile(): Profile | undefined { return (isPro() ? this.settings.profiles.find((p) => p.id === this.settings.activeId) : this.settings.profiles[0]) ?? this.settings.profiles[0]; }
 requirePro(): boolean { if (isPro()) return true; proNotice('This is a pro feature.'); return false; }
 openImport(add = false): void { if (add && !this.requirePro()) return; new ImportModal(this, add).open(); }
 openProfiles(): void { if (this.requirePro()) new ProfilesModal(this).open(); }
 async importText(fileName: string, text: string, delimiter: Delimiter, mapping: Mapping, add = false, name = fileName, hasHeader = true): Promise<Profile> {
  if (this.stopped) throw new Error('The plugin is unloaded.');
  if (add && !isPro()) throw new Error('Separate profiles need Pro.');
  const revision = ++this.revision;
  const glossary = await buildGlossary(await parseDelimited(text, delimiter), mapping, undefined, hasHeader);
  if (this.stopped || revision !== this.revision) throw new Error('A newer import replaced this operation.');
  if (add && !isPro()) throw new Error('Separate profiles need Pro.');
  const current = add ? undefined : this.currentProfile();
  const profile: Profile = { id: current?.id ?? crypto.randomUUID(), name: name.trim() || fileName, fileName, text, delimiter, mapping, hasHeader };
  const profiles = current ? this.settings.profiles.map((p) => p.id === current.id ? profile : p) : [...this.settings.profiles, profile];
  const next = { ...this.settings, profiles, activeId: profile.id };
  await this.saveData(next);
  if (this.stopped || revision !== this.revision) throw new Error('A newer import replaced this operation.');
  this.settings = next; this.indexes.set(profile.id, glossary); this.settingTab?.update(); return profile;
 }
 async readFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('The file is larger than 4 MiB.');
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('The file is not valid UTF-8. Save it as UTF-8 and retry.'); }
 }
 async reloadGlossary(): Promise<void> {
  this.openImport(); new Notice('Select the updated source file to reload its snapshot.'); await Promise.resolve();
 }
 lookupTerm(term: string): Result[] {
  const profiles = isPro() && this.settings.combined ? this.settings.profiles : [this.currentProfile()].filter((p): p is Profile => !!p);
  return profiles.flatMap((p) => { const g = this.indexes.get(p.id); return g ? lookup(g, term, this.settings.ignoreCase).map((sense) => ({ ...sense, profile: p.name })) : []; });
 }
 openLookup(editor: Editor, file: TFile | null): ResultsModal | null {
  const term = editor.getSelection();
  if (!term.trim()) { new Notice('Select a term in the editor first.'); return null; }
  if (!this.currentProfile()) { new Notice('Import a glossary first.'); return null; }
  const selection: Selection = { editor, file, term, original: editor.getValue(), from: { ...editor.getCursor('from') }, to: { ...editor.getCursor('to') } };
  const modal = new ResultsModal(this, selection, this.lookupTerm(term)); modal.open(); return modal;
 }
 insert(selection: Selection, meaning: string): boolean {
  const { editor, from, to } = selection;
  if (this.stopped || !canInsert(selection.original, editor.getValue(), selection.term, editor.getRange(from, to), this.app.workspace.getActiveFile() === selection.file && selection.file !== null)) {
   new Notice('The source note or range changed. Start a fresh lookup.'); return false;
  }
  // Lookup trims the selection, so keep the outer spaces of the selection in the note.
  const term = selection.term, lead = term.slice(0, term.length - term.trimStart().length), trail = term.slice(term.trimEnd().length);
  editor.replaceRange(lead + meaning + trail, from, to); return true;
 }
 async selectProfile(id: string): Promise<boolean> {
  if (!this.requirePro() || !this.settings.profiles.some((p) => p.id === id)) return false;
  this.settings.activeId = id; await this.saveSettings(); this.settingTab?.update(); return true;
 }
 async removeProfile(id: string): Promise<boolean> {
  if (!this.requirePro()) return false;
  this.settings.profiles = this.settings.profiles.filter((p) => p.id !== id);
  this.indexes.delete(id);
  this.settings.activeId = this.settings.profiles[0]?.id ?? ''; await this.saveSettings(); this.settingTab?.update(); return true;
 }
}
export function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }
