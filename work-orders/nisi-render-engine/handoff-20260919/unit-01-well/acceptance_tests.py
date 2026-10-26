# --- acceptance tests: immutable, supplied by the task owner -----------------

def _mk(layers=("L1", "L2", "L3"), tiles=("a", "b"), **kw):
    return Well(list(layers), list(tiles), **kw)

def _fill(w, layer, text="ok", source="gen"):
    for t in w.tiles:
        w.place(layer, t, text, source)

def _raises(fn, why):
    try:
        fn()
    except WellError:
        return
    assert False, why

def test_default_deps_are_strict_bottom_up():
    w = _mk()
    assert w.layers == ["L1", "L2", "L3"] and w.tiles == ["a", "b"]
    assert w.deps("L1") == set()
    assert w.deps("L2") == {"L1"}
    assert w.deps("L3") == {"L2"}
    assert w.dependents("L1") == ["L2", "L3"]
    assert w.dependents("L3") == []

def test_rows_start_open_with_every_tile_a_hole():
    w = _mk()
    for L in ("L1", "L2", "L3"):
        assert w.state(L) is RowState.OPEN
        assert w.holes(L) == ["a", "b"]
        assert w.reopens(L) == 0
    assert w.height() == 3
    assert not w.done()
    assert not w.stuck()

def test_row_becomes_full_only_when_every_tile_is_a_non_hole():
    w = _mk()
    assert w.place("L1", "a", "def f(): return 1", "gen") is RowState.OPEN
    assert w.holes("L1") == ["b"]
    assert w.place("L1", "b", "TODO: write g", "gen") is RowState.OPEN
    assert w.holes("L1") == ["b"]
    assert w.place("L1", "b", "   ", "gen") is RowState.OPEN
    assert w.holes("L1") == ["b"]
    assert w.place("L1", "b", "def g(): return 2", "fill") is RowState.FULL
    assert w.holes("L1") == []

def test_custom_hole_detector_replaces_the_default():
    w = _mk(is_hole=lambda s: "???" in s)
    assert w.place("L1", "a", "TODO but fine here", "gen") is RowState.OPEN
    assert w.holes("L1") == ["b"]
    assert w.place("L1", "b", "x ???", "gen") is RowState.OPEN
    assert w.holes("L1") == ["b"]
    assert w.place("L1", "b", "x", "gen") is RowState.FULL

def test_replacing_a_cell_with_a_hole_reopens_a_full_row():
    w = _mk()
    _fill(w, "L1")
    assert w.state("L1") is RowState.FULL
    assert w.place("L1", "a", "", "fill") is RowState.OPEN
    assert w.holes("L1") == ["a"]

def test_check_only_from_full_and_report_only_from_checking():
    w = _mk()
    _raises(lambda: w.begin_check("L1"), "begin_check on an open row must fail")
    _raises(lambda: w.report_check("L1", True, True), "report_check outside a check must fail")
    _fill(w, "L1")
    w.begin_check("L1")
    assert w.state("L1") is RowState.CHECKING
    _raises(lambda: w.place("L1", "a", "late", "gen"), "placing during a check must fail")
    _raises(lambda: w.begin_check("L1"), "a second begin_check must fail")

def test_bottom_row_clears_immediately_on_pass_and_is_immutable():
    w = _mk()
    _fill(w, "L1")
    w.begin_check("L1")
    assert w.report_check("L1", True, True) is RowState.CLEARED
    assert w.height() == 2
    _raises(lambda: w.place("L1", "a", "edit", "gen"), "cleared rows are immutable")
    _raises(lambda: w.begin_check("L1"), "cleared rows are not re-checked")

def test_upper_rows_wait_as_passed_then_clear_together_when_the_base_clears():
    w = _mk()
    _fill(w, "L2")
    w.begin_check("L2")
    assert w.report_check("L2", True, True) is RowState.PASSED
    _fill(w, "L3")
    w.begin_check("L3")
    assert w.report_check("L3", True, True) is RowState.PASSED
    assert w.height() == 3
    _fill(w, "L1")
    w.begin_check("L1")
    assert w.report_check("L1", True, True) is RowState.CLEARED
    assert w.state("L2") is RowState.CLEARED
    assert w.state("L3") is RowState.CLEARED
    assert w.done()
    assert w.height() == 0

