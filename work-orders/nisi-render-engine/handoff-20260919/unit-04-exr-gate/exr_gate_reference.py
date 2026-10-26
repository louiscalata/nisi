# Reference implementation of the EXR QC gate (unit-04, panel experiment 2): a closed reader for scanline
# OpenEXR with NONE/ZIPS/ZIP compression and the deterministic frame/sequence checks (CHANNEL_MISSING,
# NAN_PIXELS, BLACK_FRAME, FLICKER) with exact structural refusal codes.
# Drafted by the PC worker (Qwen3-Coder-Next 80B-A3B Q4_K_M) in 210.5 s, job mac-20260914-034616-b061d0e9e142ea463ce1d865bcdc7e5e, from task.txt alone;
# the draft as received passed 3/14 owner tests. Integrator rewrite by Claude 2026-09-14 of four parts:
# the header walk (the draft searched for a double NUL, which occurs inside attribute sizes), the chunk layout
# (per scanline, channels in header order — the draft used a per-channel stride), the version flag test (the
# draft shifted the flag bits out before testing them) and the result shape (type + samples per channel);
# offsets must now clear the table; luma defaults to 0.0 with no finite pixel. Helpers, header validation,
# predictor/un-interleave and gate_sequence are the worker's. 14/14 owner tests; 8/8 mutants caught.
# Status: UNCERTIFIED — no structural gate scan and no model review ran on this file. The EXR writer used by
# the tests is the owner's own fixture: no file from a real renderer has been read yet (see experiments/).
import struct
import zlib
import math

EXR_CODES = ("BAD_MAGIC", "UNSUPPORTED_VERSION", "UNSUPPORTED_TILED", "UNSUPPORTED_DEEP", "UNSUPPORTED_MULTIPART", "HEADER_INVALID", "UNSUPPORTED_COMPRESSION", "TRUNCATED", "CORRUPT", "CHANNEL_MISSING", "NAN_PIXELS", "BLACK_FRAME", "FLICKER")

class ExrError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(detail)
        self.code = code
        self.detail = detail

def _read_int32(data, offset):
    if offset + 4 > len(data):
        raise ExrError("TRUNCATED")
    return struct.unpack('<i', data[offset:offset+4])[0]

def _read_uint32(data, offset):
    if offset + 4 > len(data):
        raise ExrError("TRUNCATED")
    return struct.unpack('<I', data[offset:offset+4])[0]

def _read_int64(data, offset):
    if offset + 8 > len(data):
        raise ExrError("TRUNCATED")
    return struct.unpack('<q', data[offset:offset+8])[0]

def _read_uint64(data, offset):
    if offset + 8 > len(data):
        raise ExrError("TRUNCATED")
    return struct.unpack('<Q', data[offset:offset+8])[0]

def _decode_half(h):
    # IEEE 754 binary16 to float
    h = struct.unpack('<H', h)[0]
    sign = (h >> 15) & 0x1
    exp = (h >> 10) & 0x1F
    mant = h & 0x3FF
    
    if exp == 0:
        if mant == 0:
            return -0.0 if sign else 0.0
        else:
            # Subnormal
            exp = -14
            mant = mant / (1 << 10)
    elif exp == 31:
        if mant == 0:
            return float('-inf') if sign else float('inf')
        else:
            return float('nan')
    else:
        exp = exp - 15
        mant = 1 + mant / (1 << 10)
    
    val = (1 - 2 * sign) * mant * (2 ** exp)
    return val

def _decode_uint32(data, offset):
    return struct.unpack('<I', data[offset:offset+4])[0]

def _decode_float(data, offset):
    return struct.unpack('<f', data[offset:offset+4])[0]

def _decode_half_list(data, offset, count):
    result = []
    for _ in range(count):
        result.append(_decode_half(data[offset:offset+2]))
        offset += 2
    return result

def _decode_uint32_list(data, offset, count):
    result = []
    for _ in range(count):
        result.append(_decode_uint32(data, offset))
        offset += 4
    return result

def _decode_float_list(data, offset, count):
    result = []
    for _ in range(count):
        result.append(_decode_float(data, offset))
        offset += 4
    return result

def _is_nan_or_inf(val):
    if isinstance(val, float):
        return math.isnan(val) or math.isinf(val)
    return False

def _read_nul_terminated_string(data, offset):
    end = data.find(b'\x00', offset)
    if end == -1:
        raise ExrError("TRUNCATED")
    return data[offset:end].decode('utf-8'), end + 1

