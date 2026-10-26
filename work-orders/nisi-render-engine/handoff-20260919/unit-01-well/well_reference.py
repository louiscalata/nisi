# Reference implementation of the Well (unit-01), drafted by the local snippet chain.
# Run: ~/code-runs/codemode-20260914-013514-2703-036493000 (run.json is the authority).
# Status: UNCERTIFIED (MODEL_VERIFY_FAIL) — acceptance tests PASS (88 sites, 0 failed),
# structural gate PASS (ruleset 171abe86528a6f74), both model reviewers UNAVAILABLE.
# Draft google/gemma-4-26b-a4b-qat, repairs by qwen/qwen3.6-35b-a3b (3). Read by Claude 2026-09-14.
# artifact_sha256 of the chain's final.py: b633577a2621dda25d880322ea573d690270ba047e584e8b7f024b7b11500cae

from enum import Enum

class RowState(Enum):
    OPEN = "open"
    FULL = "full"
    CHECKING = "checking"
    PASSED = "passed"
    CLEARED = "cleared"
    QUARANTINED = "quarantined"

class WellError(Exception):
    pass

class Well:
    def __init__(self, layers, tiles, deps=None, is_hole=None, max_reopens=2):
        if not layers or len(layers) != len(set(layers)):
            raise WellError()
        if not tiles or len(tiles) != len(set(tiles)):
            raise WellError()
        
        self.layers = list(layers)
        self.tiles = list(tiles)
        self.max_reopens = max_reopens
        
        self.deps_map = {}
        if deps is None:
            for i, layer in enumerate(self.layers):
                if i > 0:
                    self.deps_map[layer] = {self.layers[i-1]}
                else:
                    self.deps_map[layer] = set()
        else:
            for layer, d_set in deps.items():
                if layer not in self.layers:
                    raise WellError()
                for d in d_set:
                    if d not in self.layers or d == layer:
                        raise WellError()
                self.deps_map[layer] = set(d_set)
            for layer in self.layers:
                if layer not in self.deps_map:
                    self.deps_map[layer] = set()

        self._check_cycles()

        self._rows = {}
        for layer in self.layers:
            self._rows[layer] = {
                "state": RowState.OPEN,
                "reopens": 0,
                "cells": {tile: {"source": None, "text": None} for tile in self.tiles}
            }
        
        self._is_hole_func = is_hole if is_hole else lambda x: x is None or not str(x).strip() or "TODO" in str(x)

    def _check_cycles(self):
        visited = set()
        path = set()
        def visit(u):
            if u in path: raise WellError()
            if u in visited: return
            path.add(u)
            for v in self.deps_map.get(u, []):
                visit(v)
            path.remove(u)
            visited.add(u)
        for layer in self.layers:
            visit(layer)

    def _get_transitive_dependents(self, layer):
        rev = {l: set() for l in self.layers}
        for l, d_set in self.deps_map.items():
            for d in d_set:
                rev[d].add(l)
        
        dependents = []
        stack = list(rev[layer])
        visited = set()
        while stack:
            curr = stack.pop()
            if curr not in visited:
                visited.add(curr)
                dependents.append(curr)
                stack.extend(list(rev[curr]))
        return [l for l in self.layers if l in visited]

    def state(self, layer):
        if layer not in self._rows: raise WellError()
        return self._rows[layer]["state"]

    def deps(self, layer):
        if layer not in self._rows: raise WellError()
        return set(self.deps_map[layer])

    def dependents(self, layer):
        if layer not in self._rows: raise WellError()
        return self._get_transitive_dependents(layer)

    def reopens(self, layer):
        if layer not in self._rows: raise WellError()
        return self._rows[layer]["reopens"]

    def holes(self, layer):
        if layer not in self._rows: raise WellError()
        row = self._rows[layer]
        h = []
        for t in self.tiles:
            cell = row["cells"][t]
            if cell["text"] is None or self._is_hole_func(cell["text"]):
                h.append(t)
        return h

    def place(self, layer, tile, output, source):
        if layer not in self._rows or tile not in self.tiles: raise WellError()
        s = self._rows[layer]["state"]
        if s not in (RowState.OPEN, RowState.FULL):
            raise WellError()
        
        self._rows[layer]["cells"][tile] = {"source": source, "text": output}
        h_list = self.holes(layer)
        self._rows[layer]["state"] = RowState.FULL if not h_list else RowState.OPEN
        return self._rows[layer]["state"]

    def begin_check(self, layer):
        if layer not in self._rows: raise WellError()
        if self._rows[layer]["state"] != RowState.FULL:
            raise WellError()
        self._rows[layer]["state"] = RowState.CHECKING

    def report_check(self, layer, validity, quality, failed_tiles=()):
        if layer not in self._rows: raise WellError()
        if self._rows[layer]["state"] != RowState.CHECKING:
            raise WellError()
        
        if validity and quality:
            self._rows[layer]["state"] = RowState.PASSED
            changed = True
            while changed:
                changed = False
                for l in self.layers:
                    if self._rows[l]["state"] == RowState.PASSED:
                        if all(self._rows[d]["state"] == RowState.CLEARED for d in self.deps_map[l]):
                            self._rows[l]["state"] = RowState.CLEARED
                            changed = True
            return self._rows[layer]["state"]
        else:
            self._rows[layer]["state"] = RowState.OPEN
            if not failed_tiles:
                for t in self.tiles:
                    self._rows[layer]["cells"][t] = {"source": None, "text": None}
            else:
                for t in failed_tiles:
                    if t not in self.tiles: raise WellError()
                    self._rows[layer]["cells"][t] = {"source": None, "text": None}
            return self._rows[layer]["state"]

    def reopen(self, layer, tiles, reason):
        if layer not in self._rows: raise WellError()
        s = self._rows[layer]["state"]
        if s not in (RowState.PASSED, RowState.CLEARED):
            raise WellError()
        
        self._rows[layer]["reopens"] += 1
        if self._rows[layer]["reopens"] > self.max_reopens:
            self._rows[layer]["state"] = RowState.QUARANTINED
            return self._rows[layer]["state"]
        
        target_tiles = tiles if tiles else self.tiles
        for t in target_tiles:
            if t not in self.tiles: raise WellError()
            self._rows[layer]["cells"][t] = {"source": None, "text": None}
        
        self._rows[layer]["state"] = RowState.OPEN
        for dep in self._get_transitive_dependents(layer):
            if self._rows[dep]["state"] in (RowState.CHECKING, RowState.PASSED, RowState.CLEARED):
                self._rows[dep]["state"] = RowState.FULL
        return self._rows[layer]["state"]

    def height(self):
        return sum(1 for l in self.layers if self._rows[l]["state"] != RowState.CLEARED)

    def done(self):
        return all(self._rows[l]["state"] == RowState.CLEARED for l in self.layers)

    def stuck(self):
        return any(self._rows[l]["state"] == RowState.QUARANTINED for l in self.layers)

    def snapshot(self):
        return {
            "layers": self.layers,
            "tiles": self.tiles,
            "rows": {
                l: {
                    "state": self._rows[l]["state"].value,
                    "reopens": self._rows[l]["reopens"],
                    "cells": {
                        t: {
                            "source": self._rows[l]["cells"][t]["source"],
                            "hole": self._is_hole_func(self._rows[l]["cells"][t]["text"]) if self._rows[l]["cells"][t]["text"] is not None else True
                        } for t in self.tiles
                    }
                } for l in self.layers
            }
        }