def test_failed_check_reopens_the_row_and_blanks_the_named_tiles():
    w = _mk()
    _fill(w, "L1")
    w.begin_check("L1")
    assert w.report_check("L1", False, True, failed_tiles=["b"]) is RowState.OPEN
    assert w.holes("L1") == ["b"]
    assert w.place("L1", "b", "fixed", "fill") is RowState.FULL

def test_failed_check_without_named_tiles_blanks_every_tile():
    w = _mk()
    _fill(w, "L1")
    w.begin_check("L1")
    assert w.report_check("L1", True, False) is RowState.OPEN
    assert w.holes("L1") == ["a", "b"]

def test_reopen_cascades_to_dependents_and_keeps_their_content():
    w = _mk()
    for L in ("L1", "L2", "L3"):
        _fill(w, L)
        w.begin_check(L)
        w.report_check(L, True, True)
    assert w.done()
    assert w.reopen("L1", ["a"], "covered hole: L3 contradicts L1.a") is RowState.OPEN
    assert w.holes("L1") == ["a"]
    assert w.reopens("L1") == 1
    assert w.state("L2") is RowState.FULL
    assert w.state("L3") is RowState.FULL
    assert w.holes("L2") == []
    assert w.holes("L3") == []
    assert w.height() == 3
    _raises(lambda: w.report_check("L2", True, True), "a cascaded row is no longer checking")
    w.begin_check("L2")
    assert w.report_check("L2", True, True) is RowState.PASSED

def test_reopen_only_from_cleared_or_passed():
    w = _mk()
    _raises(lambda: w.reopen("L1", ["a"], "nothing to veto"), "reopen on an open row must fail")
    _fill(w, "L2")
    w.begin_check("L2")
    assert w.report_check("L2", True, True) is RowState.PASSED
    assert w.reopen("L2", [], "veto a passed row") is RowState.OPEN
    assert w.holes("L2") == ["a", "b"]

def test_the_reopen_after_max_reopens_quarantines_the_row():
    w = _mk(layers=("L1",), max_reopens=2)
    def clear():
        _fill(w, "L1")
        w.begin_check("L1")
        assert w.report_check("L1", True, True) is RowState.CLEARED
    clear()
    assert w.reopen("L1", ["a"], "first") is RowState.OPEN
    clear()
    assert w.reopen("L1", ["a"], "second") is RowState.OPEN
    clear()
    assert w.reopen("L1", ["a"], "third") is RowState.QUARANTINED
    assert w.reopens("L1") == 3
    assert w.stuck()
    assert not w.done()
    assert w.height() == 1
    assert w.holes("L1") == []
    _raises(lambda: w.place("L1", "a", "x", "gen"), "quarantined rows are frozen")
    _raises(lambda: w.begin_check("L1"), "quarantined rows are not checked")

def test_declared_dag_lets_independent_rows_clear_in_any_order():
    w = Well(["intent", "docs", "impl"], ["a"], deps={"impl": ["intent"], "docs": ["intent"]})
    assert w.deps("intent") == set()
    assert w.dependents("intent") == ["docs", "impl"]
    assert w.dependents("docs") == []
    _fill(w, "intent")
    w.begin_check("intent")
    assert w.report_check("intent", True, True) is RowState.CLEARED
    _fill(w, "impl")
    w.begin_check("impl")
    assert w.report_check("impl", True, True) is RowState.CLEARED
    assert w.state("docs") is RowState.OPEN

def test_invalid_construction_is_rejected():
    for deps in ({"L2": ["nope"]}, {"nope": ["L1"]}, {"L1": ["L1"]}, {"L1": ["L2"], "L2": ["L1"]}):
        _raises(lambda: Well(["L1", "L2"], ["a"], deps=deps), "bad deps accepted: %r" % (deps,))
    _raises(lambda: Well(["L1", "L1"], ["a"]), "duplicate layers accepted")
    _raises(lambda: Well(["L1"], ["a", "a"]), "duplicate tiles accepted")
    _raises(lambda: Well([], ["a"]), "empty layers accepted")
    _raises(lambda: Well(["L1"], []), "empty tiles accepted")

