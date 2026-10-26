# --- acceptance tests: immutable, supplied by the task owner -----------------
import struct as _struct
import zlib as _zlib
import math as _math

_MAGIC = _struct.pack("<i", 20000630)
_PT = {"uint": 0, "half": 1, "float": 2}
_FMT = {"uint": "I", "half": "e", "float": "f"}
_SIZE = {"uint": 4, "half": 2, "float": 4}

def _attr(name, typ, value):
    return name.encode() + b"\0" + typ.encode() + b"\0" + _struct.pack("<i", len(value)) + value

def _chlist(names, pixel_type):
    out = b""
    for n in names:
        out += n.encode() + b"\0" + _struct.pack("<i", _PT[pixel_type]) + b"\0" + b"\0\0\0" + _struct.pack("<ii", 1, 1)
    return out + b"\0"

def _zip_encode(raw):
    n = len(raw); half = (n + 1) // 2
    t = bytearray(n); t[:half] = raw[0::2]; t[half:] = raw[1::2]
    d = bytearray(t)
    for i in range(1, n):
        d[i] = (t[i] - t[i - 1] + 128) & 0xFF
    return _zlib.compress(bytes(d))

def exr_bytes(width, height, channels, compression="NONE", pixel_type="float", flags=0, compression_byte=None,
              header_extra=None, drop_attr=None, sorted_names=True, version_low=2, line_order=0, chunk_y_offset=0, corrupt_zip=False):
    """Build a scanline EXR from channels: dict name -> list of width*height numbers (row-major)."""
    names = sorted(channels) if sorted_names else list(channels)
    comp = {"NONE": 0, "ZIPS": 2, "ZIP": 3}[compression]
    lines_per_chunk = {"NONE": 1, "ZIPS": 1, "ZIP": 16}[compression]
    attrs = []
    def add(name, typ, val):
        if drop_attr != name:
            attrs.append(_attr(name, typ, val))
    add("channels", "chlist", _chlist(names, pixel_type))
    add("compression", "compression", bytes([comp if compression_byte is None else compression_byte]))
    add("dataWindow", "box2i", _struct.pack("<iiii", 0, 0, width - 1, height - 1))
    add("displayWindow", "box2i", _struct.pack("<iiii", 0, 0, width - 1, height - 1))
    add("lineOrder", "lineOrder", bytes([line_order]))
    add("pixelAspectRatio", "float", _struct.pack("<f", 1.0))
    add("screenWindowCenter", "v2f", _struct.pack("<ff", 0.0, 0.0))
    add("screenWindowWidth", "float", _struct.pack("<f", 1.0))
    if header_extra:
        attrs.append(header_extra)
    header = _MAGIC + _struct.pack("<i", version_low | flags) + b"".join(attrs) + b"\0"
    nchunks = -(-height // lines_per_chunk)
    chunks = []
    for c in range(nchunks):
        y0 = c * lines_per_chunk
        raw = b""
        for y in range(y0, min(y0 + lines_per_chunk, height)):
            for n in names:
                row = channels[n][y * width:(y + 1) * width]
                raw += _struct.pack("<" + _FMT[pixel_type] * width, *row)
        if comp in (2, 3):
            enc = _zip_encode(raw)
            if corrupt_zip:
                enc = enc[:-3] + b"\0\0\0"
            data = enc if len(enc) < len(raw) else raw
        else:
            data = raw
        chunks.append(_struct.pack("<ii", y0 + chunk_y_offset, len(data)) + data)
    table_len = 8 * nchunks
    offsets = []
    pos = len(header) + table_len
    for ch in chunks:
        offsets.append(pos); pos += len(ch)
    return header + b"".join(_struct.pack("<Q", o) for o in offsets) + b"".join(chunks)

def _flat(width, height, fn):
    return [fn(x, y) for y in range(height) for x in range(width)]

def _rgb(width, height, r=0.5, g=0.25, b=0.125):
    return {"R": [r] * (width * height), "G": [g] * (width * height), "B": [b] * (width * height)}

def _expect_error(fn, code):
    try:
        fn()
    except ExrError as e:
        assert e.code == code, f"expected {code}, got {e.code}: {e.detail}"
        assert isinstance(e.detail, str)
        return
    assert False, f"expected ExrError {code}"

def _close(a, b, tol=1e-6):
    return abs(a - b) <= tol

def test_codes_tuple():
    assert EXR_CODES == ("BAD_MAGIC", "UNSUPPORTED_VERSION", "UNSUPPORTED_TILED", "UNSUPPORTED_DEEP", "UNSUPPORTED_MULTIPART", "HEADER_INVALID", "UNSUPPORTED_COMPRESSION", "TRUNCATED", "CORRUPT", "CHANNEL_MISSING", "NAN_PIXELS", "BLACK_FRAME", "FLICKER")
    e = ExrError("BAD_MAGIC", "x")
    assert e.code == "BAD_MAGIC" and e.detail == "x"

def test_roundtrip_none_float():
    w, h = 5, 3
    ch = {"R": _flat(w, h, lambda x, y: x * 0.1 + y), "G": _flat(w, h, lambda x, y: 1.0), "B": _flat(w, h, lambda x, y: -x * 1.0)}
    img = read_exr(exr_bytes(w, h, ch))
    assert img["width"] == 5 and img["height"] == 3 and img["compression"] == "NONE"
    assert list(img["channels"]) == ["B", "G", "R"]
    for n in ch:
        assert img["channels"][n]["type"] == "float"
        assert all(_close(a, b) for a, b in zip(img["channels"][n]["samples"], ch[n]))

def test_roundtrip_zip_half_with_partial_last_chunk():
    w, h = 7, 20
    ch = {"R": _flat(w, h, lambda x, y: (x + y) / 32), "G": _flat(w, h, lambda x, y: 0.5), "B": _flat(w, h, lambda x, y: y / 64)}
    img = read_exr(exr_bytes(w, h, ch, compression="ZIP", pixel_type="half"))
    assert img["compression"] == "ZIP" and img["channels"]["R"]["type"] == "half"
    for n in ch:
        assert len(img["channels"][n]["samples"]) == w * h
        assert all(_close(a, b, 1e-3) for a, b in zip(img["channels"][n]["samples"], ch[n]))

def test_roundtrip_zips_and_uint():
    w, h = 4, 4
    ch = {"id": [x + 10 * y for y in range(h) for x in range(w)]}
    img = read_exr(exr_bytes(w, h, ch, compression="ZIPS", pixel_type="uint"))
    assert img["compression"] == "ZIPS" and img["channels"]["id"]["type"] == "uint"
    assert img["channels"]["id"]["samples"] == ch["id"]

def test_incompressible_zip_chunk_is_stored_raw():
    import random as _random
    rnd = _random.Random(7)
    w, h = 16, 2
    ch = {"R": [rnd.random() for _ in range(w * h)]}
    data = exr_bytes(w, h, ch, compression="ZIP")
    img = read_exr(data)
    assert all(_close(a, b) for a, b in zip(img["channels"]["R"]["samples"], ch["R"]))

def test_unknown_attribute_is_skipped():
    extra = _attr("comments", "string", b"made by test")
    img = read_exr(exr_bytes(2, 2, _rgb(2, 2), header_extra=extra))
    assert img["width"] == 2

def test_structural_refusals():
    good = exr_bytes(4, 4, _rgb(4, 4))
    _expect_error(lambda: read_exr(b""), "BAD_MAGIC")
    _expect_error(lambda: read_exr(b"\x00" * 3), "BAD_MAGIC")
    _expect_error(lambda: read_exr(b"\x89PNG" + good[4:]), "BAD_MAGIC")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), version_low=1)), "UNSUPPORTED_VERSION")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), flags=0x2000)), "UNSUPPORTED_VERSION")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), flags=0x200)), "UNSUPPORTED_TILED")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), flags=0x800)), "UNSUPPORTED_DEEP")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), flags=0x1000)), "UNSUPPORTED_MULTIPART")
    assert read_exr(exr_bytes(4, 4, _rgb(4, 4), flags=0x400))["width"] == 4
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), drop_attr="dataWindow")), "HEADER_INVALID")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), sorted_names=False)), "HEADER_INVALID")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), line_order=1)), "HEADER_INVALID")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, {}, compression="NONE")), "HEADER_INVALID")
    for byte, name in ((4, "PIZ"), (1, "RLE"), (8, "DWAA"), (42, "UNKNOWN")):
        try:
            read_exr(exr_bytes(4, 4, _rgb(4, 4), compression_byte=byte))
            assert False, "unsupported compression accepted"
        except ExrError as e:
            assert e.code == "UNSUPPORTED_COMPRESSION" and name in e.detail
    _expect_error(lambda: read_exr(good[:len(good) - 5]), "TRUNCATED")
    _expect_error(lambda: read_exr(good[:60]), "TRUNCATED")
    _expect_error(lambda: read_exr(exr_bytes(4, 4, _rgb(4, 4), chunk_y_offset=1)), "CORRUPT")
    _expect_error(lambda: read_exr(exr_bytes(8, 4, _rgb(8, 4), compression="ZIP", corrupt_zip=True)), "CORRUPT")

