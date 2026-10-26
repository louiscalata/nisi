# --- acceptance tests: immutable, supplied by the task owner -----------------
import json as _json
import hashlib as _hashlib

def _canon(x):
    return _json.dumps(x, sort_keys=True, separators=(",", ":"))

def _dg(s):
    return _hashlib.sha256(s.encode("utf-8")).hexdigest()

def _raises(fn, why):
    try:
        fn()
    except TileError:
        return
    assert False, why

def _promote(lp, tid, text, source="gen", reviewer="verifier"):
    lp.render(tid, text, source)
    return lp.verify(tid, True, True, reviewer)

def test_identity_is_canonical_and_pinned():
    lp = Loop()
    lp.add("a", {"src": "d1"}, {"seed": 1, "model": "m"})
    expected = _dg(_canon({"apron": {}, "attempt": 0, "children": [], "inputs": {"src": "d1"}, "recipe": {"model": "m", "seed": 1}}))
    assert lp.identity("a") == expected
    assert len(lp.identity("a")) == 64
    lp2 = Loop()
    lp2.add("a", {"src": "d1"}, {"model": "m", "seed": 1})
    assert lp2.identity("a") == expected
    lp3 = Loop()
    lp3.add("a", {"src": "d1"}, {"model": "m", "seed": 2})
    assert lp3.identity("a") != expected

def test_add_validation():
    lp = Loop()
    lp.add("a", {}, {})
    _raises(lambda: lp.add("a", {}, {}), "duplicate id accepted")
    _raises(lambda: lp.add("b", {}, {}, neighbours=["zzz"]), "unknown neighbour accepted")
    _raises(lambda: lp.add("b", {}, {}, children=["zzz"]), "unknown child accepted")
    _raises(lambda: lp.add("b", {}, {}, neighbours=["b"]), "self neighbour accepted")
    _raises(lambda: lp.add("b", {}, {}, children=["b"]), "self child accepted")
    lp.add("p", {}, {}, children=["a"])
    _raises(lambda: lp.add("q", {}, {}, children=["a"]), "a child with two parents accepted")
    assert lp.state("a") is TileState.OPEN
    assert lp.attempt("a") == 0 and lp.reopens("a") == 0
    assert lp.output("a") is None and lp.last_code("a") is None

def test_leaf_render_verify_promote():
    lp = Loop()
    lp.add("a", {"src": "d1"}, {"seed": 1})
    assert lp.render("a", "cell a v1", "gen") is TileState.RENDERED
    assert lp.state("a") is TileState.RENDERED
    assert lp.output("a") is None
    assert lp.verify("a", True, True, "verifier") is TileState.PROMOTED
    assert lp.output("a") == _dg("cell a v1")
    assert lp.last_code("a") == "PASS"
    assert lp.done() and lp.height() == 0

def test_render_and_verify_preconditions():
    lp = Loop()
    lp.add("a", {}, {})
    _raises(lambda: lp.verify("a", True, True, "verifier"), "verify on an open tile must fail")
    _raises(lambda: lp.render("a", None, "gen"), "leaf render without output must fail")
    _raises(lambda: lp.render("a", "x", ""), "leaf render without source must fail")
    lp.render("a", "x", "gen")
    _raises(lambda: lp.render("a", "x", "gen"), "double render must fail")
    _raises(lambda: lp.verify("a", True, True, "gen"), "author reviewing its own work must fail")
    _raises(lambda: lp.verify("a", True, True, ""), "empty reviewer must fail")
    assert lp.state("a") is TileState.RENDERED
    assert lp.verify("a", True, True, "verifier") is TileState.PROMOTED

def test_failed_verify_reopens_then_quarantines():
    lp = Loop(max_attempts=2)
    lp.add("a", {}, {})
    lp.render("a", "v1", "gen")
    assert lp.verify("a", False, True, "verifier") is TileState.OPEN
    assert lp.last_code("a") == "VALIDITY_FAIL"
    assert lp.attempt("a") == 1 and lp.output("a") is None
    lp.render("a", "v2", "gen")
    assert lp.verify("a", True, False, "verifier") is TileState.OPEN
    assert lp.last_code("a") == "QUALITY_FAIL"
    assert lp.attempt("a") == 2
    lp.render("a", "v3", "gen")
    assert lp.verify("a", False, False, "verifier") is TileState.QUARANTINED
    assert lp.attempt("a") == 3
    assert lp.stuck() and not lp.done() and lp.height() == 1
    _raises(lambda: lp.render("a", "v4", "gen"), "quarantined tiles are frozen")
    _raises(lambda: lp.reopen("a", "x"), "quarantined tiles are frozen")

def test_parent_assembles_only_when_children_promoted():
    lp = Loop()
    lp.add("a", {}, {"k": 1})
    lp.add("b", {}, {"k": 2})
    lp.add("p", {}, {}, children=["a", "b"])
    _raises(lambda: lp.render("p"), "parent rendered before its children promoted")
    _promote(lp, "a", "out a")
    _raises(lambda: lp.render("p"), "parent rendered with one child still open")
    _promote(lp, "b", "out b")
    assert lp.height() == 1
    assert lp.render("p") is TileState.RENDERED
    _raises(lambda: lp.verify("p", True, True, "assemble"), "assembler cannot review its own assembly")
    assert lp.verify("p", True, True, "verifier") is TileState.PROMOTED
    assert lp.output("p") == _dg(_canon([_dg("out a"), _dg("out b")]))
    assert lp.done()

