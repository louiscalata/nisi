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

def _shot(lp, a_inputs, b_inputs):
    lp.add("a", a_inputs, {"k": "a"})
    lp.add("b", b_inputs, {"k": "b"})
    lp.add("p", {}, {"k": "p"}, children=["a", "b"])

def test_identity_is_pinned_and_excludes_attempt():
    lp = Loop()
    lp.add("a", {"src": "d1"}, {"seed": 1, "model": "m"})
    expected = _dg(_canon({"apron": {}, "children": [], "inputs": {"src": "d1"}, "recipe": {"model": "m", "seed": 1}}))
    assert lp.identity("a") == expected
    _promote(lp, "a", "v1")
    lp.reopen("a", "veto")
    assert lp.attempt("a") == 1
    assert lp.identity("a") == expected

def test_journal_is_shared_and_exposed():
    shared = {}
    lp = Loop(journal=shared)
    assert lp.journal is shared
    lp.add("a", {}, {})
    _promote(lp, "a", "v1")
    assert shared[lp.identity("a")] == _dg("v1")
    fresh = Loop()
    assert isinstance(fresh.journal, dict) and fresh.journal == {}

def test_leaf_render_verify_promote_and_preconditions():
    lp = Loop()
    lp.add("a", {"src": "d1"}, {"seed": 1})
    _raises(lambda: lp.verify("a", True, True, "verifier"), "verify on open must fail")
    _raises(lambda: lp.render("a", None, "gen"), "leaf without output must fail")
    _raises(lambda: lp.render("a", "x", ""), "leaf without source must fail")
    assert lp.render("a", "cell a v1", "gen") is TileState.RENDERED
    _raises(lambda: lp.render("a", "x", "gen"), "double render must fail")
    _raises(lambda: lp.verify("a", True, True, "gen"), "author reviewing its own work must fail")
    assert lp.state("a") is TileState.RENDERED
    assert lp.verify("a", True, True, "verifier") is TileState.PROMOTED
    assert lp.output("a") == _dg("cell a v1")
    assert lp.last_code("a") == "PASS"
    assert lp.done() and lp.height() == 0

def test_failed_verify_then_quarantine():
    lp = Loop(max_attempts=2)
    lp.add("a", {}, {})
    lp.render("a", "v1", "gen")
    assert lp.verify("a", False, True, "verifier") is TileState.OPEN
    assert lp.last_code("a") == "VALIDITY_FAIL" and lp.attempt("a") == 1
    lp.render("a", "v2", "gen")
    assert lp.verify("a", True, False, "verifier") is TileState.OPEN
    assert lp.last_code("a") == "QUALITY_FAIL" and lp.attempt("a") == 2
    lp.render("a", "v3", "gen")
    assert lp.verify("a", False, False, "verifier") is TileState.QUARANTINED
    assert lp.stuck() and lp.height() == 1
    _raises(lambda: lp.render("a", "v4", "gen"), "quarantined tiles are frozen")
    assert lp.journal == {}

def test_reopen_tombstones_the_identity_and_blocks_replay_in_the_same_job():
    lp = Loop()
    lp.add("a", {}, {})
    _promote(lp, "a", "same text")
    ident = lp.identity("a")
    assert lp.journal[ident] == _dg("same text")
    assert lp.reopen("a", "veto") is TileState.OPEN
    assert ident in lp.journal and lp.journal[ident] is None
    assert lp.output("a") is None
    assert lp.render("a", "same text", "gen") is TileState.RENDERED
    assert lp.verify("a", True, True, "verifier") is TileState.PROMOTED
    assert lp.journal[ident] == _dg("same text")

def test_vetoed_identity_never_replays_in_a_second_job():
    shared = {}
    job1 = Loop(journal=shared)
    job1.add("a", {"src": "d1"}, {"seed": 7})
    _promote(job1, "a", "bad output")
    job1.reopen("a", "client rejected it")
    ident = job1.identity("a")
    assert shared[ident] is None
    job2 = Loop(journal=shared)
    job2.add("a", {"src": "d1"}, {"seed": 7})
    assert job2.identity("a") == ident
    assert job2.render("a", "good output", "gen") is TileState.RENDERED
    assert job2.last_code("a") is None
    assert job2.verify("a", True, True, "verifier") is TileState.PROMOTED
    assert shared[ident] == _dg("good output")
    job3 = Loop(journal=shared)
    job3.add("a", {"src": "d1"}, {"seed": 7})
    assert job3.render("a", "anything", "gen") is TileState.PROMOTED
    assert job3.last_code("a") == "REPLAY" and job3.output("a") == _dg("good output")