def _read_header(data, offset):
    """Sequential attribute walk: name, type, int32 size, value; an empty name ends the header."""
    attributes = {}
    pos = offset
    while True:
        if pos >= len(data):
            raise ExrError("TRUNCATED")
        name, pos = _read_nul_terminated_string(data, pos)
        if name == "":
            break
        type_name, pos = _read_nul_terminated_string(data, pos)
        size = _read_int32(data, pos)
        pos += 4
        if size < 0 or pos + size > len(data):
            raise ExrError("TRUNCATED")
        if name in attributes:
            raise ExrError("HEADER_INVALID")
        attributes[name] = {"type": type_name, "value": data[pos:pos + size]}
        pos += size
    return attributes, pos


def _parse_chlist(value):
    channels = {}
    pos = 0
    while pos < len(value):
        name, pos = _read_nul_terminated_string(value, pos)
        if not name:
            break
        if name in channels:
            raise ExrError("HEADER_INVALID")
        
        pixel_type = _read_int32(value, pos)
        pos += 4
        if pixel_type not in (0, 1, 2):
            raise ExrError("HEADER_INVALID")
        
        p_linear = value[pos]
        pos += 1
        pos += 3  # reserved bytes
        
        x_sampling = _read_int32(value, pos)
        pos += 4
        y_sampling = _read_int32(value, pos)
        pos += 4
        
        if x_sampling != 1 or y_sampling != 1:
            raise ExrError("HEADER_INVALID")
        
        channels[name] = {
            "type": ["uint", "half", "float"][pixel_type],
            "p_linear": p_linear,
            "x_sampling": x_sampling,
            "y_sampling": y_sampling
        }
    
    # Check strictly increasing order
    names = list(channels.keys())
    if names != sorted(names):
        raise ExrError("HEADER_INVALID")
    
    return channels

def _parse_compression(value):
    if len(value) != 1:
        raise ExrError("HEADER_INVALID")
    return value[0]

def _parse_box2i(value):
    if len(value) != 16:
        raise ExrError("HEADER_INVALID")
    x_min, y_min, x_max, y_max = struct.unpack('<iiii', value)
    return {"xMin": x_min, "yMin": y_min, "xMax": x_max, "yMax": y_max}

def _parse_lineOrder(value):
    if len(value) != 1:
        raise ExrError("HEADER_INVALID")
    return value[0]

def _parse_float(value):
    if len(value) != 4:
        raise ExrError("HEADER_INVALID")
    return struct.unpack('<f', value)[0]

def _parse_v2f(value):
    if len(value) != 8:
        raise ExrError("HEADER_INVALID")
    return struct.unpack('<ff', value)

def _validate_header(attributes):
    required = {
        "channels": ("chlist", None),
        "compression": ("compression", None),
        "dataWindow": ("box2i", None),
        "displayWindow": ("box2i", None),
        "lineOrder": ("lineOrder", None),
        "pixelAspectRatio": ("float", None),
        "screenWindowCenter": ("v2f", None),
        "screenWindowWidth": ("float", None)
    }
    
    for name, (type_name, _) in required.items():
        if name not in attributes:
            raise ExrError("HEADER_INVALID")
        if attributes[name]["type"] != type_name:
            raise ExrError("HEADER_INVALID")
    
    # Parse required attributes
    try:
        channels = _parse_chlist(attributes["channels"]["value"])
        if not channels:
            raise ExrError("HEADER_INVALID")
        
        compression_byte = _parse_compression(attributes["compression"]["value"])
        
        data_window = _parse_box2i(attributes["dataWindow"]["value"])
        if data_window["xMax"] < data_window["xMin"] or data_window["yMax"] < data_window["yMin"]:
            raise ExrError("HEADER_INVALID")
        
        display_window = _parse_box2i(attributes["displayWindow"]["value"])
        
        line_order = _parse_lineOrder(attributes["lineOrder"]["value"])
        if line_order != 0:
            raise ExrError("HEADER_INVALID")
        
        pixel_ratio = _parse_float(attributes["pixelAspectRatio"]["value"])
        screen_center = _parse_v2f(attributes["screenWindowCenter"]["value"])
        screen_width = _parse_float(attributes["screenWindowWidth"]["value"])
    except ExrError:
        raise
    except Exception:
        raise ExrError("HEADER_INVALID")
    
    return {
        "channels": channels,
        "compression_byte": compression_byte,
        "dataWindow": data_window,
        "displayWindow": display_window,
        "lineOrder": line_order,
        "pixelAspectRatio": pixel_ratio,
        "screenWindowCenter": screen_center,
        "screenWindowWidth": screen_width
    }