def test_reopen_cascades_upward_only():
    lp = Loop()
    lp.add("a", {}, {"k": "a"})
    lp.add("b", {}, {"k": "b"})
    lp.add("p", {}, {}, children=["a", "b"])
    lp.add("g", {}, {}, children=["p"])
    _promote(lp, "a", "a1")
    _promote(lp, "b", "b1")
    lp.render("p")
    lp.verify("p", True, True, "verifier")
    lp.render("g")
    lp.verify("g", True, True, "verifier")
    assert lp.done()
    assert lp.reopen("a", "conflict located in a") is TileState.OPEN
    assert lp.reopens("a") == 1 and lp.attempt("a") == 1 and lp.output("a") is None
    assert lp.state("p") is TileState.OPEN and lp.output("p") is None and lp.attempt("p") == 0
    assert lp.state("g") is TileState.OPEN and lp.output("g") is None
    assert lp.state("b") is TileState.PROMOTED and lp.output("b") == _dg("b1")
    assert lp.height() == 3
    _promote(lp, "a", "a2")
    assert lp.render("p") is TileState.RENDERED
    assert lp.verify("p", True, True, "verifier") is TileState.PROMOTED
    assert lp.output("p") == _dg(_canon([_dg("a2"), _dg("b1")]))

def test_reopen_only_from_promoted_and_quarantines_after_max_reopens():
    lp = Loop(max_reopens=1)
    lp.add("a", {}, {})
    _raises(lambda: lp.reopen("a", "nothing to veto"), "reopen on an open tile must fail")
    _promote(lp, "a", "a1")
    assert lp.reopen("a", "first") is TileState.OPEN
    _promote(lp, "a", "a2")
    assert lp.reopen("a", "second") is TileState.QUARANTINED
    assert lp.reopens("a") == 2
    assert lp.output("a") == _dg("a2")
    assert lp.stuck()

def test_reopen_changes_identity_so_no_replay():
    lp = Loop()
    lp.add("a", {}, {})
    before = lp.identity("a")
    _promote(lp, "a", "same text")
    lp.reopen("a", "veto")
    assert lp.identity("a") != before
    assert lp.render("a", "same text", "gen") is TileState.RENDERED
    assert lp.output("a") is None

def test_replay_from_journal_for_identical_identity():
    lp = Loop()
    lp.add("a", {"src": "d"}, {"seed": 7})
    lp.add("c", {"src": "d"}, {"seed": 7})
    _promote(lp, "a", "shared output")
    assert lp.identity("c") == lp.identity("a")
    assert lp.render("c", "anything", "gen") is TileState.PROMOTED
    assert lp.last_code("c") == "REPLAY"
    assert lp.output("c") == _dg("shared output")
    assert lp.done()

def test_apron_stale_is_detected_at_verify():
    lp = Loop()
    lp.add("b", {}, {})
    lp.add("a", {}, {}, neighbours=["b"])
    assert lp.apron("a") == {"b": None}
    lp.render("a", "a with no b", "gen")
    _promote(lp, "b", "b1")
    assert lp.apron("a") == {"b": _dg("b1")}
    assert lp.verify("a", True, True, "verifier") is TileState.OPEN
    assert lp.last_code("a") == "APRON_STALE"
    assert lp.attempt("a") == 0
    assert lp.render("a", "a beside b1", "gen") is TileState.RENDERED
    assert lp.verify("a", True, True, "verifier") is TileState.PROMOTED
    assert lp.done()

def test_apron_is_part_of_identity():
    lp = Loop()
    lp.add("b", {}, {})
    lp.add("a", {}, {}, neighbours=["b"])
    i0 = lp.identity("a")
    _promote(lp, "b", "b1")
    assert lp.identity("a") != i0
    expected = _dg(_canon({"apron": {"b": _dg("b1")}, "attempt": 0, "children": [], "inputs": {}, "recipe": {}}))
    assert lp.identity("a") == expected

def test_unknown_tile_is_rejected_everywhere():
    lp = Loop()
    lp.add("a", {}, {})
    for fn in (lambda: lp.state("z"), lambda: lp.attempt("z"), lambda: lp.reopens("z"), lambda: lp.output("z"),
               lambda: lp.last_code("z"), lambda: lp.apron("z"), lambda: lp.identity("z"),
               lambda: lp.render("z", "x", "gen"), lambda: lp.verify("z", True, True, "v"), lambda: lp.reopen("z", "r")):
        _raises(fn, "unknown tile accepted")

def test_snapshot_shape():
    lp = Loop()
    lp.add("a", {}, {})
    lp.add("p", {}, {}, children=["a"], neighbours=[])
    _promote(lp, "a", "a1")
    s = lp.snapshot()
    ta = s["tiles"]["a"]
    assert ta["state"] == "promoted" and ta["attempt"] == 0 and ta["reopens"] == 0
    assert ta["children"] == [] and ta["neighbours"] == []
    assert ta["output"] == _dg("a1") and ta["last_code"] == "PASS"
    tp = s["tiles"]["p"]
    assert tp["state"] == "open" and tp["children"] == ["a"] and tp["output"] is None and tp["last_code"] is None

if __name__ == "__main__":
    test_identity_is_canonical_and_pinned()
    test_add_validation()
    test_leaf_render_verify_promote()
    test_render_and_verify_preconditions()
    test_failed_verify_reopens_then_quarantines()
    test_parent_assembles_only_when_children_promoted()
    test_reopen_cascades_upward_only()
    test_reopen_only_from_promoted_and_quarantines_after_max_reopens()
    test_reopen_changes_identity_so_no_replay()
    test_replay_from_journal_for_identical_identity()
    test_apron_stale_is_detected_at_verify()
    test_apron_is_part_of_identity()
    test_unknown_tile_is_rejected_everywhere()
    test_snapshot_shape()
    print("ALL ACCEPTANCE TESTS PASSED")
