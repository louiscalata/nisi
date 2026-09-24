#!/usr/bin/env python3
"""Render auditable SVG figures for the frozen local structured-output pilot.

Run from the repository root with:
    uv run --with matplotlib --no-project python benchmarks/value/charts/render.py

The source result and dataset are checked by SHA-256 before a figure is drawn.
"""

from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter


HERE = Path(__file__).resolve().parent
VALUE = HERE.parent
RESULT = VALUE / "results" / "pilot-local-gemma-20260924.json"
FIXTURE = VALUE / "fixtures" / "live-pilot-v1.json"
RESULT_SHA = "17c117821d347bf4ad248b70b319d8847bbedc2647edebf6b0a2e8edf996b10a"
FIXTURE_SHA = "cef0921e2104650b4c7f1f5f0612379d35bbe393c6152811f9236543a8a20a40"
ARMS = ("A", "B", "C")
LABELS = {
    "A": "A · one-shot draft",
    "B": "B · checked loop",
    "C": "C · Nisi workflow",
}
FAMILIES = (
    ("json_config_transform", "JSON config"),
    ("classification", "Classification"),
    ("information_extraction", "Text extraction"),
)
INK = "#152a3a"
MUTED = "#556775"
GRID = "#dbe5e9"
CORRECT = "#007466"
MISS = "#bd4e39"
CALL = "#2874a6"
REPAIR = "#ee9c56"


def verified_json(path: Path, expected_sha: str) -> dict:
    raw = path.read_bytes()
    actual_sha = sha256(raw).hexdigest()
    if actual_sha != expected_sha:
        raise ValueError(f"Source changed: {path}: {actual_sha}")
    return json.loads(raw)


def parsed_candidate(candidate: dict | None) -> tuple[bool, object]:
    """Parse the one retained answer file, rejecting duplicate keys and nonfinite values."""
    if not isinstance(candidate, dict):
        return False, None
    files = candidate.get("files")
    if not isinstance(files, list) or len(files) != 1 or not isinstance(files[0], dict) or files[0].get("path") != "answer.json":
        return False, None
    content = files[0].get("content")
    if not isinstance(content, str):
        return False, None

    def unique_keys(pairs):
        output = {}
        for key, value in pairs:
            if key in output:
                raise ValueError("Duplicate JSON key")
            output[key] = value
        return output

    try:
        parsed = json.loads(content, object_pairs_hook=unique_keys,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON number")))
    except (ValueError, TypeError, json.JSONDecodeError):
        return False, None
    return True, parsed


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def classify_output(candidate: dict | None, expected_answer: object) -> tuple[bool, bool]:
    """Return strict contract match and correct-value/wrong-wrapper status."""
    parsed_ok, parsed = parsed_candidate(candidate)
    if not parsed_ok:
        return False, False
    strict = isinstance(parsed, dict) and set(parsed) == {"answer"} and canonical(parsed["answer"]) == canonical(expected_answer)
    content_only = (
        not strict
        and isinstance(parsed, dict)
        and "answer" not in parsed
        and canonical(parsed) == canonical(expected_answer)
    )
    return strict, content_only


def load_summary() -> tuple[dict, dict]:
    result = verified_json(RESULT, RESULT_SHA)
    fixture = verified_json(FIXTURE, FIXTURE_SHA)
    tasks = fixture["tasks"]
    rows = result["rows"]
    ids = {task["id"] for task in tasks}
    if len(tasks) != 12 or len(ids) != 12 or len(rows) != 36:
        raise ValueError("Expected exactly 12 distinct tasks and 36 result rows")
    if result["datasetSha256"] != FIXTURE_SHA:
        raise ValueError("Result references a different frozen dataset")
    if Counter((row["taskId"], row["arm"]) for row in rows) != Counter(
        (task["id"], arm) for task in tasks for arm in ARMS
    ):
        raise ValueError("A task/arm pair is missing or duplicated")
    if any(row["category"] != next(t["category"] for t in tasks if t["id"] == row["taskId"]) for row in rows):
        raise ValueError("Result category does not match the frozen task")
    expected_by_id = {task["id"]: task["expectedAnswer"] for task in tasks}
    oracle_by_row = {}
    content_only_by_row = {}
    for row in rows:
        correct, content_only = classify_output(row.get("candidate"), expected_by_id[row["taskId"]])
        if correct is not row["oracleCorrect"]:
            raise ValueError(f"Stored oracle differs from independent recheck: {row['taskId']} {row['arm']}")
        oracle_by_row[(row["taskId"], row["arm"])] = correct
        content_only_by_row[(row["taskId"], row["arm"])] = content_only
    summary = {}
    for arm in ARMS:
        own = [row for row in rows if row["arm"] == arm]
        receipts = [receipt for row in own for receipt in row["receipts"]]
        usage = [receipt.get("usage", {}).get("totalTokens") for receipt in receipts]
        if any(value is None for value in usage):
            raise ValueError("Missing token usage must remain unknown, not zero")
        if any(receipt["status"] != "RESPONSE_VALIDATED" for receipt in receipts):
            raise ValueError("A receipt is not a validated response")
        summary[arm] = {
            "correct": sum(oracle_by_row[(row["taskId"], arm)] is True for row in own),
            "missed": sum(oracle_by_row[(row["taskId"], arm)] is False for row in own),
            "content_only": sum(content_only_by_row[(row["taskId"], arm)] is True for row in own),
            "calls": len(receipts),
            "repairs": sum(row["repairAttempts"] for row in own),
            "tokens": sum(usage),
            "families": {
                category: sum(oracle_by_row[(row["taskId"], arm)] is True for row in own if row["category"] == category)
                for category, _ in FAMILIES
            },
        }
    if [(summary[a]["correct"], summary[a]["calls"], summary[a]["repairs"], summary[a]["tokens"]) for a in ARMS] != [
        (6, 12, 0, 4803), (12, 18, 6, 8295), (12, 18, 6, 8291)
    ]:
        raise ValueError("Pilot totals changed; review all figures before regenerating")
    if [summary[a]["content_only"] for a in ARMS] != [6, 0, 0] or summary["A"]["missed"] != summary["A"]["content_only"]:
        raise ValueError("The six one-shot contract misses must have correct values with a missing answer wrapper")
    return result, summary


def style() -> None:
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 11,
        "text.color": INK,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "svg.fonttype": "none",
        "svg.hashsalt": RESULT_SHA,
        "savefig.facecolor": "white",
    })