def _get_compression_name(byte):
    names = {
        0: "NONE",
        1: "RLE",
        2: "ZIPS",
        3: "ZIP",
        4: "PIZ",
        5: "PXR24",
        6: "B44",
        7: "B44A",
        8: "DWAA",
        9: "DWAB"
    }
    return names.get(byte, "UNKNOWN")

def _get_bytes_per_sample(channel_type):
    return {"uint": 4, "half": 2, "float": 4}[channel_type]

def _read_offset_table(data, offset, height, lines_per_chunk):
    num_chunks = (height + lines_per_chunk - 1) // lines_per_chunk
    table_size = num_chunks * 8
    if offset + table_size > len(data):
        raise ExrError("TRUNCATED")
    
    offsets = []
    for i in range(num_chunks):
        off = _read_uint64(data, offset + i*8)
        offsets.append(off)
    
    return offsets

def _apply_predictor(data):
    # Undo predictor: t[i] = (t[i-1] + t[i] - 128) & 0xFF
    for i in range(1, len(data)):
        data[i] = (data[i-1] + data[i] - 128) & 0xFF

def _un_interleave(data):
    # Un-interleave: out[0::2] = t[:half], out[1::2] = t[half:]
    n = len(data)
    half = (n + 1) // 2
    t = data[:]
    out = bytearray(n)
    out[0::2] = t[:half]
    out[1::2] = t[half:]
    return bytes(out)

_FMT = {"uint": "I", "half": "e", "float": "f"}


def _read_chunk(data, offset, y, width, channels, compression, lines_in_chunk):
    if offset + 8 > len(data):
        raise ExrError("TRUNCATED")
    chunk_y = _read_int32(data, offset)
    data_size = _read_int32(data, offset + 4)
    if chunk_y != y:
        raise ExrError("CORRUPT")
    if data_size < 0:
        raise ExrError("CORRUPT")
    line_bytes = sum(width * _get_bytes_per_sample(ch["type"]) for ch in channels.values())
    raw_size = line_bytes * lines_in_chunk
    if offset + 8 + data_size > len(data):
        raise ExrError("TRUNCATED")
    chunk_data = data[offset + 8:offset + 8 + data_size]
    if compression in ("ZIPS", "ZIP") and data_size != raw_size:
        try:
            inflated = zlib.decompress(chunk_data)
        except Exception:
            raise ExrError("CORRUPT")
        if len(inflated) != raw_size:
            raise ExrError("CORRUPT")
        buf = bytearray(inflated)
        _apply_predictor(buf)
        raw_data = _un_interleave(buf)
    else:
        if data_size != raw_size:
            raise ExrError("CORRUPT")
        raw_data = bytes(chunk_data)
    per_channel = {name: [] for name in channels}
    pos = 0
    for _line in range(lines_in_chunk):
        for name, ch in channels.items():
            bps = _get_bytes_per_sample(ch["type"])
            fmt = "<" + _FMT[ch["type"]] * width
            per_channel[name].extend(struct.unpack(fmt, raw_data[pos:pos + width * bps]))
            pos += width * bps
    return per_channel


def read_exr(data):
    if not isinstance(data, (bytes, bytearray)) or len(data) < 8:
        raise ExrError("BAD_MAGIC")
    data = bytes(data)
    if struct.unpack("<i", data[:4])[0] != 20000630:
        raise ExrError("BAD_MAGIC")
    version = struct.unpack("<i", data[4:8])[0]
    if version & 0xFF != 2:
        raise ExrError("UNSUPPORTED_VERSION")
    flags = version & ~0xFF
    if flags & 0x200:
        raise ExrError("UNSUPPORTED_TILED")
    if flags & 0x800:
        raise ExrError("UNSUPPORTED_DEEP")
    if flags & 0x1000:
        raise ExrError("UNSUPPORTED_MULTIPART")
    if flags & ~0x400:
        raise ExrError("UNSUPPORTED_VERSION")
    try:
        attributes, header_end = _read_header(data, 8)
        parsed = _validate_header(attributes)
    except ExrError:
        raise
    except Exception:
        raise ExrError("HEADER_INVALID")
    compression_byte = parsed["compression_byte"]
    if compression_byte not in (0, 2, 3):
        raise ExrError("UNSUPPORTED_COMPRESSION", _get_compression_name(compression_byte))
    compression_name = {0: "NONE", 2: "ZIPS", 3: "ZIP"}[compression_byte]
    data_window = parsed["dataWindow"]
    width = data_window["xMax"] - data_window["xMin"] + 1
    height = data_window["yMax"] - data_window["yMin"] + 1
    if width * height > 100_000_000:
        raise ExrError("HEADER_INVALID")
    lines_per_chunk = 16 if compression_byte == 3 else 1
    offsets = _read_offset_table(data, header_end, height, lines_per_chunk)
    table_end = header_end + 8 * len(offsets)
    for off in offsets:
        if off < table_end or off + 8 > len(data):
            raise ExrError("CORRUPT")
    channels = parsed["channels"]
    result = {"width": width, "height": height, "compression": compression_name,
              "channels": {name: {"type": ch["type"], "samples": []} for name, ch in channels.items()}}
    for i, offset in enumerate(offsets):
        y = data_window["yMin"] + i * lines_per_chunk
        lines_in_chunk = min(lines_per_chunk, height - i * lines_per_chunk)
        try:
            per_channel = _read_chunk(data, offset, y, width, channels, compression_name, lines_in_chunk)
        except ExrError:
            raise
        except Exception:
            raise ExrError("CORRUPT")
        for name, samples in per_channel.items():
            result["channels"][name]["samples"].extend(samples)
    return result


