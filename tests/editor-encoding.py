"""Generator text-boundary regressions; run directly, or with --campaign."""

import contextlib
import hashlib
import io
import json
import random
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
EDITOR = ROOT / "docs" / "editor"
SOURCE = (EDITOR / "build-editor.py").read_text(encoding="utf-8")
TEMPLATES = {name: (EDITOR / name).read_bytes() for name in ["editor.css", "editor.js", "chrome.html"]}
BASE = ROOT / "fixture" / "editor"
STATE = BASE.parent / "state.json"
OUTPUT = BASE / "result.html"
UNICODE = "Café — 日本語 😀 e\u0301 \u0081 \ufeff"


def fixture(markdown="# Draft\n\n" + UNICODE + "\n", supplied=True, templates=None):
    files = {BASE / name: data for name, data in (templates or TEMPLATES).items()}
    files[BASE.parent / "README-draft.md"] = markdown.encode("utf-8")
    if supplied:
        state = {
            "about": UNICODE,
            "baseRevision": "a" * 64,
            "sections": [{"id": "section-one", "current": markdown, "baseline": "Original " + UNICODE}],
        }
        files[STATE] = json.dumps(state, ensure_ascii=False).encode("utf-8")
    return files


def generate(code, files, *, encoding="cp1252", newline="\r\n", writes=None):
    """Model only implicit text defaults, using actual TextIOWrapper semantics."""
    files = dict(files)
    files.pop(OUTPUT, None)

    class Output(io.BytesIO):
        def close(self):
            if self.closed:
                return
            files[OUTPUT] = self.getvalue()
            super().close()

    def open_file(path, mode="r", buffering=-1, encoding=None, errors=None, newline=None):
        del buffering
        if "w" in mode:
            if path != OUTPUT:
                raise AssertionError("Generator wrote an input")
            if writes is not None:
                writes.append(path)
            stream = Output()
        else:
            stream = io.BytesIO(files[path])
        if "b" in mode:
            return stream
        selected_encoding = default_encoding if encoding in (None, "locale") else encoding
        selected_newline = default_newline if "w" in mode and newline is None else newline
        return io.TextIOWrapper(stream, encoding=selected_encoding, errors=errors, newline=selected_newline)

    default_encoding, default_newline = encoding, newline
    arguments = [str(BASE / "build-editor.py"), OUTPUT.name]
    if STATE in files:
        arguments.append(str(STATE))
    before = {name: data for name, data in files.items() if name != OUTPUT}
    with mock.patch.object(Path, "open", open_file), mock.patch.object(sys, "argv", arguments):
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, {"__file__": arguments[0], "__name__": "__main__"})
    if {name: data for name, data in files.items() if name != OUTPUT} != before:
        raise AssertionError("Generator changed an input")
    return files[OUTPUT]


def compiled(source=SOURCE, optimize=0):
    return compile(source, str(BASE / "build-editor.py"), "exec", optimize=optimize)


def embedded_state(output):
    return json.loads(re.search(rb'<script id="state" type="application/json">(.*?)</script>', output, re.S)[1])


def check_content(output, files):
    state = embedded_state(output)
    manuscript = files[BASE.parent / "README-draft.md"].decode("utf-8")
    if "".join(section["current"] for section in state["sections"]) != manuscript:
        raise AssertionError("Manuscript changed")
    if STATE in files:
        supplied = json.loads(files[STATE])
        for field in ["sections", "about", "baseRevision"]:
            if state[field] != supplied[field]:
                raise AssertionError("Supplied state changed: " + field)
    else:
        if state["baseRevision"] != hashlib.sha256(files[BASE.parent / "README-draft.md"]).hexdigest():
            raise AssertionError("Manuscript revision changed")
    template_text = []
    for name in ["editor.js", "editor.css", "chrome.html"]:
        with io.TextIOWrapper(io.BytesIO(files[BASE / name]), encoding="utf-8") as stream:
            template_text.append(stream.read())
    app, css, chrome = template_text
    expected_build = hashlib.sha256(json.dumps(template_text, ensure_ascii=False).encode("utf-8")).hexdigest()
    if state["editorBuild"] != expected_build:
        raise AssertionError("Template build digest changed")
    for fragment in [
        '<style id="editor-style">' + css + "</style>",
        '<template id="chrome">' + chrome + "</template>",
        '<script id="editor-app">' + app + "</script>",
    ]:
        if fragment.encode("utf-8") not in output:
            raise AssertionError("Template changed")


