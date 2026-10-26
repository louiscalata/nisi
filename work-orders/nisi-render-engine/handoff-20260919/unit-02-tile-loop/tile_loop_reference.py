# Reference implementation of the tile loop (unit-02).
# Drafted by google/gemma-4-26b-a4b-qat in run codemode-20260914-020549-11996-131264000 (attempt0),
# three-line integrator repair by Claude 2026-09-14: output() also reports a quarantined tile's kept
# output; apron() and identity() see PROMOTED neighbours/children only. Model-authored test block removed.
# Status: UNCERTIFIED — no structural gate scan and no model review ran on this exact file; the owner's
# 14 acceptance tests pass under a plain interpreter (see HANDOFF.md).
import json
import hashlib
from enum import Enum

class TileState(Enum):
    OPEN = "open"
    RENDERED = "rendered"
    PROMOTED = "promoted"
    QUARANTINED = "quarantined"

class TileError(Exception):
    pass

def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"))

def digest(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

class Loop:
    def __init__(self, max_attempts=3, max_reopens=2):
        self.max_attempts = max_attempts
        self.max_reopens = max_reopens
        self.tiles = {}
        self.journal = {}  # identity -> output_digest
        self.parents = {}  # child_id -> parent_id

    def add(self, tile_id, inputs, recipe, neighbours=(), children=()):
        if tile_id in self.tiles:
            raise TileError("Duplicate id")
        if tile_id in neighbours or tile_id in children:
            raise TileError("Self-reference")
        
        for nid in neighbours:
            if nid not in self.tiles:
                raise TileError("Unknown neighbour")
        for cid in children:
            if cid not in self.tiles:
                raise TileError("Unknown child")
            if self.parents.get(cid):
                raise TileError("Child already has a parent")
            self.parents[cid] = tile_id

        self.tiles[tile_id] = {
            "state": TileState.OPEN,
            "attempt": 0,
            "reopens": 0,
            "inputs": inputs,
            "recipe": recipe,
            "neighbours": list(neighbours),
            "children": list(children),
            "output": None,
            "last_code": None,
            "source": None,
            "apron_snapshot": None
        }

    def _get_tile(self, tile_id):
        if tile_id not in self.tiles:
            raise TileError("Unknown tile id")
        return self.tiles[tile_id]

    def state(self, tile_id):
        return self._get_tile(tile_id)["state"]

    def attempt(self, tile_id):
        return self._get_tile(tile_id)["attempt"]

    def reopens(self, tile_id):
        return self._get_tile(tile_id)["reopens"]

    def output(self, tile_id):
        t = self._get_tile(tile_id)
        return t["output"] if t["state"] in (TileState.PROMOTED, TileState.QUARANTINED) else None

    def last_code(self, tile_id):
        return self._get_tile(tile_id)["last_code"]

    def apron(self, tile_id):
        t = self._get_tile(tile_id)
        res = {}
        for nid in t["neighbours"]:
            res[nid] = self.output(nid) if self.tiles[nid]["state"] == TileState.PROMOTED else None
        return res

    def identity(self, tile_id):
        t = self._get_tile(tile_id)
        return digest(canonical({
            "apron": self.apron(tile_id),
            "attempt": t["attempt"],
            "children": [self.output(cid) if self.tiles[cid]["state"] == TileState.PROMOTED else None for cid in t["children"]],
            "inputs": t["inputs"],
            "recipe": t["recipe"]
        }))

    def render(self, tile_id, output=None, source=None):
        t = self._get_tile(tile_id)
        if t["state"] == TileState.QUARANTINED:
            raise TileError("Frozen")
        if t["state"] != TileState.OPEN:
            raise TileError("Invalid state")

        # Replay check
        current_id = self.identity(tile_id)
        if current_id in self.journal:
            t["state"] = TileState.PROMOTED
            t["output"] = self.journal[current_id]
            t["last_code"] = "REPLAY"
            t["source"] = "journal"
            return TileState.PROMOTED

        if not t["children"]:
            if not isinstance(output, str) or not source or not isinstance(source, str):
                raise TileError("Invalid leaf render params")
            t["output_candidate"] = digest(output)
            t["source"] = source
        else:
            for cid in t["children"]:
                if self.tiles[cid]["state"] != TileState.PROMOTED:
                    raise TileError("Children not promoted")
            t["output_candidate"] = digest(canonical([self.output(cid) for cid in t["children"]]))
            t["source"] = "assemble"

        t["apron_snapshot"] = self.apron(tile_id)
        t["state"] = TileState.RENDERED
        return TileState.RENDERED

    def verify(self, tile_id, validity, quality, reviewer):
        t = self._get_tile(tile_id)
        if t["state"] != TileState.RENDERED:
            raise TileError("Invalid state")
        if not reviewer or reviewer == t["source"]:
            raise TileError("Invalid reviewer")

        if self.apron(tile_id) != t["apron_snapshot"]:
            t["state"] = TileState.OPEN
            t["last_code"] = "APRON_STALE"
            return TileState.OPEN

        if validity and quality:
            t["state"] = TileState.PROMOTED
            t["output"] = t["output_candidate"]
            t["last_code"] = "PASS"
            self.journal[self.identity(tile_id)] = t["output"]
            return TileState.PROMOTED
        else:
            t["attempt"] += 1
            t["last_code"] = "VALIDITY_FAIL" if not validity else "QUALITY_FAIL"
            if t["attempt"] > self.max_attempts:
                t["state"] = TileState.QUARANTINED
            else:
                t["state"] = TileState.OPEN
            return t["state"]

    def reopen(self, tile_id, reason):
        t = self._get_tile(tile_id)
        if t["state"] != TileState.PROMOTED:
            raise TileError("Invalid state")
        
        t["reopens"] += 1
        if t["reopens"] > self.max_reopens:
            t["state"] = TileState.QUARANTINED
            return TileState.QUARANTINED
        
        t["output"] = None
        t["state"] = TileState.OPEN
        t["attempt"] += 1
        
        # Cascade upward
        curr = self.parents.get(tile_id)
        while curr:
            pt = self.tiles[curr]
            if pt["state"] in (TileState.RENDERED, TileState.PROMOTED):
                pt["state"] = TileState.OPEN
                pt["output"] = None
            curr = self.parents.get(curr)
        return t["state"]

    def height(self):
        return sum(1 for t in self.tiles.values() if t["state"] != TileState.PROMOTED)

    def done(self):
        return all(t["state"] == TileState.PROMOTED for t in self.tiles.values())

    def stuck(self):
        return any(t["state"] == TileState.QUARANTINED for t in self.tiles.values())

    def snapshot(self):
        return {
            "tiles": {
                tid: {
                    "state": v["state"].value,
                    "attempt": v["attempt"],
                    "reopens": v["reopens"],
                    "children": v["children"],
                    "neighbours": v["neighbours"],
                    "output": v["output"],
                    "last_code": v["last_code"]
                } for tid, v in self.tiles.items()
            }
        }
