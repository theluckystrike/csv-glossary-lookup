import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import { MAX_BYTES, type Delimiter, type Mapping } from './glossary';
import type CsvGlossaryLookupPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface Profile { id: string; name: string; fileName: string; text: string; delimiter: Delimiter; mapping: Mapping; hasHeader: boolean }
export interface CsvGlossaryLookupSettings { ignoreCase: boolean; combined: boolean; activeId: string; profiles: Profile[] }
export const DEFAULT_SETTINGS: CsvGlossaryLookupSettings = { ignoreCase: true, combined: false, activeId: '', profiles: [] };
export function normalizeSettings(saved: Partial<CsvGlossaryLookupSettings> | null | undefined): CsvGlossaryLookupSettings {
 const profiles: Profile[] = [];
 if (Array.isArray(saved?.profiles)) for (const p of saved.profiles) {
  if (p && typeof p.id === 'string' && !profiles.some((v) => v.id === p.id) && typeof p.name === 'string' && typeof p.fileName === 'string' && typeof p.text === 'string' && new TextEncoder().encode(p.text).byteLength <= MAX_BYTES && (p.delimiter === ',' || p.delimiter === '\t') && Number.isInteger(p.mapping?.term) && Number.isInteger(p.mapping?.meaning)) profiles.push({ ...p, hasHeader: p.hasHeader !== false });
 }
 return { ignoreCase: typeof saved?.ignoreCase === 'boolean' ? saved.ignoreCase : true, combined: saved?.combined === true, activeId: profiles.some((p) => p.id === saved?.activeId) ? saved!.activeId! : (profiles[0]?.id ?? ''), profiles };
}
export class CsvGlossaryLookupSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: CsvGlossaryLookupPlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  const p = this.plugin;
  return [
   { name: 'Ignore case', desc: 'Match Bank with bank. Lookups use the complete selected term.', control: { type: 'toggle', key: 'ignoreCase', defaultValue: true } },
   { name: 'Local glossary', desc: p.currentProfile() ? `${p.currentProfile()!.name}: ${p.currentProfile()!.fileName}. Imported snapshot; no file watcher.` : 'Import a UTF-8 CSV or TSV file, up to 4 MiB.', render: (s) => { s.addButton((b) => b.setButtonText('Import glossary').onClick(() => p.openImport())); } },
   { name: 'Separate profiles (Pro)', desc: 'Keep glossaries for different subjects. Without Pro, lookup uses the first profile.', render: (s) => { s.addButton((b) => b.setButtonText('Manage profiles').onClick(() => p.openProfiles())); } },
   { name: 'Search several glossaries (Pro)', desc: 'Search the stored profiles in profile order.', control: { type: 'toggle', key: 'combined', defaultValue: false, disabled: () => !isPro() } },
   ...(p.pro ? sponsorsSettingItems(p.pro, PRO_UI) : []),
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  if (key === 'combined' && !isPro()) return;
  await super.setControlValue(key, value);
 }
}
