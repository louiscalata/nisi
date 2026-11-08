# Copyright 2026 Louis Calata
# SPDX-License-Identifier: Apache-2.0
# Builds the frozen harder task set v2. Every expected answer is computed by the
# generator for its category (v2/generators/gen_<category>.py, standard library only,
# fixed seeds); none is typed by hand. Each generator runs in a scratch copy so the
# source tree is never written, and the result is written beside this file as
# tasks-v2.json. Run twice, it produces identical bytes.
import hashlib, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CATEGORIES = ['state-sim', 'text-formats', 'algorithms', 'calendar-time', 'numbers', 'structured-data']

def run_generator(category):
    with tempfile.TemporaryDirectory() as scratch:
        source = os.path.join(HERE, 'v2', 'generators', f'gen_{category}.py')
        copy = os.path.join(scratch, f'gen_{category}.py')
        shutil.copyfile(source, copy)
        subprocess.run([sys.executable, '-I', copy], cwd=scratch, check=True, stdout=subprocess.DEVNULL)
        with open(os.path.join(scratch, f'{category}.tasks.json'), encoding='utf-8') as handle:
            return json.load(handle)

tasks = []
for category in CATEGORIES:
    tasks.extend(run_generator(category))
ids = [t['id'] for t in tasks]
assert len(ids) == len(set(ids)), 'duplicate task ids'
for t in tasks:
    assert set(t) == {'id', 'category', 'tier', 'prompt', 'expectedAnswer'}, t['id']
data = {'datasetId': 'nisi-harder-v2', 'frozenAt': '2026-11-08', 'tasks': tasks}
payload = (json.dumps(data, indent=1, ensure_ascii=False) + '\n').encode('utf-8')
with open(os.path.join(HERE, 'tasks-v2.json'), 'wb') as handle:
    handle.write(payload)
print(hashlib.sha256(payload).hexdigest(), len(tasks))