def test_unknown_layer_or_tile_is_rejected():
    w = _mk()
    _raises(lambda: w.place("L9", "a", "x", "g"), "unknown layer accepted by place")
    _raises(lambda: w.place("L1", "z", "x", "g"), "unknown tile accepted by place")
    _raises(lambda: w.state("L9"), "unknown layer accepted by state")
    _raises(lambda: w.holes("L9"), "unknown layer accepted by holes")
    _raises(lambda: w.dependents("L9"), "unknown layer accepted by dependents")

def test_snapshot_reports_states_sources_and_holes():
    w = _mk()
    w.place("L1", "a", "x", "gen")
    s = w.snapshot()
    assert s["layers"] == ["L1", "L2", "L3"]
    assert s["tiles"] == ["a", "b"]
    row = s["rows"]["L1"]
    assert row["state"] == "open"
    assert row["reopens"] == 0
    assert row["cells"]["a"]["source"] == "gen"
    assert row["cells"]["a"]["hole"] is False
    assert row["cells"]["b"]["source"] is None
    assert row["cells"]["b"]["hole"] is True
    assert s["rows"]["L3"]["state"] == "open"

def test_diamond_dependencies_are_a_dag_not_a_cycle():
    w = Well(["intent", "interfaces", "impl", "tests"], ["a"],
             deps={"interfaces": ["intent"], "impl": ["interfaces"], "tests": ["interfaces", "impl"]})
    assert w.dependents("intent") == ["interfaces", "impl", "tests"]
    assert w.dependents("interfaces") == ["impl", "tests"]
    assert w.deps("tests") == {"interfaces", "impl"}
    for L in ("tests", "impl", "interfaces"):
        _fill(w, L)
        w.begin_check(L)
        assert w.report_check(L, True, True) is RowState.PASSED
    _fill(w, "intent")
    w.begin_check("intent")
    assert w.report_check("intent", True, True) is RowState.CLEARED
    assert w.done()

def test_unknown_layer_in_check_and_reopen_calls_is_rejected():
    w = _mk()
    _raises(lambda: w.begin_check("L9"), "unknown layer accepted by begin_check")
    _raises(lambda: w.report_check("L9", True, True), "unknown layer accepted by report_check")
    _raises(lambda: w.reopen("L9", ["a"], "x"), "unknown layer accepted by reopen")
    _raises(lambda: w.reopens("L9"), "unknown layer accepted by reopens")
    _raises(lambda: w.deps("L9"), "unknown layer accepted by deps")

if __name__ == "__main__":
    test_default_deps_are_strict_bottom_up()
    test_rows_start_open_with_every_tile_a_hole()
    test_row_becomes_full_only_when_every_tile_is_a_non_hole()
    test_custom_hole_detector_replaces_the_default()
    test_replacing_a_cell_with_a_hole_reopens_a_full_row()
    test_check_only_from_full_and_report_only_from_checking()
    test_bottom_row_clears_immediately_on_pass_and_is_immutable()
    test_upper_rows_wait_as_passed_then_clear_together_when_the_base_clears()
    test_failed_check_reopens_the_row_and_blanks_the_named_tiles()
    test_failed_check_without_named_tiles_blanks_every_tile()
    test_reopen_cascades_to_dependents_and_keeps_their_content()
    test_reopen_only_from_cleared_or_passed()
    test_the_reopen_after_max_reopens_quarantines_the_row()
    test_declared_dag_lets_independent_rows_clear_in_any_order()
    test_invalid_construction_is_rejected()
    test_unknown_layer_or_tile_is_rejected()
    test_snapshot_reports_states_sources_and_holes()
    test_diamond_dependencies_are_a_dag_not_a_cycle()
    test_unknown_layer_in_check_and_reopen_calls_is_rejected()
    print("ALL ACCEPTANCE TESTS PASSED")
