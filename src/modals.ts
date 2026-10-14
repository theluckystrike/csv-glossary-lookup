import { Modal, Setting } from 'obsidian';
import { parseDelimited, MAX_BYTES, type Delimiter, type Mapping } from './glossary';
import { isPro } from './pro';
import type CsvGlossaryLookupPlugin from './main';
import { errorText, type Result, type Selection } from './main';
class GlossaryModal extends Modal {
 constructor(public plugin: CsvGlossaryLookupPlugin) { super(plugin.app); }
 onOpen(): void { this.plugin.modals.add(this); this.contentEl.addClass('csv-glossary'); }
 onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}
export class ImportModal extends GlossaryModal {
 private file: File | null = null;
 private text = '';
 private rows: string[][] = [];
 private delimiter: Delimiter = ',';
 private mapping: Mapping = { term: 0, meaning: 1 };
 private name = '';
 private hasHeader = true;
 private loadId = 0;
 private glossaryInput: HTMLInputElement | null = null;
 constructor(plugin: CsvGlossaryLookupPlugin, private add: boolean) { super(plugin); }
 onOpen(): void { super.onOpen(); this.draw(); }
 onClose(): void { this.loadId++; this.glossaryInput = null; super.onClose(); }
 private draw(): void {
  this.setTitle(this.add ? 'Add glossary profile' : 'Import a local glossary');
  const el = this.contentEl; el.empty();
  el.createEl('p', { text: 'Choose a comma-separated or tab-separated UTF-8 file up to 4 mebibytes. Use the header switch to identify the first row. Import stores a local snapshot.' });
  const label = el.createEl('label', { text: 'Glossary file ' });
  if (!this.glossaryInput) {
   const input = label.createEl('input', { attr: { type: 'file', accept: '.csv,.tsv,text/csv,text/tab-separated-values', 'aria-label': 'Glossary file' } });
   input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void this.preview(file); });
   this.glossaryInput = input;
  } else label.appendChild(this.glossaryInput);
  const status = el.createEl('p', { cls: 'csv-glossary-status', text: this.file ? `${this.file.name}: ${Math.max(0, this.rows.length - (this.hasHeader ? 1 : 0))} data rows` : 'No file selected.' });
  status.setAttribute('role', 'status');
  if (!this.rows.length) return;
  new Setting(el).setName('File format').addDropdown((d) => d.addOption(',', 'CSV').addOption('\t', 'TSV').setValue(this.delimiter).onChange((v) => { this.delimiter = v === '\t' ? '\t' : ','; if (this.file) void this.preview(this.file, false); }));
  new Setting(el).setName('First row has column names').addToggle((t) => t.setValue(this.hasHeader).onChange((v) => { this.hasHeader = v; this.mapping = { term: 0, meaning: 1 }; this.draw(); }));
  const headers = this.hasHeader ? this.rows[0]! : this.rows[0]!.map((_, i) => `Column ${i + 1}`);
  if (this.add) new Setting(el).setName('Profile name').addText((t) => t.setValue(this.name).onChange((v) => { this.name = v; }));
  for (const [key, name] of [['term', 'Term column'], ['meaning', 'Meaning column']] as const) {
   new Setting(el).setName(name).addDropdown((d) => { headers.forEach((header, i) => { d.addOption(String(i), `${i + 1}: ${header || '(empty header)'}`); }); d.setValue(String(this.mapping[key])).onChange((v) => { this.mapping[key] = Number(v); }); });
  }
  const wrap = el.createDiv({ cls: 'csv-glossary-preview' }), table = wrap.createEl('table');
  const head = table.createEl('thead').createEl('tr'); for (const value of headers) head.createEl('th', { text: value });
  const body = table.createEl('tbody'); for (const row of this.rows.slice(this.hasHeader ? 1 : 0, this.hasHeader ? 6 : 5)) { const tr = body.createEl('tr'); for (const value of row) tr.createEl('td', { text: value }); }
  new Setting(el).setName('Use mapped columns').setDesc('Blank terms or meanings are skipped. Invalid files leave the previous index in use.').addButton((b) => b.setButtonText('Use glossary').setCta().onClick(async () => {
   if (!this.file) return;
   b.setDisabled(true);
   try { await this.plugin.importText(this.file.name, this.text, this.delimiter, this.mapping, this.add, this.add ? this.name : (this.plugin.currentProfile()?.name ?? this.file.name), this.hasHeader); this.close(); }
   catch (e) { status.setText(`Import refused: ${errorText(e)}`); b.setDisabled(false); }
  }));
 }
 async preview(file: File, detect = true): Promise<void> {
  const id = ++this.loadId;
  this.contentEl.querySelector('.csv-glossary-status')?.setText('Reading and checking the file…');
  try {
   if (file.size > MAX_BYTES) throw new Error('The file is larger than 4 MiB.');
   const text = await this.plugin.readFile(file);
   const delimiter = detect ? (file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',') : this.delimiter;
   const rows = await parseDelimited(text, delimiter);
   if (id !== this.loadId) return;
   this.text = text; this.file = file; this.rows = rows; this.delimiter = delimiter; this.name = file.name;
   const headers = rows[0] ?? [];
   const term = headers.findIndex((v) => /^(term|word)$/i.test(v.trim())), meaning = headers.findIndex((v) => /^(meaning|definition)$/i.test(v.trim()));
   this.hasHeader = rows.length !== 1 || (term >= 0 && meaning >= 0);
   this.mapping = { term: term < 0 ? 0 : term, meaning: meaning < 0 ? 1 : meaning }; this.draw();
  } catch (e) { if (id === this.loadId) { this.file = null; this.rows = []; if (this.glossaryInput) this.glossaryInput.value = ''; this.draw(); this.contentEl.querySelector('.csv-glossary-status')?.setText(`File refused: ${errorText(e)} The previous glossary stays available.`); } }
 }
}
export class ResultsModal extends GlossaryModal {
 constructor(plugin: CsvGlossaryLookupPlugin, public capturedSelection: Selection, public results: Result[]) { super(plugin); }
 onOpen(): void {
  super.onOpen(); this.setTitle(`Meanings for “${this.capturedSelection.term.trim()}”`);
  this.contentEl.createEl('p', { text: `${this.results.length} exact ${this.results.length === 1 ? 'sense' : 'senses'}. Choose one meaning to replace the original selection.`, cls: 'csv-glossary-status' });
  if (!this.results.length) this.contentEl.createEl('p', { text: 'No exact term found. Check the selection, glossary, and case setting.' });
  this.results.forEach((sense, i) => {
   const card = this.contentEl.createDiv({ cls: 'csv-glossary-sense' });
   card.createEl('p', { text: `${sense.profile} · source row ${sense.row}`, cls: 'csv-glossary-source' });
   card.createDiv({ text: sense.meaning, cls: 'csv-glossary-meaning' });
   const button = card.createEl('button', { text: `Insert meaning ${i + 1}`, attr: { type: 'button' } });
   button.addEventListener('click', () => { if (this.plugin.insert(this.capturedSelection, sense.meaning)) this.close(); else { this.contentEl.querySelector('.csv-glossary-status')?.setText('The source note or range changed. Start a fresh lookup.'); this.contentEl.querySelectorAll('button').forEach((b) => { b.disabled = true; }); } });
  });
 }
}
export class ProfilesModal extends GlossaryModal {
 onOpen(): void {
  super.onOpen(); this.setTitle('Separate glossary profiles');
  if (!isPro()) { this.close(); return; }
  this.contentEl.createEl('p', { text: 'Choose a profile for exact lookup, or enable search across profiles in the plugin settings.' });
  for (const p of this.plugin.settings.profiles) {
   const s = new Setting(this.contentEl).setName(p.name).setDesc(`${p.fileName} · senses ${this.plugin.indexes.get(p.id)?.senses.length ?? 0}${p.id === this.plugin.settings.activeId ? ' · active' : ''}`);
   s.addButton((b) => b.setButtonText('Use profile').onClick(async () => { if (await this.plugin.selectProfile(p.id)) this.close(); }));
   s.addButton((b) => b.setButtonText('Remove snapshot').onClick(async () => { if (await this.plugin.removeProfile(p.id)) { this.contentEl.empty(); this.onOpen(); } }));
  }
  new Setting(this.contentEl).setName('New profile').addButton((b) => b.setButtonText('Add glossary').onClick(() => { this.close(); this.plugin.openImport(true); }));
 }
}