def test_gate_passes_a_clean_frame_with_stats():
    r = gate_frame(exr_bytes(4, 2, _rgb(4, 2, 0.5, 0.25, 0.125)))
    assert r["ok"] is True and r["code"] is None
    s = r["stats"]
    assert s["width"] == 4 and s["height"] == 2 and s["compression"] == "NONE"
    assert s["channels"] == ["B", "G", "R"] and s["nan_count"] == 0
    luma = 0.2126 * 0.5 + 0.7152 * 0.25 + 0.0722 * 0.125
    assert _close(s["max_luma"], luma) and _close(s["mean_luma"], luma)

def test_gate_channel_missing_and_stats_without_rgb():
    r = gate_frame(exr_bytes(2, 2, {"R": [1.0] * 4, "G": [1.0] * 4}))
    assert r["ok"] is False and r["code"] == "CHANNEL_MISSING"
    assert r["stats"]["channels"] == ["G", "R"] and r["stats"]["max_luma"] is None and r["stats"]["mean_luma"] is None
    r2 = gate_frame(exr_bytes(2, 2, {"Z": [1.0] * 4}), required_channels=("Z",))
    assert r2["ok"] is True and r2["stats"]["max_luma"] is None

def test_gate_nan_and_inf_pixels():
    ch = _rgb(3, 3)
    ch["G"][4] = float("nan"); ch["B"][0] = float("inf")
    r = gate_frame(exr_bytes(3, 3, ch))
    assert r["ok"] is False and r["code"] == "NAN_PIXELS" and r["stats"]["nan_count"] == 2
    r2 = gate_frame(exr_bytes(3, 3, ch), nan_threshold=2)
    assert r2["ok"] is True and r2["stats"]["nan_count"] == 2
    assert _close(r2["stats"]["max_luma"], 0.2126 * 0.5 + 0.7152 * 0.25 + 0.0722 * 0.125)

