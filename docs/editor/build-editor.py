#!/usr/bin/env python3
"""Build a standalone, dependency-free editorial artifact from the Markdown draft."""
import json
import re
import hashlib
import sys
from pathlib import Path

base = Path(__file__).resolve().parent
markdown = (base.parent / 'README-draft.md').read_bytes().decode('utf-8')
sections = []
buffer = []
fence = None
for line in markdown.splitlines(keepends=True):
    marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)', line)
    was_fenced = fence is not None
    if marker:
        token, suffix = marker.groups()
        if fence is None:
            fence = (token[0], len(token))
        elif token[0] == fence[0] and len(token) >= fence[1] and not suffix.strip():
            fence = None
    if not was_fenced and not marker and re.match(r'^#{1,6} ', line) and buffer:
        text = ''.join(buffer)
        sections.append({'id': f'section-{len(sections) + 1}', 'current': text, 'baseline': text})
        buffer = []
    buffer.append(line)
if buffer:
    text = ''.join(buffer)
    sections.append({'id': f'section-{len(sections) + 1}', 'current': text, 'baseline': text})
state = {
    'schemaVersion': 1,
    'id': 'nisi-brigade-editor-20260911-v1',
    'baseRevision': hashlib.sha256(markdown.encode('utf-8')).hexdigest(),
    'savedAt': 0,
    'about': 'A JavaScript workflow engine for AI-assisted development, inspired by a kitchen brigade. Orchestrates local LLM author and reviewer calls through a configured HTTP server.',
    'sections': sections,
}
if len(sys.argv) > 2:
    supplied = json.loads(Path(sys.argv[2]).read_text())
    assert ''.join(s['current'] for s in supplied['sections']) == markdown, 'Editor state must match Markdown exactly'
    assert len({s['id'] for s in supplied['sections']}) == len(supplied['sections']), 'Duplicate section IDs'
    state['sections'] = [{**s, 'baseline': s.get('baseline', s['current'])} for s in supplied['sections']]
    state['about'] = supplied['about']
assert ''.join(s['current'] for s in sections) == markdown, 'Section split must preserve every source byte'
css = (base / 'editor.css').read_text()
app = (base / 'editor.js').read_text()
chrome = (base / 'chrome.html').read_text()
state['editorBuild'] = hashlib.sha256(json.dumps([app, css, chrome], ensure_ascii=False).encode('utf-8')).hexdigest()
assert '</script' not in app.lower(), 'App source must not terminate its HTML script element'
data = json.dumps(state, ensure_ascii=False).replace('<', '\\u003c')
html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nisi on GitHub — Brigade Draft</title><style id="editor-style">' + css + '</style></head><body><script id="state" type="application/json">' + data + '</script>' + chrome + '<template id="chrome">' + chrome + '</template><script id="editor-app">' + app + '</script></body></html>'
output_name = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
assert Path(output_name).name == output_name and output_name.endswith('.html'), 'Output must be a local HTML filename'
(base / output_name).write_text(html)
print(json.dumps({'sections': len(sections), 'html_bytes': len(html.encode()), 'draft_words': len(markdown.split())}))
