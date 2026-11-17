import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../docs/editor/editor.js', import.meta.url), 'utf8');
const NOW = 1700000000000;
const initial = () => ({
  schemaVersion: 1, id: 'editor-test', baseRevision: 'a'.repeat(64), savedAt: 100,
  about: 'About this draft',
  sections: [{ id: 'section-one', current: '# One\n\nOriginal.\n', baseline: '# Starting draft\n' }],
  editorBuild: 'b'.repeat(64),
});
const saved = () => ({ ...initial(), savedAt: 101, about: 'Recovered about', sections: [
  { id: 'section-one', current: '# Recovered\n', baseline: 'Untrusted baseline' },
  { id: 'new-section', current: '\n## New\n', baseline: 'Also untrusted' },
] });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Only the DOM operations used by the editor are modeled; no HTML engine or browser.
function editor({ backup = null, readFails = false, writeFails = false, provider, clipboardFails = false, documentState = initial(), appSource = source } = {}) {
  const elements = new Map(), created = [], intervals = [], timeouts = [], downloads = [], writes = [], uses = [], copied = [];
  const storage = new Map(backup === null ? [] : [[`nisi-editor:editor-test:${'a'.repeat(64)}`, typeof backup === 'string' ? backup : JSON.stringify(backup)]]);
  const faults = { readFails, writeFails };
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.listeners = new Map(); this.children = []; this.parts = new Map();
      this.value = ''; this.textContent = ''; this.hidden = true; this.disabled = false;
      this.style = {}; this.scrollHeight = 200; this.selectionStart = 0; this.selectionEnd = 0;
      this.htmlWrites = 0; created.push(this);
    }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this._text = value; this.textWrites = (this.textWrites || 0) + 1; }
    get textContent() { return this._text; }
    set innerHTML(value) {
      this._html = value; this.htmlWrites++;
      const textareaId = value.match(/<textarea id="([^"]+)"/);
      if (textareaId) { const field = new Element('textarea'); field.id = textareaId[1]; this.parts.set('textarea', field); }
    }
    get innerHTML() { return this._html || ''; }
    querySelector(selector) {
      if (!this.parts.has(selector)) this.parts.set(selector, new Element());
      return this.parts.get(selector);
    }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); }
    async fire(name, event = {}) { event.target ??= this; for (const listener of this.listeners.get(name) || []) await listener(event); }
    async click() {
      if (this.disabled) return;
      if (this.download) downloads.push({ name: this.download, blob: blobs.get(this.href) });
      await this.fire('click');
    }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    remove() {}
    focus() { document.activeElement = this; }
  }
  for (const id of ['state', 'editor-style', 'editor-app', 'chrome', 'about', 'about-preview', 'recovery', 'restore', 'keep', 'backup', 'copy', 'download', 'download-html', 'add', 'save', 'storage', 'stats', 'contents', 'sections', 'message', 'editor-build']) {
    const element = new Element(id === 'about' ? 'textarea' : 'div'); element.id = id;
  }
  elements.get('state').textContent = JSON.stringify(documentState);
  elements.get('editor-app').textContent = appSource;
  elements.get('editor-style').textContent = '/* retained style */';
  elements.get('chrome').innerHTML = '<main>retained chrome</main>';
  const document = {
    getElementById: id => elements.get(id),
    querySelector: selector => elements.get(selector.slice(1)),
    querySelectorAll: selector => { assert.equal(selector, 'textarea'); return [elements.get('about'), ...elements.get('sections').children.map(s => s.querySelector('textarea'))]; },
    createElement: tag => new Element(tag), body: new Element('body'), activeElement: null,
  };
  const blobs = new Map();
  class TestURL extends URL {
    static createObjectURL(blob) { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  const window = new Element('window');
  const context = {
    document, window, URL: TestURL, Blob, Date: class extends Date { static now() { return NOW; } },
    localStorage: {
      getItem(key) { if (faults.readFails) throw new Error('storage read failed'); return storage.get(key) ?? null; },
      setItem(key, value) { if (faults.writeFails) throw new Error('storage write failed'); storage.set(key, value); writes.push({ key, value }); },
    },
    navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw new Error('clipboard unavailable'); copied.push(value); } } },
    setInterval(fn, ms) { intervals.push({ fn, ms }); }, setTimeout(fn, ms) { timeouts.push({ fn, ms }); },
  };
  if (provider) context.claude = { use(name) { uses.push(name); return provider(); } };
  vm.runInNewContext(appSource, context, { filename: 'editor.js' });
  return {
    get: id => elements.get(id), created, intervals, timeouts, downloads, writes, storage, faults, uses, copied, document,
    async ready() { await Promise.resolve(); await Promise.resolve(); },
    tick() { assert.equal(intervals.length, 1); assert.equal(intervals[0].ms, 750); intervals[0].fn(); },
    async edit(value = '# One\n\nEdited.\n') { const field = elements.get('edit-section-one'); field.value = value; await field.fire('change'); },
    async unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; await window.fire('beforeunload', event); return event; },
  };
}

export { NOW, source, initial, saved, deferred, editor };
