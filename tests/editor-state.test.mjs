import assert from 'node:assert/strict';
import test from 'node:test';
import { NOW, source, initial, saved, deferred, editor } from './editor-support.mjs';

test('browser save pins storage key, JSON shape, timestamp, labels and saved snapshot', async () => {
  const e = editor(); await e.ready();
  assert.equal(e.get('save').textContent, 'Save in browser');
  assert.equal(e.get('save').disabled, false);
  assert.equal(e.get('storage').textContent, 'Draft ready to edit');
  await e.edit();
  assert.equal(e.get('storage').textContent, 'Edits backed up in this browser');
  await e.get('save').click();
  assert.equal(e.get('message').textContent, 'Saved in this browser. Download a copy to keep it elsewhere.');
  assert.equal(e.get('storage').textContent, 'Draft ready to edit');
  const last = e.writes.at(-1);
  assert.equal(last.key, `nisi-editor:editor-test:${'a'.repeat(64)}`);
  assert.deepEqual(JSON.parse(last.value), { ...initial(), savedAt: NOW, sections: [{ ...initial().sections[0], current: '# One\n\nEdited.\n' }] });
  e.faults.writeFails = true;
  assert.equal((await e.unload()).prevented, false, 'explicitly saved content does not require another backup');
});

test('failed browser save keeps dirty content and existing warning words', async () => {
  const e = editor({ writeFails: true }); await e.ready(); await e.edit(); await e.get('save').click();
  assert.equal(e.get('message').textContent, 'Browser storage is unavailable. Download Markdown or editable HTML to keep your work.');
  assert.equal(e.get('storage').textContent, 'Browser backup unavailable · save or download your draft');
  assert.equal(e.get('edit-section-one').value, '# One\n\nEdited.\n');
  assert.equal((await e.unload()).prevented, true);
  assert.equal((await e.unload()).returnValue, '');
});

test('provider connection disables ordinary saving until private or browser route resolves', async () => {
  for (const result of ['private', 'null', 'error']) {
    const pending = deferred(); const e = editor({ provider: () => pending.promise });
    assert.deepEqual(e.uses, ['artifact']);
    assert.equal(e.get('save').textContent, 'Connecting save…');
    assert.equal(e.get('save').disabled, true);
    await e.get('save').click(); assert.equal(e.writes.length, 0);
    if (result === 'error') pending.reject(new Error('unavailable'));
    else pending.resolve(result === 'private' ? { publish() {} } : null);
    await e.ready();
    assert.equal(e.get('save').disabled, false);
    assert.equal(e.get('save').textContent, result === 'private' ? 'Save private draft' : 'Save in browser');
    assert.equal(e.get('message').textContent, result === 'error' ? 'Claude save is unavailable; browser backup and downloads still work.' : '');
  }
});

for (const outcome of ['success', 'conflict', 'error', 'success without browser storage']) {
  test(`private publish ${outcome} pins words, snapshots and control locking`, async () => {
    const pending = deferred(), published = [];
    const e = editor({ provider: async () => ({ publish(html) { published.push(html); return pending.promise; } }) });
    await e.ready(); await e.edit();
    const saving = e.get('save').click();
    assert.equal(e.get('message').textContent, 'Saving this private draft…');
    for (const id of ['save', 'about', 'edit-section-one', 'add', 'restore']) assert.equal(e.get(id).disabled, true, id);
    assert.equal(published.length, 1); assert.ok(published[0].startsWith('<!doctype html>'));
    if (outcome.startsWith('success')) { e.faults.writeFails = outcome.includes('without'); pending.resolve(); }
    else pending.reject({ code: outcome });
    await saving;
    assert.equal(e.get('message').textContent, outcome.startsWith('success') ? 'Draft saved. GitHub has not changed.' : outcome === 'conflict' ? 'Another version was saved. Your browser backup remains available; export your text before reloading.' : 'Could not save to Claude. Your text is still here; download a copy.');
    for (const id of ['save', 'about', 'edit-section-one', 'add', 'restore']) assert.equal(e.get(id).disabled, false, id);
    assert.equal(e.get('storage').textContent, outcome.includes('without') ? 'Browser backup unavailable · save or download your draft' : outcome === 'success' ? 'Draft ready to edit' : 'Edits backed up in this browser');
    e.faults.writeFails = true;
    assert.equal((await e.unload()).prevented, !outcome.startsWith('success'), 'publish failure does not advance saved snapshots');
  });
}