def test_unchanged_resubmit_replays_the_whole_shot():
    shared = {}
    job1 = Loop(journal=shared)
    _shot(job1, {"src": "d1"}, {"src": "d2"})
    _promote(job1, "a", "a1"); _promote(job1, "b", "b1")
    job1.render("p"); job1.verify("p", True, True, "verifier")
    assert job1.done()
    job2 = Loop(journal=shared)
    _shot(job2, {"src": "d1"}, {"src": "d2"})
    assert job2.render("a", "ignored", "gen") is TileState.PROMOTED
    assert job2.render("b", "ignored", "gen") is TileState.PROMOTED
    assert job2.render("p") is TileState.PROMOTED
    assert all(job2.last_code(t) == "REPLAY" for t in ("a", "b", "p"))
    assert job2.output("p") == job1.output("p")
    assert job2.done()

def test_decoy_resave_with_unchanged_content_replays():
    shared = {}
    job1 = Loop(journal=shared)
    job1.add("shot-010", {"level": "d1", "sequence": "d2"}, {"engine": "unity-6000.4", "recipe": "beauty"})
    _promote(job1, "shot-010", "frames")
    job2 = Loop(journal=shared)
    job2.add("shot-010-resubmitted", {"sequence": "d2", "level": "d1"}, {"recipe": "beauty", "engine": "unity-6000.4"})
    assert job2.render("shot-010-resubmitted", "would-be-rerender", "gen") is TileState.PROMOTED
    assert job2.last_code("shot-010-resubmitted") == "REPLAY"
    assert job2.output("shot-010-resubmitted") == _dg("frames")

def test_partial_change_replays_only_the_untouched_tiles():
    shared = {}
    job1 = Loop(journal=shared)
    _shot(job1, {"src": "d1"}, {"src": "d2"})
    _promote(job1, "a", "a1"); _promote(job1, "b", "b1")
    job1.render("p"); job1.verify("p", True, True, "verifier")
    job2 = Loop(journal=shared)
    _shot(job2, {"src": "d1"}, {"src": "d2-edited"})
    assert job2.render("a", "ignored", "gen") is TileState.PROMOTED
    assert job2.last_code("a") == "REPLAY"
    assert job2.render("b", "b2", "gen") is TileState.RENDERED
    assert job2.verify("b", True, True, "verifier") is TileState.PROMOTED
    assert job2.render("p") is TileState.RENDERED
    assert job2.verify("p", True, True, "verifier") is TileState.PROMOTED
    assert job2.output("p") == _dg(_canon([_dg("a1"), _dg("b2")]))
    assert job2.output("p") != job1.output("p")

def test_parent_assembles_only_when_children_promoted():
    lp = Loop()
    _shot(lp, {}, {})
    _raises(lambda: lp.render("p"), "parent before children promoted")
    _promote(lp, "a", "out a")
    _raises(lambda: lp.render("p"), "parent with one child open")
    _promote(lp, "b", "out b")
    assert lp.render("p") is TileState.RENDERED
    _raises(lambda: lp.verify("p", True, True, "assemble"), "assembler cannot review its own assembly")
    assert lp.verify("p", True, True, "verifier") is TileState.PROMOTED
    assert lp.output("p") == _dg(_canon([_dg("out a"), _dg("out b")]))

def test_reopen_cascades_upward_only_and_leaves_ancestor_journal_entries():
    lp = Loop()
    _shot(lp, {}, {})
    lp.add("g", {}, {}, children=["p"])
    _promote(lp, "a", "a1"); _promote(lp, "b", "b1")
    lp.render("p"); lp.verify("p", True, True, "verifier")
    lp.render("g"); lp.verify("g", True, True, "verifier")
    p_ident = lp.identity("p")
    assert lp.reopen("a", "conflict located in a") is TileState.OPEN
    assert lp.state("p") is TileState.OPEN and lp.output("p") is None and lp.attempt("p") == 0
    assert lp.state("g") is TileState.OPEN and lp.output("g") is None
    assert lp.state("b") is TileState.PROMOTED
    assert lp.journal[p_ident] == _dg(_canon([_dg("a1"), _dg("b1")]))
    _promote(lp, "a", "a1")
    assert lp.render("p") is TileState.PROMOTED
    assert lp.last_code("p") == "REPLAY"

