# Copyright 2026 Louis Calata
# SPDX-License-Identifier: Apache-2.0
"""Direct tests for the harder-v2 generators (LOU-87).

check_reproducible.py pins the whole task set by hash; these tests pin the reference
validator in gen_structured-data.py case by case, and check that every generator with a
build() step returns well-formed tasks and is deterministic. Standard library only, writes
nothing. Run from anywhere:

    python3 -I benchmarks/harder/v2/test_generators.py
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

GENERATORS = Path(__file__).resolve().parent / "generators"


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), GENERATORS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SD = load("gen_structured-data")
VALID = {"id": 1, "email": "a@b.io", "role": "user", "items": [{"sku": "abc", "qty": 1}]}


def doc(**changes):
    out = dict(VALID)
    for key, value in changes.items():
        if value is None:
            out.pop(key, None)
        else:
            out[key] = value
    return out


class ValidateTests(unittest.TestCase):
    def check(self, document, expected):
        self.assertEqual(SD.validate(document), sorted(expected))

    def test_valid_document_has_no_violations(self):
        self.check(VALID, [])
        self.check(doc(age=0, tags=["x", "y"], items=[{"sku": "abcdef", "qty": 99, "note": None}]), [])

    def test_root_type_required_and_additional(self):
        self.check([], ["$:type"])
        self.check(doc(id=None, nick="b"), ["$.id:required", "$.nick:additional"])

    def test_type_mismatch_reports_type_only(self):
        self.check(doc(id=True), ["$.id:type"])
        self.check(doc(age=30.0), ["$.age:type"])
        self.check(doc(email=5), ["$.email:type"])
        self.check(doc(role=None, items=None), ["$.items:required", "$.role:required"])

    def test_range_enum_and_format(self):
        self.check(doc(id=0), ["$.id:range"])
        self.check(doc(age=131), ["$.age:range"])
        self.check(doc(role="Admin"), ["$.role:enum"])
        for email in ("a@@b.io", "@b.io", "a@", "a@.io", "a@io.", "a@io"):
            with self.subTest(email=email):
                self.check(doc(email=email), ["$.email:format"])

    def test_tags_count_unique_and_element_type(self):
        self.check(doc(tags=["a", "b", "a", "d", 5]), ["$.tags:count", "$.tags:unique", "$.tags[4]:type"])
        self.check(doc(tags=[1, True]), ["$.tags[0]:type", "$.tags[1]:type"])

    def test_items(self):
        self.check(doc(items=[]), ["$.items:count"])
        self.check(
            doc(items=[{"sku": "AB", "qty": True, "note": 7, "extra": 1}, {"qty": 2.5}, 3]),
            [
                "$.items[0].extra:additional",
                "$.items[0].note:type",
                "$.items[0].qty:type",
                "$.items[0].sku:length",
                "$.items[1].qty:type",
                "$.items[1].sku:required",
                "$.items[2]:type",
            ],
        )
        self.check(doc(items=[{"sku": "abc", "qty": 100}]), ["$.items[0].qty:range"])

    def test_strict_eq_keeps_bool_and_number_apart(self):
        self.assertFalse(SD.strict_eq(True, 1))
        self.assertFalse(SD.strict_eq(None, 0))
        self.assertFalse(SD.strict_eq("1", 1))
        self.assertTrue(SD.strict_eq({"a": [1, None]}, {"a": [1, None]}))


class BuildTests(unittest.TestCase):
    def test_build_is_deterministic_and_well_formed(self):
        for name in ("gen_structured-data", "gen_state-sim", "gen_text-formats"):
            with self.subTest(generator=name):
                module = load(name)
                first, second = module.build(), module.build()
                self.assertEqual(first, second)
                self.assertEqual(len({task["id"] for task in first}), len(first))
                for task in first:
                    self.assertEqual(set(task), {"id", "category", "tier", "prompt", "expectedAnswer"})
                    self.assertEqual(task["category"], module.CATEGORY)
                    self.assertIn(task["tier"], {"medium", "hard"})


if __name__ == "__main__":
    unittest.main()