test('recovery admission pins identity, schema, timestamps, content and section validation', async () => {
  const cases = [
    [saved(), true], [{ ...saved(), id: 'other' }, false], [{ ...saved(), baseRevision: 'other' }, false],
    [{ ...saved(), schemaVersion: 2 }, false], [{ ...saved(), savedAt: 100 }, false],
    [{ ...saved(), savedAt: 99 }, false], [{ ...saved(), savedAt: null }, false],
    [{ ...initial(), savedAt: 101 }, false], [{ ...saved(), about: null }, false],
    [{ ...saved(), sections: [] }, false], [{ ...saved(), sections: [saved().sections[0], saved().sections[0]] }, false],
    ...[{ id: 'Bad ID' }, { current: null }, { baseline: null }].map(patch => [{ ...saved(), sections: [{ ...saved().sections[0], ...patch }] }, false]),
  ];
  for (const [backup, offered] of cases) {
    const e = editor({ backup }); await e.ready();
    assert.equal(e.get('recovery').hidden, !offered, JSON.stringify(backup));
    assert.equal(e.writes.length, 0, 'opening never overwrites recovery');
  }
  for (const options of [{ backup: '{bad JSON' }, { readFails: true }]) {
    const e = editor(options); await e.ready();
    assert.equal(e.get('recovery').hidden, true);
    assert.equal(e.get('storage').textContent, 'Browser backup unavailable · save or download your draft');
  }
});

test('restore uses document baselines, persists recovered content and consumes recovery', async () => {
  const e = editor({ backup: saved() }); await e.ready(); await e.get('restore').click();
  assert.equal(e.get('recovery').hidden, true);
  assert.equal(e.get('message').textContent, 'Browser edits restored. Save this version or download it.');
  assert.equal(e.get('about').value, 'Recovered about');
  const stored = JSON.parse(e.writes.at(-1).value);
  assert.deepEqual(stored.sections, saved().sections.map(s => ({ ...s, baseline: s.id === 'section-one' ? initial().sections[0].baseline : '' })));
  assert.equal(e.get('storage').textContent, 'Edits backed up in this browser');
  await e.get('restore').click(); await e.get('backup').click();
  assert.equal(e.writes.length, 1); assert.equal(e.downloads.length, 0);
});

test('keep hides recovery without writing or discarding its downloadable payload', async () => {
  const e = editor({ backup: saved() }); await e.ready();
  const bytes = [...e.storage.values()][0]; await e.get('keep').click(); e.tick();
  assert.equal(e.get('recovery').hidden, true);
  assert.equal(e.get('message').textContent, 'Keeping this document. The older browser backup is unchanged until you edit or save.');
  assert.equal(e.writes.length, 0); assert.equal([...e.storage.values()][0], bytes);
  await e.get('backup').click();
  assert.equal(e.downloads[0].name, 'Nisi-recovered-backup.md');
  assert.equal(await e.downloads[0].blob.text(), saved().sections.map(s => s.current).join(''));
});