def test_reopen_only_from_promoted_and_quarantine_keeps_journal():
    lp = Loop(max_reopens=1)
    lp.add("a", {}, {})
    _raises(lambda: lp.reopen("a", "nothing to veto"), "reopen on open must fail")
    _promote(lp, "a", "a1")
    ident = lp.identity("a")
    assert lp.reopen("a", "first") is TileState.OPEN
    _promote(lp, "a", "a2")
    assert lp.journal[ident] == _dg("a2")
    assert lp.reopen("a", "second") is TileState.QUARANTINED
    assert lp.reopens("a") == 2 and lp.output("a") == _dg("a2")
    assert lp.journal[ident] == _dg("a2")
    assert lp.stuck()

def test_apron_stale_is_detected_at_verify():
    lp = Loop()
    lp.add("b", {}, {})
    lp.add("a", {}, {}, neighbours=["b"])
    assert lp.apron("a") == {"b": None}
    lp.render("a", "a with no b", "gen")
    _promote(lp, "b", "b1")
    assert lp.apron("a") == {"b": _dg("b1")}
    assert lp.verify("a", True, True, "verifier") is TileState.OPEN
    assert lp.last_code("a") == "APRON_STALE" and lp.attempt("a") == 0
    assert lp.render("a", "a beside b1", "gen") is TileState.RENDERED
    assert lp.verify("a", True, True, "verifier") is TileState.PROMOTED
    assert lp.done()

def test_add_validation_and_unknown_ids():
    lp = Loop()
    lp.add("a", {}, {})
    _raises(lambda: lp.add("a", {}, {}), "duplicate id")
    _raises(lambda: lp.add("b", {}, {}, neighbours=["zzz"]), "unknown neighbour")
    _raises(lambda: lp.add("b", {}, {}, children=["zzz"]), "unknown child")
    _raises(lambda: lp.add("b", {}, {}, children=["b"]), "self child")
    lp.add("p", {}, {}, children=["a"])
    _raises(lambda: lp.add("q", {}, {}, children=["a"]), "two parents")
    for fn in (lambda: lp.state("z"), lambda: lp.attempt("z"), lambda: lp.reopens("z"), lambda: lp.output("z"),
               lambda: lp.last_code("z"), lambda: lp.apron("z"), lambda: lp.identity("z"),
               lambda: lp.render("z", "x", "gen"), lambda: lp.verify("z", True, True, "v"), lambda: lp.reopen("z", "r")):
        _raises(fn, "unknown tile accepted")

def test_snapshot_shape():
    lp = Loop()
    lp.add("a", {}, {})
    lp.add("p", {}, {}, children=["a"])
    _promote(lp, "a", "a1")
    s = lp.snapshot()
    ta = s["tiles"]["a"]
    assert ta["state"] == "promoted" and ta["attempt"] == 0 and ta["reopens"] == 0
    assert ta["children"] == [] and ta["neighbours"] == [] and ta["output"] == _dg("a1") and ta["last_code"] == "PASS"
    tp = s["tiles"]["p"]
    assert tp["state"] == "open" and tp["children"] == ["a"] and tp["output"] is None and tp["last_code"] is None

if __name__ == "__main__":
    test_identity_is_pinned_and_excludes_attempt()
    test_journal_is_shared_and_exposed()
    test_leaf_render_verify_promote_and_preconditions()
    test_failed_verify_then_quarantine()
    test_reopen_tombstones_the_identity_and_blocks_replay_in_the_same_job()
    test_vetoed_identity_never_replays_in_a_second_job()
    test_unchanged_resubmit_replays_the_whole_shot()
    test_decoy_resave_with_unchanged_content_replays()
    test_partial_change_replays_only_the_untouched_tiles()
    test_parent_assembles_only_when_children_promoted()
    test_reopen_cascades_upward_only_and_leaves_ancestor_journal_entries()
    test_reopen_only_from_promoted_and_quarantine_keeps_journal()
    test_apron_stale_is_detected_at_verify()
    test_add_validation_and_unknown_ids()
    test_snapshot_shape()
    print("ALL ACCEPTANCE TESTS PASSED")