class EncodingTests(unittest.TestCase):
    def test_unicode_inputs_and_exact_output(self):
        templates = {name: data + ("\n/* " + UNICODE + " */\n").encode("utf-8") for name, data in TEMPLATES.items()}
        files = fixture(templates=templates)
        code = compiled()
        expected = generate(code, files, encoding="utf-8", newline="\n")
        for optimize in [0, 1]:
            actual = generate(compiled(optimize=optimize), files)
            self.assertEqual(actual, expected)
            self.assertNotIn(b"\r\n", actual)
            self.assertFalse(actual.startswith(b"\xef\xbb\xbf"))
            check_content(actual, files)

    def test_unsupplied_manuscript_line_endings_are_preserved(self):
        files = fixture("# " + UNICODE + "\r\n\r\nText\rTail\n", supplied=False)
        output = generate(compiled(), files)
        check_content(output, files)
        self.assertEqual(output, generate(compiled(), files, encoding="utf-8", newline="\n"))

    def test_refusals_survive_optimization_and_windows_defaults(self):
        for optimize in [0, 1]:
            for field, value, message in [
                ("id", 'x"><img src=x>', "Invalid section ID"),
                ("baseRevision", "z" * 64, "Invalid base revision"),
            ]:
                files = fixture()
                state = json.loads(files[STATE])
                target = state["sections"][0] if field == "id" else state
                target[field] = value
                files[STATE] = json.dumps(state, ensure_ascii=False).encode("utf-8")
                writes = []
                with self.assertRaisesRegex(ValueError, message):
                    generate(compiled(optimize=optimize), files, writes=writes)
                self.assertEqual(writes, [], "Invalid state creates no output")

    def test_saved_artifacts_reproduce_as_bytes(self):
        for name in ["index.html", "index-typing-revision.html"]:
            original = (EDITOR / name).read_bytes()
            files = fixture((ROOT / "docs" / "README-draft.md").read_bytes().decode("utf-8"))
            files[STATE] = json.dumps(embedded_state(original), ensure_ascii=False).encode("utf-8")
            self.assertEqual(generate(compiled(), files), original, name)

    def test_strict_utf8_and_json_bom_policy_are_preserved(self):
        for path in [
            STATE,
            BASE / "editor.css",
            BASE / "editor.js",
            BASE / "chrome.html",
            BASE.parent / "README-draft.md",
        ]:
            files = fixture()
            files[path] = b"\xff"
            with self.assertRaises(UnicodeDecodeError):
                generate(compiled(), files)
        files = fixture()
        files[STATE] = b"\xef\xbb\xbf" + files[STATE]
        with self.assertRaises(json.JSONDecodeError):
            generate(compiled(), files)