def save(fig, filename: str, title: str, description: str) -> None:
    path = HERE / filename
    fig.savefig(path, format="svg", dpi=120, metadata={"Date": "2026-09-24", "Creator": "Nisi benchmark chart renderer"})
    plt.close(fig)
    svg_ns = "http://www.w3.org/2000/svg"
    xlink_ns = "http://www.w3.org/1999/xlink"
    ET.register_namespace("", svg_ns)
    ET.register_namespace("xlink", xlink_ns)
    tree = ET.parse(path)
    root = tree.getroot()
    root.set("role", "img")
    root.set("aria-labelledby", "chart-title chart-desc")
    title_node = ET.Element(f"{{{svg_ns}}}title", {"id": "chart-title"})
    title_node.text = title
    desc_node = ET.Element(f"{{{svg_ns}}}desc", {"id": "chart-desc"})
    desc_node.text = f"{description} Result SHA-256 {RESULT_SHA}; frozen dataset SHA-256 {FIXTURE_SHA}."
    root.insert(0, desc_node)
    root.insert(0, title_node)
    tree.write(path, encoding="unicode", xml_declaration=True)


def chart_outcomes(s: dict) -> None:
    fig = plt.figure(figsize=(10.6, 5.5))
    ax = fig.add_axes([0.23, 0.27, 0.71, 0.51])
    ys = [2, 1, 0]
    for y, arm in zip(ys, ARMS):
        good = s[arm]["correct"]
        bad = s[arm]["missed"]
        ax.barh(y, good, height=0.57, color=CORRECT)
        if bad:
            ax.barh(y, bad, left=good, height=0.57, color=MISS)
        ax.text(good / 2, y, f"{good} contract matches", ha="center", va="center", color="white", weight="bold")
        if bad:
            ax.text(good + bad / 2, y, f"{bad} value right; wrapper missing", ha="center", va="center", color="white", weight="bold", fontsize=10)
    ax.set_yticks(ys, [LABELS[a] for a in ARMS])
    ax.set_xlim(0, 12)
    ax.set_xticks([0, 3, 6, 9, 12])
    ax.set_xlabel("Synthetic tasks (12 per arm)")
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.spines[:].set_visible(False)
    ax.tick_params(axis="both", length=0, pad=8)
    fig.suptitle("Output contract across 12 synthetic tasks", x=0.08, ha="left", fontsize=18, weight="bold")
    fig.text(0.08, 0.87, "One local Gemma endpoint · strict answer.json contract oracle", color=MUTED, fontsize=10)
    fig.text(0.08, 0.13, "All six A misses held the right value but lacked the answer wrapper. B and C each repaired six and tied.", color=MUTED, fontsize=10)
    fig.text(0.08, 0.065, f"Exploratory repeated-task pilot · result SHA-256 {RESULT_SHA[:16]}…", color=MUTED, fontsize=9)
    save(fig, "exact-match.svg", "Output contract across 12 synthetic tasks", "A one-shot draft met the answer.json output contract for 6 tasks; its other 6 outputs held the correct value but omitted the required answer wrapper. B checked loop and C Nisi workflow each met the contract for all 12 after one repair opportunity. One local Gemma endpoint; exploratory repeated-task pilot.")