test('typing and periodic backup preserve focus, selection and preview until change', async () => {
  const e = editor(); await e.ready();
  const field = e.get('edit-section-one'), preview = e.get('sections').children[0].querySelector('.rendered');
  const html = preview.innerHTML, style = { ...field.style };
  const statsWrites = e.get('stats').textWrites, saveWrites = e.get('save').textWrites;
  field.focus(); field.selectionStart = 4; field.selectionEnd = 6;
  field.value = '# Typed\n\nEnter\nBackspace\tTab\n'; e.get('about').value = 'Typed about';
  await field.fire('input'); assert.equal(e.writes.length, 0);
  e.tick(); assert.equal(e.writes.length, 1); e.tick(); assert.equal(e.writes.length, 1);
  assert.equal(e.document.activeElement, field); assert.equal(field.selectionStart, 4); assert.equal(field.selectionEnd, 6);
  assert.deepEqual(field.style, style); assert.equal(preview.innerHTML, html);
  assert.equal(e.get('stats').textWrites, statsWrites); assert.equal(e.get('save').textWrites, saveWrites);
  assert.equal(e.get('about-preview').textContent, initial().about);
  const stored = JSON.parse(e.writes[0].value); assert.equal(stored.about, 'Typed about'); assert.equal(stored.sections[0].current, field.value);
  await field.fire('change'); assert.notEqual(preview.innerHTML, html);
  await e.get('about').fire('change'); assert.equal(e.get('about-preview').textContent, 'Typed about');
  assert.deepEqual([...new Set(e.created.flatMap(element => [...element.listeners.keys()]))].sort(), ['beforeunload', 'change', 'click']);
});

test('beforeunload backs up unsaved raw values and prompts only on dirty failed persistence', async () => {
  const e = editor({ writeFails: true }); await e.ready();
  assert.equal((await e.unload()).prevented, false);
  e.get('about').value = 'Unsaved raw value';
  assert.equal((await e.unload()).prevented, true);
  e.faults.writeFails = false;
  assert.equal((await e.unload()).prevented, false);
  assert.equal(JSON.parse(e.writes[0].value).about, 'Unsaved raw value');
});

test('exports and clipboard pin filenames, MIME types, Markdown bytes and HTML JSON shape', async () => {
  const e = editor(); await e.ready();
  const text = '# One  \r\nCafé & "quotes"\n</script>\n';
  e.get('edit-section-one').value = text; e.get('about').value = 'HTML only';
  await e.get('copy').click(); assert.deepEqual(e.copied, [text]);
  assert.equal(e.get('message').textContent, 'README Markdown copied.');
  await e.get('download').click(); assert.equal(e.get('message').textContent, 'Markdown download requested.');
  await e.get('download-html').click(); assert.equal(e.get('message').textContent, 'Editable HTML download requested.');
  assert.deepEqual(e.downloads.map(d => [d.name, d.blob.type]), [['Nisi-README-draft.md', 'text/markdown;charset=utf-8'], ['Nisi-Brigade-editor.html', 'text/html;charset=utf-8']]);
  assert.equal(await e.downloads[0].blob.text(), text);
  const html = await e.downloads[1].blob.text();
  const json = html.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.ok(!json.includes('<'));
  assert.deepEqual(JSON.parse(json), { ...initial(), savedAt: NOW, about: 'HTML only', sections: [{ ...initial().sections[0], current: text }] });
  assert.ok(html.includes(`<script id="editor-app">${source}</script>`));
  assert.ok(html.includes('<template id="chrome"><main>retained chrome</main></template>'));
  assert.deepEqual(e.timeouts.map(t => t.ms), [10000, 10000]);
  const failed = editor({ clipboardFails: true }); await failed.ready(); await failed.get('copy').click();
  assert.equal(failed.get('message').textContent, 'Clipboard unavailable. Use Download Markdown.');
});

test('adding a section preserves its ID format, baseline, text and focus', async () => {
  const e = editor(); await e.ready(); await e.get('add').click();
  const added = JSON.parse(e.writes.at(-1).value).sections.at(-1);
  assert.deepEqual(added, { id: `section-${NOW}-1`, current: '\n\n## New section\n\nWrite your section here.\n', baseline: '' });
  assert.equal(e.document.activeElement, e.get(`edit-${added.id}`));
});