def campaign(reference_source=None):
    """Bounded boundary mutations and deterministic generated-input comparisons."""
    mutants = []
    read_expressions = ["Path(sys.argv[2])", "(base / 'editor.css')", "(base / 'editor.js')", "(base / 'chrome.html')"]
    for expression in read_expressions:
        before = expression + ".read_text(encoding='utf-8')"
        for replacement in [
            ".read_text()",
            ".read_text(encoding='cp1252')",
            ".read_text(encoding='latin-1')",
            ".read_text(encoding='ascii')",
            ".read_text(encoding='utf-16')",
            ".read_text(encoding='utf-8-sig')",
            ".read_text(encoding='utf-8').replace('é', 'e')",
            ".read_text(encoding='utf-8').replace('😀', '?')",
        ]:
            if SOURCE.count(before) != 1:
                raise AssertionError("Missing unique mutation target: " + before)
            mutants.append((before + " -> " + replacement, SOURCE.replace(before, expression + replacement)))
    before = ".write_bytes(html.encode('utf-8'))"
    for replacement in [
        ".write_text(html)",
        ".write_text(html, encoding='utf-8')",
        ".write_bytes(html.encode('utf-16'))",
        ".write_bytes(html.encode('utf-8-sig'))",
        ".write_bytes(html.encode('cp1252', errors='replace'))",
        ".write_bytes(html.replace('\\n', '\\r\\n').encode('utf-8'))",
        ".write_bytes(html.replace('é', 'e').encode('utf-8'))",
        ".write_bytes(html.rstrip().encode('utf-8') + b'\\n')",
    ]:
        if SOURCE.count(before) != 1:
            raise AssertionError("Missing unique output mutation target")
        mutants.append((replacement, SOURCE.replace(before, replacement)))
    templates = {
        name: b"\xef\xbb\xbf \n" + data + ("\n " + UNICODE + " \n").encode("utf-8") for name, data in TEMPLATES.items()
    }
    files = fixture(templates=templates)
    expected = generate(compiled(), files)
    caught = []
    for label, source in mutants:
        code = compiled(source)  # Syntax errors are never counted as caught mutations.
        try:
            result = generate(code, files)
        except (UnicodeError, ValueError, AssertionError):
            caught.append(label)
        else:
            if result == expected:
                bom_files = dict(files)
                bom_files[STATE] = b"\xef\xbb\xbf" + bom_files[STATE]
                try:
                    generate(code, bom_files)
                except json.JSONDecodeError:
                    raise AssertionError("Surviving mutation: " + label) from None
            caught.append(label)
    rng = random.Random(0x6E697369)
    alphabet = ["é", "中", "😀", "e\u0301", "\u0081", "\ufeff", "&", "<", " ", "\t", "\n", "\r\n", "\r"]
    # The original portable interpretation is explicit UTF-8 reads and LF text writes.
    reference = reference_source or SOURCE.replace(
        ".write_bytes(html.encode('utf-8'))", ".write_text(html, encoding='utf-8')"
    )
    reference_code, candidate_code = compiled(reference), compiled()
    comparisons = 0
    for index in range(2048):
        text = "# Draft\n\n" + "".join(rng.choice(alphabet) for _ in range(1 + index % 31))
        templates = {name: data + ("\n " + text + " \n").encode("utf-8") for name, data in TEMPLATES.items()}
        files = fixture(text, supplied=index % 2 == 0, templates=templates)
        actual = generate(candidate_code, files)
        expected = generate(reference_code, files, encoding="utf-8", newline="\n")
        if actual != expected:
            raise AssertionError("Differential mismatch: " + str(index))
        check_content(actual, files)
        comparisons += 1
    print(
        json.dumps(
            {
                "mutants": len(mutants),
                "caught": len(caught),
                "survivors": len(mutants) - len(caught),
                "generated_inputs": comparisons,
                "byte_comparisons": comparisons,
                "candidate_sha256": hashlib.sha256(SOURCE.encode("utf-8")).hexdigest(),
                "reference_sha256": hashlib.sha256(reference.encode("utf-8")).hexdigest(),
                "scope": "Text defaults model, not native Windows",
            }
        )
    )


if __name__ == "__main__":
    if sys.argv[1:2] == ["--campaign"]:
        if len(sys.argv) > 3:
            raise SystemExit("Usage: editor-encoding.py --campaign [reference-generator.py]")
        campaign(Path(sys.argv[2]).read_text(encoding="utf-8") if len(sys.argv) == 3 else None)
    else:
        unittest.main()