def gate_frame(data, required_channels=("R", "G", "B"), black_threshold=0.0, nan_threshold=0):
    try:
        exr_data = read_exr(data)
    except ExrError as e:
        return {"ok": False, "code": e.code, "stats": None}
    
    # Check required channels
    for ch in required_channels:
        if ch not in exr_data["channels"]:
            stats = {
                "width": exr_data["width"],
                "height": exr_data["height"],
                "compression": exr_data["compression"],
                "channels": sorted(exr_data["channels"].keys()),
                "nan_count": 0,
                "max_luma": None,
                "mean_luma": None
            }
            return {"ok": False, "code": "CHANNEL_MISSING", "stats": stats}
    
    # Count NaN/Inf samples
    nan_count = 0
    for channel_name in exr_data["channels"]:
        for sample in exr_data["channels"][channel_name]["samples"]:
            if isinstance(sample, float) and (_is_nan_or_inf(sample)):
                nan_count += 1
    
    if nan_count > nan_threshold:
        stats = {
            "width": exr_data["width"],
            "height": exr_data["height"],
            "compression": exr_data["compression"],
            "channels": sorted(exr_data["channels"].keys()),
            "nan_count": nan_count,
            "max_luma": None,
            "mean_luma": None
        }
        return {"ok": False, "code": "NAN_PIXELS", "stats": stats}
    
    # Calculate luma if R, G, B present
    max_luma = None
    mean_luma = None
    if all(ch in exr_data["channels"] for ch in ("R", "G", "B")):
        r_samples = exr_data["channels"]["R"]["samples"]
        g_samples = exr_data["channels"]["G"]["samples"]
        b_samples = exr_data["channels"]["B"]["samples"]
        
        luma_values = []
        for i in range(len(r_samples)):
            r, g, b = r_samples[i], g_samples[i], b_samples[i]
            # Skip NaN/Inf for luma calculation
            if isinstance(r, float) and (_is_nan_or_inf(r)):
                continue
            if isinstance(g, float) and (_is_nan_or_inf(g)):
                continue
            if isinstance(b, float) and (_is_nan_or_inf(b)):
                continue
            
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            luma_values.append(luma)
        
        if luma_values:
            max_luma = max(luma_values)
            mean_luma = sum(luma_values) / len(luma_values)
        else:
            max_luma = 0.0
            mean_luma = 0.0
    
    stats = {
        "width": exr_data["width"],
        "height": exr_data["height"],
        "compression": exr_data["compression"],
        "channels": sorted(exr_data["channels"].keys()),
        "nan_count": nan_count,
        "max_luma": max_luma,
        "mean_luma": mean_luma
    }
    
    # Check black frame
    if max_luma is not None and max_luma <= black_threshold:
        return {"ok": False, "code": "BLACK_FRAME", "stats": stats}
    
    return {"ok": True, "code": None, "stats": stats}

def gate_sequence(stats_list, flicker_threshold):
    if len(stats_list) <= 1:
        return {"ok": True, "code": None, "frame_index": None, "jump": None}
    
    prev_mean = None
    for i in range(1, len(stats_list)):
        curr_mean = stats_list[i].get("mean_luma")
        if curr_mean is None:
            prev_mean = None
            continue
        
        if prev_mean is None:
            prev_mean = stats_list[i-1].get("mean_luma")
            if prev_mean is None:
                continue
        
        jump = abs(curr_mean - prev_mean)
        if jump > flicker_threshold:
            return {"ok": False, "code": "FLICKER", "frame_index": i, "jump": jump}
        
        prev_mean = curr_mean
    
    return {"ok": True, "code": None, "frame_index": None, "jump": None}