def chart_work(s: dict) -> None:
    fig = plt.figure(figsize=(11.8, 5.7))
    ax1 = fig.add_axes([0.09, 0.27, 0.37, 0.50])
    ax2 = fig.add_axes([0.58, 0.27, 0.36, 0.50])
    xs = range(3)
    drafts = [s[a]["calls"] - s[a]["repairs"] for a in ARMS]
    repairs = [s[a]["repairs"] for a in ARMS]
    ax1.bar(xs, drafts, color=CALL, width=0.62, label="Draft calls")
    ax1.bar(xs, repairs, bottom=drafts, color=REPAIR, width=0.62, label="Repair calls")
    for x, arm in zip(xs, ARMS):
        ax1.text(x, s[arm]["calls"] + 0.25, str(s[arm]["calls"]), ha="center", weight="bold")
        if s[arm]["repairs"]:
            ax1.text(x, drafts[x] + repairs[x] / 2, f"+{repairs[x]}", ha="center", va="center", weight="bold", color=INK)
    ax1.set_ylim(0, 21)
    ax1.set_yticks([0, 6, 12, 18])
    ax1.set_ylabel("Model calls across 12 tasks")
    arm_ticks = ["One-shot\ndraft", "Checked\nloop", "Nisi\nworkflow"]
    ax1.set_xticks(list(xs), arm_ticks)
    ax1.legend(loc="upper left", frameon=False, fontsize=9)
    ax2.bar(xs, [s[a]["tokens"] for a in ARMS], color=["#7daec2", CORRECT, CORRECT], width=0.62)
    for x, arm in zip(xs, ARMS):
        ax2.text(x, s[arm]["tokens"] + 100, f"{s[arm]['tokens']:,}", ha="center", weight="bold")
    ax2.set_ylim(0, 10000)
    ax2.set_ylabel("Reported prompt + completion tokens")
    ax2.set_xticks(list(xs), arm_ticks)
    ax2.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value / 1000:g}k"))
    for ax in (ax1, ax2):
        ax.grid(axis="y", color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)
        ax.spines[:].set_visible(False)
        ax.tick_params(axis="both", length=0, pad=6)
    fig.suptitle("Checking and repair used more model work", x=0.055, ha="left", fontsize=18, weight="bold")
    fig.text(0.055, 0.85, "12 synthetic tasks · one local Gemma endpoint", color=MUTED, fontsize=10)
    fig.text(0.055, 0.13, "The checked loop and Nisi each made 12 draft + 6 repair calls; both met the contract 12/12.", color=MUTED, fontsize=10)
    fig.text(0.055, 0.065, f"One local Gemma endpoint · exploratory repeated-task pilot · result SHA-256 {RESULT_SHA[:16]}…", color=MUTED, fontsize=9)
    save(fig, "calls-and-tokens.svg", "Model calls and reported tokens across the three pilot arms", "One-shot draft had 12 draft calls, no repairs, and 4803 reported tokens. Checked loop had 12 draft calls, 6 repair calls, and 8295 tokens. Nisi workflow had 12 draft calls, 6 repair calls, and 8291 tokens. Checked loop and Nisi tied on strict output-contract matches. All 48 receipts had reported token usage; the server cache state was unmeasured.")


def chart_families(s: dict) -> None:
    fig = plt.figure(figsize=(10.3, 5.8))
    ax = fig.add_axes([0.25, 0.27, 0.69, 0.51])
    for yi, (category, _) in enumerate(FAMILIES):
        for xi, arm in enumerate(ARMS):
            good = s[arm]["families"][category]
            color = CORRECT if good == 4 else ("#ebaa91" if good == 1 else "#d5e1e4")
            ax.add_patch(plt.Rectangle((xi - 0.4, yi - 0.39), 0.8, 0.78, facecolor=color, edgecolor="white", linewidth=2))
            ax.text(xi, yi, f"{good}/4", ha="center", va="center", color="white" if good == 4 else INK, weight="bold", fontsize=16)
    ax.set_xlim(-0.55, 2.55)
    ax.set_ylim(2.55, -0.55)
    ax.set_xticks(range(3), [LABELS[a] for a in ARMS])
    ax.set_yticks(range(3), [label for _, label in FAMILIES])
    ax.tick_params(axis="both", length=0, pad=9)
    ax.spines[:].set_visible(False)
    fig.suptitle("Output contract by task family", x=0.10, ha="left", fontsize=18, weight="bold")
    fig.text(0.10, 0.87, "Strict contract matches · four synthetic tasks per family", color=MUTED, fontsize=10)
    fig.text(0.10, 0.13, "All six one-shot misses had correct values but omitted the answer wrapper; both checked arms repaired them.", color=MUTED, fontsize=10)
    fig.text(0.10, 0.065, f"One local Gemma endpoint · exploratory repeated-task pilot · result SHA-256 {RESULT_SHA[:16]}…", color=MUTED, fontsize=9)
    save(fig, "task-families.svg", "Output-contract matches by synthetic task family", "On four JSON configuration tasks one-shot draft met the output contract once; checked loop and Nisi each met it four times. On four classification tasks all arms met the contract four times. On four text extraction tasks one-shot draft met it once; checked loop and Nisi each met it four times. All six one-shot contract misses had the correct value but omitted the required answer wrapper. One-shot had no repair opportunity; checked loop and Nisi had one.")


if __name__ == "__main__":
    _, summary = load_summary()
    style()
    chart_outcomes(summary)
    chart_work(summary)
    chart_families(summary)
    for arm in ARMS:
        print(arm, summary[arm])
    print("Wrote:", *(str(HERE / name) for name in ("exact-match.svg", "calls-and-tokens.svg", "task-families.svg")), sep="\n")
