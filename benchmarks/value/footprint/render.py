#!/usr/bin/env python3
"""Render the pinned, dependency-free package archive comparison.

From the repository root:
    python3 benchmarks/value/footprint/render.py
    python3 benchmarks/value/footprint/render.py --check
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import sys
from xml.sax.saxutils import escape


HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "packages.json"
OUTPUT = HERE.parent / "charts" / "package-footprint.svg"
WIDTH = 1000
HEIGHT = 520
PLOT_LEFT = 337
PLOT_RIGHT = 775
ROW_Y = (172, 241, 310)
INK = "#152a3a"
MUTED = "#556775"
GRID = "#dbe5e9"
COLORS = ("#007466", "#2874a6", "#7755b7")
TICKS = ((10000, "10 kB"), (100000, "100 kB"), (1000000, "1 MB"), (10000000, "10 MB"))


def source_data() -> tuple[dict, str]:
    raw = MANIFEST.read_bytes()
    data = json.loads(raw)
    if data.get("schemaVersion") != 1 or data.get("metric") != "compressedArchiveBytes":
        raise ValueError("Unexpected footprint manifest schema or metric")
    axis = data["axis"]
    low, high = axis["minimumBytes"], axis["maximumBytes"]
    if not (isinstance(low, int) and isinstance(high, int) and 0 < low < high):
        raise ValueError("Invalid logarithmic axis bounds")
    packages = data["packages"]
    if len(packages) != len(ROW_Y):
        raise ValueError("This figure requires exactly three packages")
    seen = set()
    for package in packages:
        value = package["compressedArchiveBytes"]
        if not (isinstance(value, int) and low <= value <= high):
            raise ValueError("Package size is outside the positive axis range")
        if package["id"] in seen or not package["sourceUrl"].startswith("https://"):
            raise ValueError("Duplicate package or missing HTTPS source")
        seen.add(package["id"])
    return data, hashlib.sha256(raw).hexdigest()


def x_for(value: int, low: int, high: int) -> float:
    return PLOT_LEFT + (math.log10(value) - math.log10(low)) / (
        math.log10(high) - math.log10(low)
    ) * (PLOT_RIGHT - PLOT_LEFT)


def render() -> str:
    data, source_sha = source_data()
    packages = data["packages"]
    low, high = data["axis"]["minimumBytes"], data["axis"]["maximumBytes"]
    descriptions = "; ".join(
        f"{row['package']}: {row['compressedArchiveBytes']:,} compressed bytes"
        for row in packages
    )
    description = (
        f"Logarithmic compressed-archive comparison. {descriptions}. "
        "Package size does not measure model token usage. Products serve different "
        "functions and include different files; transitive dependencies and installed "
        f"size are excluded. Captured {data['capturedOn']}. Manifest SHA-256 {source_sha}."
    )
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="footprint-title footprint-desc">',
        '  <title id="footprint-title">Compressed package archive footprint on a logarithmic byte scale</title>',
        f'  <desc id="footprint-desc">{escape(description)}</desc>',
        f'  <rect x="0" y="0" width="{WIDTH}" height="{HEIGHT}" fill="#ffffff"/>',
        '  <text x="36" y="52" font-family="system-ui, sans-serif" font-size="27" '
        f'font-weight="700" fill="{INK}">Compressed package archives</text>',
        '  <text x="36" y="81" font-family="system-ui, sans-serif" font-size="16" '
        f'fill="{MUTED}">Published package bytes · logarithmic scale (base 10)</text>',
        '  <text x="36" y="119" font-family="system-ui, sans-serif" font-size="13" '
        f'font-weight="700" fill="{MUTED}">PRODUCT AND PACKAGE</text>',
        '  <text x="960" y="119" text-anchor="end" font-family="system-ui, sans-serif" '
        f'font-size="13" font-weight="700" fill="{MUTED}">EXACT COMPRESSED BYTES</text>',
    ]
    for tick, label in TICKS:
        if low <= tick <= high:
            x = x_for(tick, low, high)
            lines.extend((
                f'  <line x1="{x:.2f}" y1="134" x2="{x:.2f}" y2="351" stroke="{GRID}" stroke-width="1"/>',
                f'  <text x="{x:.2f}" y="377" text-anchor="middle" font-family="system-ui, sans-serif" '
                f'font-size="14" fill="{MUTED}">{escape(label)}</text>',
            ))
    lines.append(
        f'  <line x1="{PLOT_LEFT}" y1="351" x2="{PLOT_RIGHT}" y2="351" stroke="{MUTED}" stroke-width="1.5"/>'
    )
    for row, y, color in zip(packages, ROW_Y, COLORS, strict=True):
        x = x_for(row["compressedArchiveBytes"], low, high)
        lines.extend((
            f'  <line x1="{PLOT_LEFT}" y1="{y}" x2="{PLOT_RIGHT}" y2="{y}" stroke="{GRID}" stroke-width="2"/>',
            f'  <line x1="{PLOT_LEFT}" y1="{y}" x2="{x:.2f}" y2="{y}" stroke="{color}" stroke-width="5"/>',
            f'  <circle cx="{x:.2f}" cy="{y}" r="8" fill="{color}" stroke="#ffffff" stroke-width="2"/>',
            f'  <text x="36" y="{y - 8}" font-family="system-ui, sans-serif" font-size="19" '
            f'font-weight="700" fill="{INK}">{escape(row["product"])}</text>',
            f'  <text x="36" y="{y + 14}" font-family="system-ui, sans-serif" font-size="13" '
            f'fill="{MUTED}">{escape(row["package"])}</text>',
            f'  <text x="960" y="{y + 6}" text-anchor="end" font-family="system-ui, sans-serif" '
            f'font-size="18" font-weight="700" fill="{INK}">{row["compressedArchiveBytes"]:,} bytes</text>',
        ))
    lines.extend((
        '  <rect x="28" y="398" width="944" height="108" rx="9" fill="#f3f8f8" stroke="#cadcdd"/>',
        f'  <text x="44" y="427" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="{INK}">Package size does not measure model token usage.</text>',
        f'  <text x="44" y="451" font-family="system-ui, sans-serif" font-size="14" fill="{INK}">These products serve different functions and include different files.</text>',
        f'  <text x="44" y="473" font-family="system-ui, sans-serif" font-size="14" fill="{INK}">Transitive dependency sizes and installed size are excluded.</text>',
        f'  <text x="44" y="495" font-family="system-ui, sans-serif" font-size="14" fill="{INK}">Nisi: GitHub release asset. Others: npm pack dry-run, {escape(data["capturedOn"])}.</text>',
        '</svg>',
    ))
    return "\n".join(lines) + "\n"


def main() -> None:
    svg = render()
    if sys.argv[1:] == ["--check"]:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != svg:
            raise SystemExit("Package footprint chart is stale; run render.py")
        print(f"Up to date: {OUTPUT}")
    elif not sys.argv[1:]:
        OUTPUT.write_text(svg, encoding="utf-8")
        print(f"Wrote {OUTPUT}")
    else:
        raise SystemExit("Usage: python3 benchmarks/value/footprint/render.py [--check]")


if __name__ == "__main__":
    main()