def test_gate_black_and_dark_frames():
    black = gate_frame(exr_bytes(4, 4, _rgb(4, 4, 0.0, 0.0, 0.0)))
    assert black["ok"] is False and black["code"] == "BLACK_FRAME" and black["stats"]["max_luma"] == 0.0
    dark = gate_frame(exr_bytes(4, 4, _rgb(4, 4, 0.002, 0.002, 0.002)))
    assert dark["ok"] is True
    dark2 = gate_frame(exr_bytes(4, 4, _rgb(4, 4, 0.002, 0.002, 0.002)), black_threshold=0.01)
    assert dark2["ok"] is False and dark2["code"] == "BLACK_FRAME"
    fade = gate_frame(exr_bytes(4, 4, _rgb(4, 4, 0.0, 0.0, 0.0)), black_threshold=-1.0)
    assert fade["ok"] is True

def test_gate_never_raises_on_structural_errors():
    for data in (b"", b"junk", exr_bytes(4, 4, _rgb(4, 4), compression_byte=4), exr_bytes(4, 4, _rgb(4, 4))[:50]):
        r = gate_frame(data)
        assert r["ok"] is False and r["stats"] is None and r["code"] in ("BAD_MAGIC", "UNSUPPORTED_COMPRESSION", "TRUNCATED")

def test_gate_order_channel_missing_before_nan_before_black():
    ch = {"R": [float("nan")] * 4, "G": [0.0] * 4}
    assert gate_frame(exr_bytes(2, 2, ch))["code"] == "CHANNEL_MISSING"
    ch2 = {"R": [float("nan")] * 4, "G": [0.0] * 4, "B": [0.0] * 4}
    assert gate_frame(exr_bytes(2, 2, ch2))["code"] == "NAN_PIXELS"
    ch3 = {"R": [0.0] * 4, "G": [0.0] * 4, "B": [0.0] * 4}
    assert gate_frame(exr_bytes(2, 2, ch3))["code"] == "BLACK_FRAME"

def test_sequence_flicker_and_fade():
    stats = [{"mean_luma": 0.50}, {"mean_luma": 0.51}, {"mean_luma": 0.90}, {"mean_luma": 0.52}]
    r = gate_sequence(stats, 0.2)
    assert r["ok"] is False and r["code"] == "FLICKER" and r["frame_index"] == 2 and _close(r["jump"], 0.39)
    fade = [{"mean_luma": 0.5 - 0.05 * i} for i in range(11)]
    assert gate_sequence(fade, 0.2) == {"ok": True, "code": None, "frame_index": None, "jump": None}
    assert gate_sequence([], 0.2)["ok"] is True
    assert gate_sequence([{"mean_luma": 0.9}], 0.2)["ok"] is True
    skipped = [{"mean_luma": 0.1}, {"mean_luma": None}, {"mean_luma": 0.9}]
    assert gate_sequence(skipped, 0.2)["ok"] is True
    assert gate_sequence([{"mean_luma": 0.1}, {"mean_luma": None}, {"mean_luma": 0.9}, {"mean_luma": 0.1}], 0.2)["frame_index"] == 3

if __name__ == "__main__":
    test_codes_tuple()
    test_roundtrip_none_float()
    test_roundtrip_zip_half_with_partial_last_chunk()
    test_roundtrip_zips_and_uint()
    test_incompressible_zip_chunk_is_stored_raw()
    test_unknown_attribute_is_skipped()
    test_structural_refusals()
    test_gate_passes_a_clean_frame_with_stats()
    test_gate_channel_missing_and_stats_without_rgb()
    test_gate_nan_and_inf_pixels()
    test_gate_black_and_dark_frames()
    test_gate_never_raises_on_structural_errors()
    test_gate_order_channel_missing_before_nan_before_black()
    test_sequence_flicker_and_fade()
    print("ALL ACCEPTANCE TESTS PASSED")
