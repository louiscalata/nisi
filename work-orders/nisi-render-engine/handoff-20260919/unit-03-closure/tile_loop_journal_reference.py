# Reference implementation of the tile loop with a shared journal (unit-03, "closure soundness").
# Drafted by the PC worker (Qwen3-Coder-Next 80B-A3B Q4_K_M) in 127 s, job mac-20260914-033804-9cb66743c778c61a938a5557a15a8330, from task.txt alone.
# No integrator repair was needed: 15/15 owner acceptance tests pass under a plain interpreter (first try).
# Changes from unit-02: identity excludes attempt; Loop(journal=) shares a journal across jobs; reopen writes a
# tombstone (None) for the tile's identity; a tombstoned identity never replays until re-verified; an
# unchanged resubmit replays a whole shot; a partial change re-renders only the touched tiles and their ancestors.
# Status: UNCERTIFIED - no structural gate scan and no model review ran on this file. Read by Claude 2026-09-14.
import enum
import json
import hashlib


def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"))


def digest(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class TileState(enum.Enum):
    OPEN = "open"
    RENDERED = "rendered"
    PROMOTED = "promoted"
    QUARANTINED = "quarantined"


class TileError(Exception):
    pass


class Loop:
    def __init__(self, max_attempts=3, max_reopens=2, journal=None):
        self.max_attempts = max_attempts
        self.max_reopens = max_reopens
        self.journal = {} if journal is None else journal
        self._tiles = {}  # tile_id -> {inputs, recipe, neighbours, children, state, attempt, reopens, output, last_code, candidate, source, apron_snapshot}
        self._order = []  # insertion order for children

    def add(self, tile_id, inputs, recipe, neighbours=(), children=()):
        if tile_id in self._tiles:
            raise TileError("duplicate id")
        if tile_id in neighbours or tile_id in children:
            raise TileError("tile naming itself")
        for n in neighbours:
            if n not in self._tiles:
                raise TileError("unknown neighbour")
        for c in children:
            if c not in self._tiles:
                raise TileError("unknown child")
            if self._tiles[c].get("parent") is not None:
                raise TileError("child already has a parent")
        self._tiles[tile_id] = {
            "inputs": inputs,
            "recipe": recipe,
            "neighbours": list(neighbours),
            "children": list(children),
            "state": TileState.OPEN,
            "attempt": 0,
            "reopens": 0,
            "output": None,
            "last_code": None,
            "candidate": None,
            "source": None,
            "apron_snapshot": None,
            "parent": None
        }
        for c in children:
            self._tiles[c]["parent"] = tile_id
        self._order.append(tile_id)

    def state(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        return self._tiles[tile_id]["state"]

    def attempt(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        return self._tiles[tile_id]["attempt"]

    def reopens(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        return self._tiles[tile_id]["reopens"]

    def output(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        return self._tiles[tile_id]["output"]

    def last_code(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        return self._tiles[tile_id]["last_code"]

    def apron(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        tile = self._tiles[tile_id]
        result = {}
        for n in tile["neighbours"]:
            if n in self._tiles and self._tiles[n]["state"] == TileState.PROMOTED:
                result[n] = self._tiles[n]["output"]
            else:
                result[n] = None
        return result

    def identity(self, tile_id):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        tile = self._tiles[tile_id]
        apron_data = self.apron(tile_id)
        children_outputs = []
        for c in tile["children"]:
            if c in self._tiles and self._tiles[c]["state"] == TileState.PROMOTED:
                children_outputs.append(self._tiles[c]["output"])
            else:
                children_outputs.append(None)
        data = {
            "apron": apron_data,
            "children": children_outputs,
            "inputs": tile["inputs"],
            "recipe": tile["recipe"]
        }
        return digest(canonical(data))

    def render(self, tile_id, output=None, source=None):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        tile = self._tiles[tile_id]
        if tile["state"] != TileState.OPEN:
            raise TileError("render only from OPEN")
        tile_id_data = self._tiles[tile_id]
        # Replay check first
        identity_str = self.identity(tile_id)
        if identity_str in self.journal and self.journal[identity_str] is not None:
            # Replay
            tile["state"] = TileState.PROMOTED
            tile["output"] = self.journal[identity_str]
            tile["last_code"] = "REPLAY"
            tile["source"] = "journal"
            return TileState.PROMOTED

        # Compute candidate digest
        if not tile["children"]:  # leaf
            if not isinstance(output, str) or not isinstance(source, str) or not source:
                raise TileError("invalid leaf render args")
            candidate = digest(output)
            apron_snapshot = self.apron(tile_id)
            tile["candidate"] = candidate
            tile["source"] = source
            tile["apron_snapshot"] = apron_snapshot
        else:  # parent
            for c in tile["children"]:
                if c not in self._tiles or self._tiles[c]["state"] != TileState.PROMOTED:
                    raise TileError("parent render requires all children promoted")
            child_outputs = [self._tiles[c]["output"] for c in tile["children"]]
            candidate = digest(canonical(child_outputs))
            apron_snapshot = self.apron(tile_id)
            tile["candidate"] = candidate
            tile["source"] = "assemble"
            tile["apron_snapshot"] = apron_snapshot

        tile["state"] = TileState.RENDERED
        tile["last_code"] = None
        return TileState.RENDERED

    def verify(self, tile_id, validity, quality, reviewer):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        tile = self._tiles[tile_id]
        if tile["state"] != TileState.RENDERED:
            raise TileError("verify only from RENDERED")
        if not isinstance(reviewer, str) or not reviewer:
            raise TileError("invalid reviewer")
        if reviewer == tile["source"]:
            raise TileError("reviewer same as source")

        # Recompute apron
        current_apron = self.apron(tile_id)
        if current_apron != tile["apron_snapshot"]:
            tile["last_code"] = "APRON_STALE"
            tile["state"] = TileState.OPEN
            tile["candidate"] = None
            return TileState.OPEN

        if validity and quality:
            tile["state"] = TileState.PROMOTED
            tile["output"] = tile["candidate"]
            tile["last_code"] = "PASS"
            self.journal[self.identity(tile_id)] = tile["output"]
            return TileState.PROMOTED
        else:
            tile["candidate"] = None
            tile["attempt"] += 1
            if tile["attempt"] > self.max_attempts:
                tile["state"] = TileState.QUARANTINED
                tile["last_code"] = "VALIDITY_FAIL" if not validity else "QUALITY_FAIL"
            else:
                tile["state"] = TileState.OPEN
                tile["last_code"] = "VALIDITY_FAIL" if not validity else "QUALITY_FAIL"
            return tile["state"]

    def reopen(self, tile_id, reason):
        if tile_id not in self._tiles:
            raise TileError("unknown tile")
        tile = self._tiles[tile_id]
        if tile["state"] != TileState.PROMOTED:
            raise TileError("reopen only from PROMOTED")

        tile["reopens"] += 1
        if tile["reopens"] > self.max_reopens:
            tile["state"] = TileState.QUARANTINED
            return TileState.QUARANTINED

        # Compute identity BEFORE clearing output
        identity_str = self.identity(tile_id)
        # Set tombstone
        self.journal[identity_str] = None
        # Clear output
        tile["output"] = None
        tile["attempt"] += 1
        tile["state"] = TileState.OPEN

        # Cascade to ancestors
        current_id = tile_id
        while True:
            parent_id = self._tiles[current_id].get("parent")
            if parent_id is None or parent_id not in self._tiles:
                break
            parent = self._tiles[parent_id]
            if parent["state"] in (TileState.RENDERED, TileState.PROMOTED):
                parent["state"] = TileState.OPEN
                parent["output"] = None
                # attempt unchanged
            current_id = parent_id

        return TileState.OPEN

    def height(self):
        return sum(1 for t in self._tiles.values() if t["state"] != TileState.PROMOTED)

    def done(self):
        return all(t["state"] == TileState.PROMOTED for t in self._tiles.values())

    def stuck(self):
        return any(t["state"] == TileState.QUARANTINED for t in self._tiles.values())

    def snapshot(self):
        result = {"tiles": {}}
        for tid, t in self._tiles.items():
            result["tiles"][tid] = {
                "state": t["state"].value,
                "attempt": t["attempt"],
                "reopens": t["reopens"],
                "children": t["children"],
                "neighbours": t["neighbours"],
                "output": t["output"],
                "last_code": t["last_code"]
            }
        return result