for (const failure of ['read', 'write']) {
  test(`regression: successful edit backup recovers from ${failure} failure`, async () => {
    const e = editor({ readFails: failure === 'read', writeFails: failure === 'write' }); await e.ready();
    if (failure === 'write') await e.edit();
    assert.equal(e.get('storage').textContent, 'Browser backup unavailable · save or download your draft');
    e.faults.writeFails = false; await e.edit('# Recovered storage\n');
    assert.equal(e.writes.length, 1);
    assert.equal(e.get('storage').textContent, 'Edits backed up in this browser');
  });
}

test('regression: successful explicit browser save clears stale backup warning', async () => {
  const e = editor({ writeFails: true }); await e.ready(); await e.edit();
  e.faults.writeFails = false; await e.get('save').click();
  assert.equal(e.get('message').textContent, 'Saved in this browser. Download a copy to keep it elsewhere.');
  assert.equal(e.get('storage').textContent, 'Draft ready to edit');
});

test('regression: periodic backup failure and recovery refresh the footer without repainting', async () => {
  const e = editor({ writeFails: true }); await e.ready();
  const field = e.get('edit-section-one'), preview = e.get('sections').children[0].querySelector('.rendered');
  const htmlWrites = preview.htmlWrites;
  field.value = '# Timer backup\n'; e.tick();
  assert.equal(e.get('storage').textContent, 'Browser backup unavailable · save or download your draft');
  e.faults.writeFails = false; e.tick();
  assert.equal(e.writes.length, 1);
  assert.equal(e.get('storage').textContent, 'Edits backed up in this browser');
  assert.equal(preview.htmlWrites, htmlWrites);
});

const unsafeSectionIds = [
  'section-" autofocus onfocus="alert(1)', 'section-<img src=x onerror=alert(1)>',
  "section-' onclick='alert(1)", 'section-&quot;', 'section-</textarea><script>alert(1)</script>',
  '', 'SECTION', 'section_one', 'section.one', 'section one', 'section/one',
  'section-one\n', 'section-one\r', 'section-one\r\n', 'section-one\u2028', 'section-one\u2029',
  'section-é', 'section-\u0000', null, 7,
];

test('embedded section IDs reject unsafe syntax before building the editor', () => {
  for (const id of unsafeSectionIds) {
    const documentState = initial(); documentState.sections[0].id = id;
    assert.throws(() => editor({ documentState }), /Invalid section ID/, JSON.stringify(id));
  }
});

test('recovery section IDs use the exact embedded ID syntax', async () => {
  for (const id of unsafeSectionIds) {
    const backup = saved(); backup.sections[0].id = id;
    const e = editor({ backup }); await e.ready();
    assert.equal(e.get('recovery').hidden, true, JSON.stringify(id));
    assert.equal(e.writes.length, 0, 'invalid recovery never overwrites the saved draft');
  }
});

test('all existing permitted section ID forms retain DOM associations and recovery', async () => {
  for (const id of ['section-one', 'section-123-4', 'a', '0', '-', '--', '9-section-', 'abcdefghijklmnopqrstuvwxyz0123456789-']) {
    const documentState = initial(); documentState.sections[0].id = id;
    const e = editor({ documentState }); await e.ready();
    const section = e.get('sections').children[0], field = e.get(`edit-${id}`);
    assert.equal(section.id, id); assert.equal(field, section.querySelector('textarea'));
    assert.equal(section.querySelector('label').htmlFor, field.id);
    assert.equal(section.querySelector('.number').textContent, '01');
    assert.equal(e.get('contents').children[0].href, `#${id}`);
    const backup = saved(); backup.sections[0].id = id;
    const recovered = editor({ backup }); await recovered.ready();
    assert.equal(recovered.get('recovery').hidden, false, id);
    await recovered.get('restore').click();
    assert.equal(recovered.get(`edit-${id}`).value, backup.sections[0].current);
  }
});
