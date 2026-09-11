(() => {
  'use strict';
  const state = JSON.parse(document.getElementById('state').textContent);
  const storageKey = `nisi-editor:${state.id}:${state.baseRevision}`;
  const $ = selector => document.querySelector(selector);
  let artifact = null;
  let localAvailable = true;
  let providerLoading = typeof claude !== 'undefined' && typeof claude.use === 'function';
  let saving = false;
  let recovery = null;
  let editorReady = false;
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function syncFields() {
    if (!editorReady) return;
    state.about = $('#about').value;
    for (const section of state.sections) {
      const field = document.getElementById(`edit-${section.id}`);
      if (field) section.current = field.value;
    }
  }
  const snapshot = () => { syncFields(); return JSON.stringify({ about: state.about, sections: state.sections }); };
  let localSavedSnapshot = snapshot();
  let artifactSavedSnapshot = snapshot();
  function message(text) { $('#message').textContent = text; }
  function validSaved(value) {
    return value && value.id === state.id && value.baseRevision === state.baseRevision && value.schemaVersion === 1 &&
      typeof value.about === 'string' && Number.isFinite(value.savedAt) &&
      Array.isArray(value.sections) && value.sections.length > 0 &&
      value.sections.every(s => s && typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id) && typeof s.current === 'string' && typeof s.baseline === 'string') &&
      new Set(value.sections.map(s => s.id)).size === value.sections.length;
  }
  try {
    const restored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (validSaved(restored) && restored.savedAt > state.savedAt &&
        JSON.stringify({ about: restored.about, sections: restored.sections }) !== snapshot()) recovery = restored;
  } catch { localAvailable = false; }
  function persistLocal() {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...state, savedAt: Date.now() })); return true; }
    catch { localAvailable = false; return false; }
  }
  function titleOf(section) {
    const match = section.current.match(/^#{1,6}\s+(.+)$/m);
    return (match ? match[1] : 'Untitled section').replace(/[*`]/g, '');
  }
  function safeHref(value) {
    try {
      const url = new URL(value, 'https://github.com/louiscalata/nisi/blob/main/');
      return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '#';
    } catch { return '#'; }
  }
  function inline(text) {
    const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
    let out = '', end = 0;
    for (const m of text.matchAll(pattern)) {
      out += esc(text.slice(end, m.index)); const token = m[0];
      if (token[0] === '`') out += `<code>${esc(token.slice(1, -1))}</code>`;
      else if (token[0] === '[') {
        const link = token.match(/^\[([^\]]+)\]\((.+)\)$/);
        out += `<a href="${esc(safeHref(link[2]))}" target="_blank" rel="noopener noreferrer">${esc(link[1])}</a>`;
      } else if (token.startsWith('**')) out += `<strong>${esc(token.slice(2, -2))}</strong>`;
      else out += `<em>${esc(token.slice(1, -1))}</em>`;
      end = m.index + token.length;
    }
    return out + esc(text.slice(end));
  }
  function plateChart(code) {
    const nodes = Object.create(null), edges = [];
    const lines = code.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.shift() !== 'flowchart TD') return null;
    for (const line of lines) {
      const node = line.match(/^(\w+)\["([^"\n]+)"\]$/);
      const edge = line.match(/^(\w+)\s+-->\s*(?:\|([^|]+)\|\s*)?(\w+)$/);
      if (node && !nodes[node[1]]) nodes[node[1]] = node[2];
      else if (edge) edges.push({ from: edge[1], label: edge[2] || '', to: edge[3] });
      else return null;
    }
    const required = ['order', 'ingredients', 'cook', 'checks', 'pass', 'accept', 'repair', 'stop'];
    const topology = ['order:ingredients', 'ingredients:cook', 'cook:checks', 'checks:pass', 'pass:accept', 'pass:repair', 'pass:stop', 'repair:cook'];
    const optional = ['ingredients:stop', 'cook:stop', 'checks:repair', 'checks:stop'];
    const connections = edges.map(e => e.from + ':' + e.to);
    if (Object.keys(nodes).length !== required.length || required.some(id => !nodes[id]) ||
        new Set(connections).size !== edges.length || topology.some(edge => !connections.includes(edge)) ||
        connections.some(edge => !topology.includes(edge) && !optional.includes(edge))) return null;
    const label = id => nodes[id].split(' · ').map((part, index) => index ? `<span>${esc(part)}</span>` : `<strong>${esc(part)}</strong>`).join('');
    const edgeLabel = (from, to) => esc(edges.find(e => e.from === from && e.to === to)?.label || '');
    const steps = required.slice(0, 5).map((id, index) => {
      const exits = edges.filter(edge => edge.from === id && optional.includes(edge.from + ':' + edge.to));
      const branchLinks = exits.map(edge => `<p class="plate-stage-exit">↳ ${esc(edge.label || 'Stop')}: ${esc(nodes[edge.to].split(' · ')[0])}</p>`).join('');
      const forward = edgeLabel(id, required[index + 1]);
      return `<li><span class="plate-number">${index + 1}</span><div>${label(id)}${branchLinks}${forward ? `<p class="plate-forward">↓ ${forward}</p>` : ''}</div></li>`;
    }).join('');
    const branches = ['repair', 'accept', 'stop'].map(id => `<div class="plate-outcome ${id}"><p class="plate-condition">${edgeLabel('pass', id)}</p><div>${label(id)}</div>${id === 'repair' ? '<p class="plate-return">↩ Return to step 3; repeat checks and review</p>' : ''}</div>`).join('');
    return `<figure class="plate-flow" aria-label="Path of one plate: task, authorized context, candidate, checks and review. The displayed branches show completion, bounded repair and incomplete outcomes."><figcaption>WORKFLOW · ONE PLATE, ONE CANDIDATE</figcaption><ol class="plate-steps">${steps}</ol><div class="plate-branches">${branches}</div></figure>`;
  }
  function render(markdown) {
    const lines = markdown.split('\n'), out = []; let i = 0;
    const special = line => /^(#{1,6}\s|```|>\s|[-*]\s|\d+\.\s|\|)/.test(line);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (line.startsWith('```')) {
        const language = line.slice(3).trim();
        const code = []; i++;
        while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
        if (i < lines.length) i++;
        const chart = language === 'mermaid' ? plateChart(code.join('\n')) : null;
        out.push(chart || `<pre><code>${esc(code.join('\n'))}</code></pre>`); continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)/);
      if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
      if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => inline(cell.trim()));
        const header = cells(line), rows = []; i += 2;
        while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
        out.push(`<div class="table-scroll"><table><thead><tr>${header.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
      }
      if (/^>\s/.test(line)) {
        const quote = [];
        while (i < lines.length && /^>\s/.test(lines[i])) quote.push(lines[i++].replace(/^>\s/, ''));
        out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); continue;
      }
      const list = line.match(/^([-*]|\d+\.)\s+(.*)/);
      if (list) {
        const ordered = /^\d/.test(list[1]), items = [];
        const re = ordered ? /^\d+\.\s+(.*)/ : /^[-*]\s+(.*)/;
        while (i < lines.length && re.test(lines[i])) {
          let item = lines[i++].replace(re, '$1');
          while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ' ' + lines[i++].trim();
          items.push(`<li>${inline(item)}</li>`);
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.join('')}</${tag}>`); continue;
      }
      // Always consume at least one line, including incomplete Markdown while typing.
      const paragraph = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++]);
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }
    return out.join('\n');
  }
  function tally() {
    const words = state.sections.map(s => s.current).join(' ').trim().split(/\s+/).filter(Boolean).length;
    $('#stats').textContent = `${state.sections.length} sections · ${words.toLocaleString()} words`;
    const changed = snapshot() !== (artifact ? artifactSavedSnapshot : localSavedSnapshot);
    $('#save').disabled = saving || providerLoading;
    $('#save').textContent = providerLoading ? 'Connecting save…' : artifact ? 'Save private draft' : 'Save in browser';
    $('#storage').textContent = localAvailable ? (changed ? 'Edits backed up in this browser' : 'Draft ready to edit') : 'Browser backup unavailable · save or download your draft';
  }
  function onEdit() { persistLocal(); tally(); }
  function buildNav() {
    const nav = $('#contents'); nav.replaceChildren();
    state.sections.forEach((section, index) => {
      const link = document.createElement('a'); link.href = `#${section.id}`;
      link.textContent = `${String(index + 1).padStart(2, '0')}  ${titleOf(section)}`; nav.append(link);
    });
  }
  function buildSections() {
    const host = $('#sections'); host.replaceChildren();
    state.sections.forEach((section, index) => {
      const element = document.createElement('section'); element.id = section.id; element.className = 'editor-section';
      element.innerHTML = `<header class="section-bar"><span class="number">${String(index + 1).padStart(2, '0')}</span><span class="section-title"></span><span class="edited" hidden>Edited</span></header><div class="columns"><div class="writing"><label for="edit-${section.id}">Your text · Markdown</label><textarea id="edit-${section.id}" spellcheck="true"></textarea><details><summary>Read the starting draft</summary><pre class="baseline"></pre></details></div><div class="reading"><div class="preview-label">Safe preview · Markdown subset</div><div class="rendered"></div></div></div>`;
      const textarea = element.querySelector('textarea'), preview = element.querySelector('.rendered');
      const title = element.querySelector('.section-title');
      textarea.value = section.current;
      textarea.setAttribute('aria-label', `Edit ${titleOf(section)}`);
      element.querySelector('.baseline').textContent = section.baseline;
      const paint = () => {
        preview.innerHTML = render(section.current); title.textContent = titleOf(section);
        element.querySelector('.edited').hidden = section.current === section.baseline;
        textarea.style.height = 'auto'; textarea.style.height = Math.max(180, Math.min(520, textarea.scrollHeight + 6)) + 'px';
      };
      // Native typing stays untouched. Repaint only after the user leaves the field.
      textarea.addEventListener('change', () => { section.current = textarea.value; paint(); buildNav(); onEdit(); });
      host.append(element); paint();
    });
    buildNav(); tally();
  }
  function allMarkdown() { syncFields(); return state.sections.map(s => s.current).join(''); }
  function buildDocument() {
    syncFields();
    const json = JSON.stringify({ ...state, savedAt: Date.now() }).replace(/</g, '\\u003c');
    const css = document.getElementById('editor-style').textContent;
    const app = document.getElementById('editor-app').textContent;
    const markup = document.getElementById('chrome').innerHTML;
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nisi on GitHub — Brigade Draft</title><style id="editor-style">' + css + '</style></head><body><script id="state" type="application/json">' + json + '<' + '/script>' + markup + '<template id="chrome">' + markup + '</template><script id="editor-app">' + app + '<' + '/script></body></html>';
  }
  function download(name, contents, type) {
    const blob = new Blob([contents], { type }), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $('#about').value = state.about;
  $('#about-preview').textContent = state.about;
  $('#about').addEventListener('change', event => { state.about = event.target.value; $('#about-preview').textContent = state.about; onEdit(); });
  if (recovery) $('#recovery').hidden = false;
  $('#restore').addEventListener('click', () => {
    if (!recovery) return;
    const baseline = new Map(state.sections.map(s => [s.id, s.baseline]));
    state.about = recovery.about;
    state.sections = recovery.sections.map(s => ({ id: s.id, current: s.current, baseline: baseline.get(s.id) ?? '' }));
    $('#about').value = state.about; $('#about-preview').textContent = state.about;
    $('#recovery').hidden = true; recovery = null; buildSections(); onEdit();
    message('Browser edits restored. Save this version or download it.');
  });
  $('#keep').addEventListener('click', () => { $('#recovery').hidden = true; message('Keeping this document. The older browser backup is unchanged until you edit or save.'); });
  $('#backup').addEventListener('click', () => { if (recovery) download('Nisi-recovered-backup.md', recovery.sections.map(s => s.current).join(''), 'text/markdown;charset=utf-8'); });
  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(allMarkdown()); message('README Markdown copied.'); }
    catch { message('Clipboard unavailable. Use Download Markdown.'); }
  });
  $('#download').addEventListener('click', () => { download('Nisi-README-draft.md', allMarkdown(), 'text/markdown;charset=utf-8'); message('Markdown download requested.'); });
  $('#download-html').addEventListener('click', () => { download('Nisi-Brigade-editor.html', buildDocument(), 'text/html;charset=utf-8'); message('Editable HTML download requested.'); });
  $('#add').addEventListener('click', () => {
    const section = { id: `section-${Date.now()}-${state.sections.length}`, current: '\n\n## New section\n\nWrite your section here.\n', baseline: '' };
    state.sections.push(section); buildSections(); onEdit();
    document.getElementById(`edit-${section.id}`).focus();
  });
  $('#save').addEventListener('click', async () => {
    saving = true; tally();
    document.querySelectorAll('textarea').forEach(element => { element.disabled = true; });
    $('#add').disabled = true; $('#restore').disabled = true;
    const savingSnapshot = snapshot();
    if (artifact) {
      message('Saving this private draft…');
      try { await artifact.publish(buildDocument()); artifactSavedSnapshot = savingSnapshot; localSavedSnapshot = savingSnapshot; persistLocal(); message('Draft saved. GitHub has not changed.'); }
      catch (error) { message(error?.code === 'conflict' ? 'Another version was saved. Your browser backup remains available; export your text before reloading.' : 'Could not save to Claude. Your text is still here; download a copy.'); }
    } else {
      if (persistLocal()) { localSavedSnapshot = savingSnapshot; message('Saved in this browser. Download a copy to keep it elsewhere.'); }
      else message('Browser storage is unavailable. Download Markdown or editable HTML to keep your work.');
    }
    saving = false;
    document.querySelectorAll('textarea').forEach(element => { element.disabled = false; });
    $('#add').disabled = false; $('#restore').disabled = false; tally();
  });
  window.addEventListener('beforeunload', event => {
    if (snapshot() !== localSavedSnapshot && !persistLocal()) { event.preventDefault(); event.returnValue = ''; }
  });
  buildSections();
  editorReady = true;
  $('#editor-build').textContent = `Editor ${state.editorBuild.slice(0, 8)} · preview refreshes after leaving a text box`;
  let lastBackup = snapshot();
  setInterval(() => {
    // Read and back up values without altering DOM, layout, focus or selection.
    const current = snapshot();
    if (current !== lastBackup && persistLocal()) lastBackup = current;
  }, 750);
  (async () => {
    try { if (typeof claude !== 'undefined' && typeof claude.use === 'function') artifact = await claude.use('artifact'); }
    catch { message('Claude save is unavailable; browser backup and downloads still work.'); }
    finally { providerLoading = false; tally(); }
  })();
})();
