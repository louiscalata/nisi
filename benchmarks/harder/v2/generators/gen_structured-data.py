#!/usr/bin/env python3
"""Generator for the nisi-harder-v2 "structured-data" category.

Deterministic, stdlib only, no network. Every expectedAnswer is COMPUTED here
by reference implementations; nothing is typed by hand.

Running it writes next to this file:
  structured-data.tasks.json    (with expectedAnswer)
  structured-data.prompts.json  (expectedAnswer removed)
"""
import copy
import json
import math
import os

CATEGORY = "structured-data"
HERE = os.path.dirname(os.path.abspath(__file__))


def J(x):
    """Compact JSON used inside prompts."""
    return json.dumps(x, separators=(",", ":"), ensure_ascii=True)


def strict_eq(a, b):
    """JSON equality where booleans never equal numbers, key order ignored."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, dict):
        return (isinstance(b, dict) and set(a) == set(b)
                and all(strict_eq(a[k], b[k]) for k in a))
    if isinstance(a, list):
        return (isinstance(b, list) and len(a) == len(b)
                and all(strict_eq(x, y) for x, y in zip(a, b)))
    if isinstance(b, (dict, list)):
        return False
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, str) != isinstance(b, str):
        return False
    return a == b


def skey(v):
    """Hashable identity key distinguishing bool/int/str."""
    return (type(v).__name__, v if not isinstance(v, (dict, list)) else J(v))


# ---------------------------------------------------------------- task 1
def merge_patch(target, patch):
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    if not isinstance(target, dict):
        target = {}
    res = dict(target)
    for k, v in patch.items():
        if v is None:
            res.pop(k, None)
        else:
            res[k] = merge_patch(res.get(k), v) if k in res else merge_patch(None, v)
    return res


def task_merge_patch():
    target = {
        "title": "Doc",
        "tags": ["x", "y"],
        "author": {"name": "Joe", "email": "j@x", "phone": None},
        "meta": {"v": 1, "flags": {"a": True, "b": False}},
        "stats": 5,
        "notes": [1, {"k": 2}],
    }
    patch = {
        "title": None,
        "tags": {"first": "x"},
        "author": {"email": None, "phone": "555", "nick": None},
        "meta": {"flags": {"b": None, "c": []}, "v": {"major": 1, "minor": None}},
        "stats": [],
        "notes": {},
        "missing": None,
        "fresh": {"a": {"b": None}, "c": 3},
    }
    ans = merge_patch(target, patch)
    prompt = (
        "Apply an RFC 7386 JSON Merge Patch. Algorithm MergePatch(target, patch): "
        "(1) if patch is not an object, the result is patch itself (arrays and scalars replace wholesale). "
        "(2) Otherwise, if target is not an object (missing, scalar, array or null), treat target as {}. "
        "(3) For each key k in patch: if patch[k] is null, remove k from target (nothing happens if k is absent); "
        "otherwise set target[k] = MergePatch(target[k], patch[k]), where an absent target[k] counts as not an object. "
        "Null values already present in target, at keys the patch does not mention, are kept.\n"
        f"target = {J(target)}\n"
        f"patch = {J(patch)}\n"
        "Return answer as the resulting JSON object (key order is irrelevant; array order matters)."
    )
    return "medium", prompt, ans


# ---------------------------------------------------------------- task 2
def parse_path(raw):
    """Tokens: ('k', str) or ('i', int)."""
    toks = []
    cur = []
    have_key = False
    i = 0
    n = len(raw)
    while i < n:
        c = raw[i]
        if c == "\\":
            cur.append(raw[i + 1])
            have_key = True
            i += 2
        elif c == ".":
            toks.append(("k", "".join(cur)))
            cur = []
            have_key = False
            i += 1
        elif c == "[":
            if have_key or cur:
                toks.append(("k", "".join(cur)))
                cur = []
                have_key = False
            j = raw.index("]", i)
            toks.append(("i", int(raw[i + 1:j])))
            i = j + 1
            if i < n and raw[i] == ".":
                i += 1
        else:
            cur.append(c)
            have_key = True
            i += 1
    if cur or have_key:
        toks.append(("k", "".join(cur)))
    return toks


def unflatten(pairs):
    root = {}
    for raw, val in pairs:
        toks = parse_path(raw)
        node = root
        for idx, (kind, t) in enumerate(toks):
            last = idx == len(toks) - 1
            nxt = None if last else toks[idx + 1][0]
            if kind == "k":
                if last:
                    node[t] = val
                else:
                    if t not in node:
                        node[t] = {} if nxt == "k" else []
                    node = node[t]
            else:
                while len(node) <= t:
                    node.append(None)
                if last:
                    node[t] = val
                else:
                    if node[t] is None:
                        node[t] = {} if nxt == "k" else []
                    node = node[t]
    return root


def task_unflatten():
    pairs = [
        ("user.name", "Ann"),
        ("user.emails[2]", "c@x.io"),
        ("user.emails[0]", "a@x.io"),
        ("user.addr\\.v2.zip", "94110"),
        ("user.0", True),
        ("matrix[1][0]", 3),
        ("matrix[0][1]", 2),
        ("matrix[1][1]", 4),
        ("tags[1]", None),
        ("a\\\\b.c", 1),
        ("x\\[0\\].y", 5),
        ("p.q[0].r", "deep"),
        ("p.q[1]", 0),
    ]
    ans = unflatten(pairs)
    lines = "\n".join(f"{k} => {J(v)}" for k, v in pairs)
    prompt = (
        "Rebuild a nested JSON value from flattened entries, one per line as `raw-key => JSON-value`. "
        "The raw key is plain text exactly as shown (it is NOT JSON-escaped). Key syntax: "
        "'.' separates object-key segments; a segment may be followed by index tokens like [3] (a non-negative decimal "
        "integer), each meaning 'array element at that index'; a backslash makes the next character literal, so \\. is a dot "
        "inside a key, \\\\ is one backslash inside a key, and \\[ and \\] are literal brackets inside a key. A segment of "
        "digits without brackets (like 0) is an ordinary object key, not an index. Containers are created on first use: "
        "an object when the next token is a key, an array when it is an index. Array positions never assigned "
        "(gaps, or below the highest index) are null. Assigned values may themselves be null.\n"
        f"{lines}\n"
        "Return answer as the resulting JSON object (key order is irrelevant; array order matters)."
    )
    return "medium", prompt, ans


# ---------------------------------------------------------------- task 3
def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def valid_email(s):
    if s.count("@") != 1:
        return False
    local, dom = s.split("@")
    if not local or not dom:
        return False
    return any(c == "." and 0 < i < len(dom) - 1 for i, c in enumerate(dom))


def validate(doc):
    out = set()

    def add(path, code):
        out.add(f"{path}:{code}")

    if not isinstance(doc, dict):
        add("$", "type")
        return sorted(out)
    allowed = {"id", "email", "role", "age", "tags", "items"}
    for k in doc:
        if k not in allowed:
            add(f"$.{k}", "additional")
    for k in ("id", "email", "role", "items"):
        if k not in doc:
            add(f"$.{k}", "required")
    if "id" in doc:
        v = doc["id"]
        if not is_int(v):
            add("$.id", "type")
        elif v < 1:
            add("$.id", "range")
    if "email" in doc:
        v = doc["email"]
        if not isinstance(v, str):
            add("$.email", "type")
        elif not valid_email(v):
            add("$.email", "format")
    if "role" in doc:
        v = doc["role"]
        if not isinstance(v, str):
            add("$.role", "type")
        elif v not in ("admin", "user", "guest"):
            add("$.role", "enum")
    if "age" in doc:
        v = doc["age"]
        if not is_int(v):
            add("$.age", "type")
        elif not 0 <= v <= 130:
            add("$.age", "range")
    if "tags" in doc:
        v = doc["tags"]
        if not isinstance(v, list):
            add("$.tags", "type")
        else:
            if len(v) > 3:
                add("$.tags", "count")
            seen = set()
            for i, e in enumerate(v):
                if not isinstance(e, str):
                    add(f"$.tags[{i}]", "type")
                key = skey(e)
                if key in seen:
                    add("$.tags", "unique")
                seen.add(key)
    if "items" in doc:
        v = doc["items"]
        if not isinstance(v, list):
            add("$.items", "type")
        else:
            if not 1 <= len(v) <= 3:
                add("$.items", "count")
            for i, e in enumerate(v):
                p = f"$.items[{i}]"
                if not isinstance(e, dict):
                    add(p, "type")
                    continue
                for k in e:
                    if k not in ("sku", "qty", "note"):
                        add(f"{p}.{k}", "additional")
                for k in ("sku", "qty"):
                    if k not in e:
                        add(f"{p}.{k}", "required")
                if "sku" in e:
                    s = e["sku"]
                    if not isinstance(s, str):
                        add(f"{p}.sku", "type")
                    elif not 3 <= len(s) <= 6:
                        add(f"{p}.sku", "length")
                if "qty" in e:
                    q = e["qty"]
                    if not is_int(q):
                        add(f"{p}.qty", "type")
                    elif not 1 <= q <= 99:
                        add(f"{p}.qty", "range")
                if "note" in e and e["note"] is not None and not isinstance(e["note"], str):
                    add(f"{p}.note", "type")
    return sorted(out)


def task_validate():
    doc = {
        "id": 0,
        "email": "bob@@x.io",
        "role": "Admin",
        "age": 30.0,
        "tags": ["a", "b", "a", "d", 5],
        "items": [
            {"sku": "AB", "qty": True, "note": 7, "extra": 1},
            {"sku": "ABCDEFG", "qty": 100},
            {"sku": "ok1", "qty": "3"},
            {"qty": 2.5},
        ],
        "nick": "b",
    }
    ans = validate(doc)
    prompt = (
        "Validate the document against this schema and list every violation.\n"
        "Root: object with allowed keys exactly id, email, role, age, tags, items; required: id, email, role, items. "
        "id: integer >= 1. email: string with exactly one '@', something before it, and after it a '.' that is neither the first "
        "nor the last character of the part after '@'. role: one of admin, user, guest (case-sensitive). age (optional): integer 0..130. "
        "tags (optional): array of strings, at most 3 elements, no two equal. items: array of 1..3 objects with allowed keys exactly "
        "sku, qty, note; sku and qty required; sku: string of length 3..6; qty: integer 1..99; note (optional): string or null.\n"
        "'Integer' = JSON number written with no decimal point or exponent (30.0 and 2.5 are not integers); booleans are not numbers. "
        "Check a value's type first; on a type mismatch report only 'type' for it and run no other check on it. Other failures: "
        "'range', 'enum', 'format', 'length'. Arrays: wrong element count gives 'count' at the array's path; any repeated element gives "
        "one 'unique' at the array's path; each wrongly typed element gives 'type' at its own path. Missing required keys give "
        "'required' and disallowed keys 'additional', both at that key's path. Paths: $ root, .key, [i] 0-based, e.g. $.items[1].qty. "
        "A violation is the string PATH:CODE; duplicates collapse.\n"
        f"document = {J(doc)}\n"
        "Return answer as a JSON array of violation strings sorted ascending by plain codepoint string order."
    )
    return "medium", prompt, ans


# ---------------------------------------------------------------- task 4
class PatchError(Exception):
    pass


def unesc(tok):
    return tok.replace("~1", "/").replace("~0", "~")


def ptoks(p):
    if p == "":
        return []
    if not p.startswith("/"):
        raise PatchError("bad pointer")
    return [unesc(t) for t in p[1:].split("/")]


def aidx(tok, n, allow_end):
    if not (tok.isdigit() and (tok == "0" or not tok.startswith("0"))):
        raise PatchError("bad index")
    i = int(tok)
    if i > n or (i == n and not allow_end):
        raise PatchError("index out of range")
    return i


def resolve(doc, toks):
    cur = doc
    for t in toks:
        if isinstance(cur, dict):
            if t not in cur:
                raise PatchError("missing key")
            cur = cur[t]
        elif isinstance(cur, list):
            cur = cur[aidx(t, len(cur), False)]
        else:
            raise PatchError("not a container")
    return cur


def p_add(doc, toks, val):
    parent = resolve(doc, toks[:-1])
    last = toks[-1]
    if isinstance(parent, dict):
        parent[last] = val
    elif isinstance(parent, list):
        if last == "-":
            parent.append(val)
        else:
            parent.insert(aidx(last, len(parent), True), val)
    else:
        raise PatchError("not a container")


def p_remove(doc, toks):
    parent = resolve(doc, toks[:-1])
    last = toks[-1]
    if isinstance(parent, dict):
        if last not in parent:
            raise PatchError("missing key")
        return parent.pop(last)
    if isinstance(parent, list):
        return parent.pop(aidx(last, len(parent), False))
    raise PatchError("not a container")


def apply_op(doc, op):
    kind = op["op"]
    toks = ptoks(op["path"])
    if kind == "add":
        p_add(doc, toks, copy.deepcopy(op["value"]))
    elif kind == "remove":
        p_remove(doc, toks)
    elif kind == "replace":
        resolve(doc, toks)
        parent = resolve(doc, toks[:-1])
        v = copy.deepcopy(op["value"])
        if isinstance(parent, dict):
            parent[toks[-1]] = v
        else:
            parent[aidx(toks[-1], len(parent), False)] = v
    elif kind == "test":
        if not strict_eq(resolve(doc, toks), op["value"]):
            raise PatchError("test failed")
    elif kind in ("move", "copy"):
        ft = ptoks(op["from"])
        if kind == "move":
            if len(toks) > len(ft) and toks[:len(ft)] == ft:
                raise PatchError("from is a proper prefix of path")
            resolve(doc, ft)
            v = p_remove(doc, ft)
            p_add(doc, toks, v)
        else:
            v = copy.deepcopy(resolve(doc, ft))
            p_add(doc, toks, v)
    else:
        raise PatchError("unknown op")


def apply_patch(doc, ops):
    """Atomic: returns (new_doc, None) or (original_doc, failing_index)."""
    work = copy.deepcopy(doc)
    for i, op in enumerate(ops):
        try:
            apply_op(work, op)
        except PatchError:
            return doc, i
    return work, None


def render_op(op):
    k = op["op"]
    if k in ("move", "copy"):
        return f"{k} {op['from']} -> {op['path']}"
    if k == "remove":
        return f"remove {op['path']}"
    return f"{k} {op['path']} {J(op['value'])}"


def O(op, path, value=None, frm=None):
    d = {"op": op, "path": path}
    if op in ("add", "replace", "test"):
        d["value"] = value
    if frm is not None:
        d["from"] = frm
    return d


def task_json_patch():
    doc = {
        "cfg": {"a/b": [10, 20, 30, 40], "m~n": {"x": 1, "y": [True, False]}},
        "list": ["p", "q", "r"],
        "meta": {"v": 1},
    }
    patches = [
        ("P1", [
            O("add", "/cfg/a~1b/1", "new"),
            O("remove", "/cfg/a~1b/0"),
            O("move", "/cfg/a~1b/0", frm="/cfg/a~1b/3"),
            O("copy", "/list/-", frm="/cfg/m~0n/y"),
            O("replace", "/cfg/m~0n/y/0", False),
            O("test", "/list/3/0", True),
            O("add", "/meta/tags", ["t"]),
            O("move", "/list/2", frm="/list/0"),
            O("test", "/meta", {"tags": ["t"], "v": 1}),
            O("replace", "/meta/v", 2),
            O("remove", "/cfg/m~0n/x"),
        ]),
        ("P2", [
            O("add", "/list/0", "head"),
            O("test", "/meta/v", 2),
            O("copy", "/cfg/clone", frm="/cfg/m~0n"),
            O("test", "/cfg/clone/y/0", True),
        ]),
        ("P3", [
            O("test", "/list", ["q", "r", "p", [True, False]]),
            O("test", "/cfg/m~0n", {"y": [False, False]}),
            O("replace", "/list/3/1", True),
            O("add", "/cfg/a~1b/4", "end"),
            O("move", "/cfg/tags", frm="/meta/tags"),
            O("copy", "/cfg/a~1b/0", frm="/cfg/tags/0"),
            O("remove", "/list/1"),
        ]),
        ("P4", [
            O("add", "/zzz", 1),
            O("move", "/cfg/inner", frm="/cfg"),
        ]),
    ]
    cur = doc
    failures = []
    for name, ops in patches:
        cur, bad = apply_patch(cur, ops)
        if bad is not None:
            failures.append({"patch": name, "opIndex": bad})
    ans = {"doc": cur, "failures": failures}
    blocks = "\n".join(
        f"{name}: " + "; ".join(render_op(o) for o in ops) for name, ops in patches
    )
    prompt = (
        "Apply RFC 6902 JSON Patches P1, P2, P3, P4 in order. Paths are RFC 6901 pointers (~1 = '/', ~0 = '~'; '-' as an array "
        "index appends). Notation: `add PATH VALUE`, `remove PATH`, `replace PATH VALUE`, `test PATH VALUE`, `move FROM -> PATH`, "
        "`copy FROM -> PATH`. add into an array inserts before that index (index = length appends; larger is an error); add on an "
        "object key overwrites. Everything else needs an existing location and in-range indexes. move = remove FROM then add at PATH "
        "(PATH indexes are evaluated after the removal); it is an error if FROM is a proper prefix of PATH. copy duplicates the value. "
        "test passes only on deep equality (object key order ignored; true is not 1; \"2\" is not 2). Each patch is ATOMIC: if any op "
        "errors or a test fails, the whole patch is discarded (document unchanged) and later patches still run. Record the 0-based "
        "index of the first failing op of each discarded patch.\n"
        f"document = {J(doc)}\n{blocks}\n"
        'Return answer as {"doc": <final document>, "failures": [{"patch":"P2","opIndex":0}, ...]} ordered by patch name '
        "(empty array if none)."
    )
    return "hard", prompt, ans


# ---------------------------------------------------------------- task 5
def dm(base, over):
    """Deep merge; base may be the sentinel None meaning absent/non-container."""
    if isinstance(over, dict):
        if not isinstance(base, dict):
            base = {}
        res = dict(base)
        for k, v in over.items():
            if v is None:
                res.pop(k, None)
            else:
                res[k] = dm(res[k], v) if k in res else dm(None, v)
        return res
    if isinstance(over, list) and isinstance(base, list):
        def all_id(a):
            return all(isinstance(e, dict) and "id" in e for e in a)

        def all_scalar(a):
            return all(not isinstance(e, (dict, list)) for e in a)

        if all_id(base) and all_id(over):
            res = list(base)
            for el in over:
                ik = skey(el["id"])
                pos = next((i for i, b in enumerate(res) if skey(b["id"]) == ik), None)
                if pos is not None:
                    if el.get("_delete") is True:
                        res.pop(pos)
                    else:
                        res[pos] = dm(res[pos], el)
                elif el.get("_delete") is not True:
                    res.append(dm({}, el))
            return res
        if all_scalar(base) and all_scalar(over):
            res = []
            seen = set()
            for e in base + over:
                if skey(e) not in seen:
                    seen.add(skey(e))
                    res.append(e)
            return res
        return copy.deepcopy(over)
    return copy.deepcopy(over)


def task_deep_merge():
    base = {
        "app": {
            "name": "core", "ports": [80, 443], "features": ["a", "b"],
            "limits": {"cpu": 1, "mem": 512},
            "hooks": [{"id": "h1", "cmd": "x", "env": {"A": "1", "B": "2"}}, {"id": "h2", "cmd": "y"}],
        },
        "owner": "ops", "labels": {"tier": "gold"}, "retries": 3,
    }
    o1 = {
        "app": {
            "ports": [443, 8080, 80, 9000], "features": ["c", "a"],
            "limits": {"mem": None, "disk": 10},
            "hooks": [{"id": "h1", "env": {"B": None, "C": "3"}}, {"id": "h3", "cmd": "z"},
                      {"id": "h2", "_delete": True}],
        },
        "owner": {"team": "sre", "pager": None}, "labels": ["x"], "retries": None,
        "extra": {"a": None, "b": []},
    }
    o2 = {
        "app": {
            "name": "core2", "ports": [], "features": [1, "a"],
            "hooks": [{"id": "h3", "cmd": None, "env": {"Z": "9"}}, {"id": "h9", "_delete": True},
                      {"id": "h4", "note": None}, {"id": "h3", "cmd": "w"}],
        },
        "owner": {"team": None, "pager": "p1"}, "labels": [{"id": 1, "v": 2}],
        "extra": {"b": [{"id": 7}]},
    }
    ans = dm(dm(base, o1), o2)
    prompt = (
        "Compute merge(merge(base, o1), o2). merge(A, B): "
        "(a) B an object: if A is not an object use {}; for each key k of B: B[k] null -> delete k from the result; else "
        "result[k] = merge(A[k], B[k]) (an absent A[k] is neither object nor array). "
        "(b) A and B both arrays: if every element of both is an object with an \"id\" key (empty arrays qualify), merge by id: "
        "start with A's elements; for each B element in order, if an element with an equal id exists (same type and value) then "
        "remove it if the B element has \"_delete\": true, else replace it with merge(existing, B element); if none exists, append "
        "merge({}, B element) unless it has \"_delete\": true (then ignore it). Else if every element of both is a scalar (empty "
        "qualifies): A's elements followed by B's elements not already present (same type and value). Else the result is B. "
        "(c) Anything else: the result is B.\n"
        f"base = {J(base)}\no1 = {J(o1)}\no2 = {J(o2)}\n"
        "Return answer as the final merged JSON object (key order is irrelevant; array order matters)."
    )
    return "hard", prompt, ans


# ---------------------------------------------------------------- task 6
def esc(k):
    return k.replace("~", "~0").replace("/", "~1")


def diff(a, b, path, ops):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            p = f"{path}/{esc(k)}"
            if k not in b:
                ops.append({"op": "remove", "path": p})
            elif k not in a:
                ops.append({"op": "add", "path": p, "value": b[k]})
            else:
                diff(a[k], b[k], p, ops)
    elif isinstance(a, list) and isinstance(b, list):
        m = min(len(a), len(b))
        for i in range(m):
            diff(a[i], b[i], f"{path}/{i}", ops)
        for i in range(m, len(b)):
            ops.append({"op": "add", "path": f"{path}/{i}", "value": b[i]})
        for i in range(len(a) - 1, m - 1, -1):
            ops.append({"op": "remove", "path": f"{path}/{i}"})
    elif not strict_eq(a, b):
        ops.append({"op": "replace", "path": path, "value": b})


def task_diff():
    a = {
        "id": 7, "Name": "x",
        "a/b": {"k~": [1, 2, 3, 4, 5], "z": None},
        "a-b": True,
        "list": [{"n": 1, "t": ["p"]}, {"n": 2}, 5],
        "old": 1, "flag": 1,
    }
    b = {
        "id": 7, "name": "x",
        "a/b": {"k~": [1, 9, 3], "z": 0, "w": {}},
        "a-b": True,
        "list": [{"n": 1, "t": ["p", "q"]}, [2], 5, 6, 7],
        "flag": True, "new": [],
    }
    ops = []
    diff(a, b, "", ops)
    ans = ops
    prompt = (
        "Compute the canonical diff turning A into B as a list of RFC 6902 ops (only add, remove, replace). "
        "diff(x, y, path): if both are objects, visit the union of their keys in ascending order of the RAW (unescaped) key by "
        "plain codepoint comparison (uppercase before lowercase, '-' (45) before '/' (47)); for each key: only in x -> remove; "
        "only in y -> add with y's value; in both -> diff(x[k], y[k], path + '/' + escaped key). If both are arrays, let m be the "
        "shorter length: diff elements 0..m-1 in order at path/i; then for i = m..len(y)-1 ascending emit add at path/i with y[i]; "
        "then for i = len(x)-1 down to m emit remove at path/i. Otherwise, if the two values are not equal, emit replace at path "
        "with y's whole value (this covers different types, null vs anything, and true vs 1; equality is deep, key order ignored). "
        "Equal values emit nothing. Paths are RFC 6901 pointers: escape '~' as ~0 first, then '/' as ~1. Objects are "
        "{\"op\",\"path\",\"value\"}; remove ops have no \"value\" key.\n"
        f"A = {J(a)}\nB = {J(b)}\n"
        'Return answer as a JSON array of op objects in emission order, e.g. [{"op":"remove","path":"/x"},{"op":"add","path":"/y","value":1}].'
    )
    return "hard", prompt, ans


# ---------------------------------------------------------------- task 7
def task_group_by():
    recs = [
        ["East ", "Widget", 3, 250, "ok"],
        [" east", "widget ", 2, 250, "OK"],
        ["EAST", "Gadget", None, 900, "ok"],
        ["West", "Gadget", 1, 900, "ok"],
        ["west", "Gizmo", 4, 100, "void"],
        [None, "Widget", 5, 250, "ok"],
        ["", "Gizmo", 1, 100, "ok"],
        ["North", "Gizmo", 2, 100, "Test"],
        ["West", "gadget", 2, 900, "ok"],
        ["West", "Widget", 3, None, "ok"],
        ["North", "Widget", 1, 250, " ok "],
        ["East", "Gizmo", 2, 100, "ok"],
        ["North", None, 6, 50, "ok"],
        ["South", "Gadget", 1, 900, "ok"],
    ]
    groups = {}
    for region, product, qty, price, status in recs:
        if status.strip().lower() in ("void", "test"):
            continue
        r = (region or "").strip().lower() or "(none)"
        g = groups.setdefault(r, {"orders": 0, "units": 0, "revenue": 0, "prod": {}})
        g["orders"] += 1
        if qty is not None:
            g["units"] += qty
        if qty is not None and price is not None:
            g["revenue"] += qty * price
        if product is not None:
            p = product.strip().lower()
            g["prod"][p] = g["prod"].get(p, 0) + (qty or 0)
    rows = []
    for r, g in groups.items():
        if g["orders"] < 2:
            continue
        if g["units"] > 0:
            d = math.gcd(g["revenue"], g["units"])
            avg = {"numerator": g["revenue"] // d, "denominator": g["units"] // d}
        else:
            avg = None
        top = None
        if g["prod"]:
            top = sorted(g["prod"].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        rows.append({"region": r, "orders": g["orders"], "units": g["units"],
                     "revenue": g["revenue"], "avgUnitPrice": avg, "topProduct": top})
    rows.sort(key=lambda x: (-x["revenue"], x["region"]))
    lines = "\n".join(J(r) for r in recs)
    prompt = (
        "Aggregate these order records, each [region, product, qty, price_cents, status]:\n"
        f"{lines}\n"
        "Steps. (1) Drop records whose status, after trimming spaces and lowercasing, is 'void' or 'test'. "
        "(2) Group the rest by region: trim, lowercase; a null or empty region becomes the key '(none)'. "
        "(3) Per group compute: orders = number of records; units = sum of qty over records whose qty is not null; "
        "revenue = sum of qty*price_cents over records where BOTH qty and price are non-null (so a record with a null price still "
        "adds its qty to units but nothing to revenue); avgUnitPrice = revenue/units as a fully reduced fraction "
        "{\"numerator\":n,\"denominator\":d} (an integer value still has denominator 1; if units is 0 use null); "
        "topProduct = the product (trimmed, lowercased; null products ignored) with the largest sum of qty (null qty counts as 0), "
        "ties broken by alphabetically smaller name, or null if no record has a product. "
        "(4) Keep only groups with orders >= 2. (5) Sort by revenue descending, ties by region ascending.\n"
        'Return answer as a JSON array of objects {"region","orders","units","revenue","avgUnitPrice","topProduct"} in that order.'
    )
    return "hard", prompt, rows


# ---------------------------------------------------------------- main
def build():
    makers = [
        task_merge_patch, task_unflatten, task_validate,
        task_json_patch, task_deep_merge, task_diff, task_group_by,
    ]
    tasks = []
    for n, mk in enumerate(makers, 1):
        tier, prompt, ans = mk()
        assert 300 <= len(prompt) <= 1800, (n, len(prompt))
        assert "Return answer as" in prompt.splitlines()[-1]
        if isinstance(ans, list):
            assert 1 <= len(ans) <= 40, (n, len(ans))
        tasks.append({"id": f"{CATEGORY}-{n:02d}", "category": CATEGORY, "tier": tier,
                      "prompt": prompt, "expectedAnswer": ans})
    assert sum(t["tier"] == "medium" for t in tasks) == 3
    assert sum(t["tier"] == "hard" for t in tasks) == 4
    return tasks


def main():
    tasks = build()
    with open(os.path.join(HERE, f"{CATEGORY}.tasks.json"), "w") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=True)
        f.write("\n")
    stripped = [{k: v for k, v in t.items() if k != "expectedAnswer"} for t in tasks]
    with open(os.path.join(HERE, f"{CATEGORY}.prompts.json"), "w") as f:
        json.dump(stripped, f, indent=2, ensure_ascii=True)
        f.write("\n")
    for t in tasks:
        print(t["id"], t["tier"], len(t["prompt"]))


if __name__ == "__main__":
    main()
