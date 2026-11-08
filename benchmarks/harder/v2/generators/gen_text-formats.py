#!/usr/bin/env python3
"""Generator for the nisi-harder-v2 'text-formats' category.

Deterministic, stdlib only, no network. Every expectedAnswer is computed here
by reference implementations of the rules stated in each prompt.

Run: python3 gen_text-formats.py
Writes text-formats.tasks.json and text-formats.prompts.json next to this file.
"""
import csv
import datetime
import io
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
CATEGORY = "text-formats"


def nfc(s):
    return unicodedata.normalize("NFC", s)


# ---------------------------------------------------------------- 01 CSV
def task_csv():
    text = (
        'id,customer,category,amount_cents,status,note\n'
        '101,"Ng, Alice",Books,"1,250",paid,"gift ""wrap"""\n'
        '102,Bob,books ,800,Paid,\n'
        '103,"Cruz, ""Dee""",Games,2400,REFUNDED,"line one\nline two"\n'
        '104,Eli,Games,"3,100", paid ,\n'
        '102,Bob,Toys,9999,paid,duplicate id\n'
        '105,Fay,TOYS,1500,void,\n'
        '106,Gus,Toys ,700,paid,"a,b,c"\n'
        '107,Hal,games,450,pending,\n'
        '108," Ivy ",Books,300,paid,"say ""hi"""\n'
        '109,Jo,Music,1999,paid,\n'
        '110,Kim,music,1,paid,\n'
    )
    rows = list(csv.reader(io.StringIO(text, newline="")))
    header, body = rows[0], rows[1:]
    ix = {h: i for i, h in enumerate(header)}
    seen = set()
    totals = {}
    for r in body:
        rid = r[ix["id"]].strip()
        if rid in seen:
            continue
        seen.add(rid)
        status = r[ix["status"]].strip().lower()
        if status in ("refunded", "void"):
            continue
        cat = r[ix["category"]].strip().lower()
        amt = int(r[ix["amount_cents"]].replace(",", ""))
        totals[cat] = totals.get(cat, 0) + amt
    out = [[c, t] for c, t in totals.items() if t >= 2000]
    out.sort(key=lambda p: (-p[1], p[0]))
    prompt = (
        "Below is CSV text between the lines <<< and >>> (the marker lines are not part of the data). "
        "It follows RFC 4180: fields may be wrapped in double quotes; inside a quoted field a comma is literal, "
        "a doubled quote \"\" is one literal quote, and a line break is part of the field. The first record is the header.\n"
        "<<<\n" + text + ">>>\n"
        "Process the data records in the order they appear. (1) If a record's id (after trimming spaces) was already seen in an "
        "earlier record, ignore this record entirely; otherwise remember the id, even if the record is excluded in the next step. "
        "(2) Exclude the record if its status, trimmed and compared case-insensitively, is refunded or void. "
        "(3) For the remaining records, trim spaces from category and lowercase it; amount_cents is a whole number of cents in which "
        "commas are thousands separators to be removed. Add each amount to the total of its category. "
        "Keep only categories whose total is at least 2000. Sort by total descending, ties by category name ascending. "
        "Return answer as a JSON array of [category, total] pairs, with category a lowercase string and total an integer."
    )
    return ("medium", prompt, out)


# ---------------------------------------------------------- 02 Unicode keys
def task_unicode():
    table = {
        "ß": "ss", "ø": "o", "Ø": "o", "Æ": "ae", "İ": "i", "ı": "i",
        "Ł": "l", "ó": "o", "ü": "u", "Ü": "u", "ñ": "n", "Ñ": "n",
        "Œ": "oe", "ſ": "s", "é": "e", "ö": "o", "ç": "c",
    }
    table = {nfc(k): v for k, v in table.items()}
    words = [
        "Straße", "STRASSE", "Ørsted", "Strasse", "Æther", "Orsted", "strasse",
        "Istanbul", "İstanbul", "Ko-ko", "Łódź", "Lodz", "Koko", "aether",
        "O'Neil", "Müller", "MÜLLER", "Mueller", "ıstanbul", "Cañon", "Canon",
        "ko ko", "Œuvre", "oeuvre", "Zoë", "Zoe", "Aether", "Koko", "ørsted",
        "oneil", "ONeil", "CAÑON", "Muller", "ſun", "SUN", "Sun",
    ]
    words = [nfc(w) for w in words]

    def key(w):
        out = []
        for ch in w:
            out.append(table.get(ch, ch))
        s = "".join(out)
        s = "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)
        return "".join(c for c in s if c not in "-' ")

    groups = {}
    for w in words:
        groups.setdefault(key(w), set()).add(w)
    out = []
    for k in sorted(groups):
        g = sorted(groups[k])  # Python str sort == code point order
        if len(g) >= 2:
            out.append(g)
    tbl = ", ".join("%s=%s" % (k, v) for k, v in table.items())
    prompt = (
        "Define the key of a word in three steps, applied in this order. "
        "Step 1: replace each character that appears on the left of the table below with its right-hand text; every other character is kept as is. "
        "Table: " + tbl + ". "
        "Step 2: in the result, turn each ASCII capital letter A-Z into its lowercase form (no other character changes). "
        "Step 3: delete every hyphen, apostrophe and space. "
        "Note that any non-ASCII character not in the table (for example ë or ź) stays unchanged and keeps words apart.\n"
        "Words (a word may be listed more than once; identical strings count as one word): "
        + json.dumps(words, ensure_ascii=False) + "\n"
        "Group the distinct words by key. Keep only groups with at least 2 distinct words. Inside a group, sort the words "
        "by Unicode code point (so every capital ASCII letter sorts before every lowercase one, and non-ASCII characters sort after ASCII). "
        "Sort the groups by their key, using code point order. "
        "Return answer as a JSON array of groups, each group a JSON array of word strings."
    )
    return ("medium", prompt, out)


# ------------------------------------------------------- 03 Markdown table
def task_mdtable():
    lines = [
        r"| Item | Qty | Price | Notes | In stock | QTY | price |",
        r"|:-----|----:|:-----:|-------|----------|-----|-------|",
        r'| Widget \| Pro | 12 | 1999 | "fragile" | true | 007 | -5 |',
        r"| Gadget | 3 | | a\\b | false | 4 |",
        r"| Doohickey |  0 | 250 | | TRUE | 0 | 10 | extra |",
        r"| Gizmo | 5 | 0 | x \| y \| z | true | -0 | 1 |",
        r"|  | 8 | 12 | | false | 1 | 2 |",
        r"| Neg | -8 | 1 | | true | 1 | 1 |",
    ]
    text = "\n".join(lines)

    def split_row(line):
        line = line.strip()
        assert line.startswith("|") and line.endswith("|")
        line = line[1:-1]
        cells, cur, i = [], [], 0
        while i < len(line):
            c = line[i]
            if c == "\\" and i + 1 < len(line) and line[i + 1] == "|":
                cur.append("|")
                i += 2
                continue
            if c == "|":
                cells.append("".join(cur))
                cur = []
            else:
                cur.append(c)
            i += 1
        cells.append("".join(cur))
        return [c.strip() for c in cells]

    def conv(c):
        if re.fullmatch(r"0|-?[1-9][0-9]*", c):
            return int(c)
        if c == "true":
            return True
        if c == "false":
            return False
        if c == "":
            return None
        return c

    raw = [split_row(l) for l in lines]
    heads = []
    count = {}
    for h in raw[0]:
        h = h.lower()
        count[h] = count.get(h, 0) + 1
        heads.append(h if count[h] == 1 else "%s_%d" % (h, count[h]))
    out = []
    for r in raw[2:]:
        r = r[: len(heads)]
        vals = [conv(c) for c in r]
        obj = {}
        for h, v in zip(heads, vals):
            if v is not None:
                obj[h] = v
        q = obj.get("qty")
        if isinstance(q, int) and not isinstance(q, bool) and q >= 0:
            out.append(obj)
    prompt = (
        "Convert this Markdown table (text between the <<< and >>> lines) to JSON.\n<<<\n" + text + "\n>>>\n"
        "Rules. Row 2 is the alignment row and is ignored. For every row: strip the single leading and single trailing pipe, "
        "split on pipes, then trim spaces from each cell. The only escape is backslash-pipe, which stands for a literal pipe character "
        "and does not split; any other backslash is an ordinary character kept as is (two backslashes stay two backslashes). "
        "Header names are trimmed and lowercased; if a lowercased name repeats, its 2nd occurrence gets the suffix _2 and a 3rd would get _3. "
        "Cells beyond the number of headers are ignored; a row with fewer cells leaves the missing columns empty. "
        "Cell conversion: text matching a plain integer (0, or an optional minus then a nonzero digit followed by digits, so 007 and -0 do not qualify) becomes a JSON integer; "
        "exactly true or false (lowercase) becomes a JSON boolean; an empty cell means the key is omitted from that row's object; anything else stays a string. "
        "After conversion, keep only rows whose qty is an integer >= 0. "
        "Return answer as a JSON array of objects, one per kept row in table order."
    )
    return ("medium", prompt, out)


# ---------------------------------------------------------- 04 Log parsing
def task_logs():
    lines = [
        "2028-02-29T00:30:00+02:00 [ERROR] api rid=a1 db timeout",
        "2028-02-28T21:15:10-03:30 [error] web rid=b2 bad gateway",
        "# 2028-02-28T10:00:00+00:00 [ERROR] api rid=zz commented out",
        "2028-02-29T04:05:00+05:45 [FATAL] queue rid=c3 oom",
        "2028-02-28T22:30:00+00:00 [WARN] api rid=a1 retrying",
        "2028-02-28T23:59:59-12:00 [Error] web rid=d4 cert",
        "2028-02-29T00:10:00+09:00 [ERROR] api rid=a1 db timeout again",
        "2028-02-29T06:00:00+14:00 [INFO] web rid=e5 ok",
        "2028-03-01T00:00:00+00:00 [FATAL] api rid=f6 crash",
        "2028-02-28T19:00:00-05:00 [ERROR] queue rid=b2 duplicate rid",
        "2028-12-31T23:50:00-05:00 [fatal] web rid=g7 disk full",
        "2028-03-01T05:45:00+05:45 [ERROR] api rid=f6 crash retry",
        "2028-02-28T16:00:00-08:00 [ERROR] web rid=h8 ssl",
    ]
    events = []
    for ln in lines:
        if ln.startswith("#"):
            continue
        m = re.match(r"(\S+) \[(\w+)\] (\S+) rid=(\S+) ", ln)
        ts, lvl, _svc, rid = m.groups()
        if lvl.upper() not in ("ERROR", "FATAL"):
            continue
        dt = datetime.datetime.fromisoformat(ts).astimezone(datetime.timezone.utc)
        events.append((rid, dt))
    best = {}
    for rid, dt in events:
        if rid not in best or dt < best[rid]:
            best[rid] = dt
    out = sorted(d.strftime("%Y-%m-%dT%H:%M:%SZ") for d in best.values())
    prompt = (
        "A log has one event per line in the form: TIMESTAMP [LEVEL] SERVICE rid=ID free text. "
        "TIMESTAMP is local time with a numeric UTC offset, YYYY-MM-DDTHH:MM:SS+HH:MM or -HH:MM; the offset says how far the local clock is ahead of (+) "
        "or behind (-) UTC, so UTC = local minus offset. Years follow the real Gregorian calendar (2028 is a leap year).\n"
        "Log:\n" + "\n".join(lines) + "\n"
        "Procedure. (1) Ignore lines whose first character is #. (2) Keep only events whose LEVEL is ERROR or FATAL; LEVEL is case-insensitive. "
        "(3) Among the kept events only, if several share the same rid, keep just the one with the earliest UTC instant. "
        "(4) Convert the kept events to UTC and sort them ascending. "
        "Return answer as a JSON array of UTC timestamp strings formatted YYYY-MM-DDTHH:MM:SSZ."
    )
    return ("hard", prompt, out)


# --------------------------------------------------------- 05 Templates
MISSING = object()


def tpl_lookup(data, path):
    cur = data
    for seg in path.split("."):
        if isinstance(cur, dict):
            if seg in cur:
                cur = cur[seg]
            else:
                return MISSING
        elif isinstance(cur, list):
            if seg.isdigit() and int(seg) < len(cur):
                cur = cur[int(seg)]
            else:
                return MISSING
        else:
            return MISSING
    return MISSING if cur is None else cur


def tpl_str(v):
    assert not isinstance(v, (dict, list))
    if v is True:
        return "true"
    if v is False:
        return "false"
    return str(v)


def tpl_render(t, data):
    out, i = [], 0
    while i < len(t):
        if t.startswith("{{", i):
            out.append("{")
            i += 2
        elif t.startswith("}}", i):
            out.append("}")
            i += 2
        elif t[i] == "{":
            j = t.index("}", i)
            body = t[i + 1: j]
            i = j + 1
            path, sep, fb = body.partition("|")
            v = tpl_lookup(data, path)
            if v is not MISSING:
                out.append(tpl_str(v))
            elif not sep:
                out.append("<?%s>" % path)
            elif fb.startswith("@"):
                v2 = tpl_lookup(data, fb[1:])
                out.append("" if v2 is MISSING else tpl_str(v2))
            else:
                out.append(fb)
        else:
            assert t[i] != "}"
            out.append(t[i])
            i += 1
    return "".join(out)


def task_template():
    data = {
        "user": {"name": "Ada", "nick": "", "tags": ["x", "y"], "age": 36,
                 "admin": False, "manager": None},
        "note": "use {braces} here",
        "items": [{"name": "pen", "qty": 3}, {"name": "ink", "qty": 0}],
    }
    templates = [
        "Hi {user.name|guest}, {user.nick|@user.name}!",
        "{{{user.name}}} {{user.name}} }}{{",
        "{note} / {items.1.name}x{items.1.qty} / {items.0.name|none}",
        "{user.manager|@user.name} {user.admin} {user.age} {user.tags.1} {user.tags.5|n/a} {user.zip}",
        "[{user.nick|@user.manager}]|{user.zip|x|y}|{x|@y}",
    ]
    out = [tpl_render(t, data) for t in templates]
    prompt = (
        "Render each template against this JSON data (values are never re-scanned for braces): "
        + json.dumps(data, separators=(",", ":")) + "\n"
        "Scan a template left to right. At each position: if the text starts with {{ output one literal { and skip both characters; "
        "else if it starts with }} output one literal } and skip both; else if it starts with a single { , the placeholder body runs up to the next } "
        "(consumed) and is evaluated; any other character is copied. E.g. {{x}} gives {x}, and {{{x}}} gives { + value of x + }.\n"
        "A body is PATH or PATH|FALLBACK, split at the first | only (FALLBACK may contain further | ). PATH is dot-separated: a segment indexes an object by key "
        "or a list by 0-based position. PATH is missing if any step fails or the final value is null; an empty string IS present. "
        "Present values print as is: strings raw, integers in decimal, booleans as true or false. "
        "If PATH is missing: with no FALLBACK print <?PATH>; if FALLBACK starts with @, look up the rest as a path and print it (nothing if also missing); "
        "otherwise print FALLBACK literally.\n"
        "Templates:\n"
        + "\n".join("%d) %s" % (i + 1, t) for i, t in enumerate(templates)) + "\n"
        "Return answer as a JSON array of the 5 rendered strings."
    )
    return ("hard", prompt, out)


# --------------------------------------------------------------- 06 INI
def task_ini():
    text = (
        'timeout = 30 ; seconds\n'
        'name=Top\n'
        '[Server]\n'
        'Host = "example.com ; main"   # comment\n'
        'port=80\n'
        'PORT = 8080\n'
        'tag[] = a\n'
        'Tag[] = b\n'
        'path = C:\\temp\\x\n'
        '; a comment line\n'
        '[db]\n'
        'user = "adm\\"in"\n'
        'url = postgres://h/db#frag\n'
        'pass = abc;def\n'
        'empty =\n'
        '[server]\n'
        'port = 9090 #  override\n'
        'tag[] = c\n'
        'quote = say "hi"\n'
    )

    def parse_value(raw):
        raw = raw.strip()
        if raw.startswith('"'):
            res, i = [], 1
            while i < len(raw):
                c = raw[i]
                if c == "\\" and i + 1 < len(raw) and raw[i + 1] in '"\\':
                    res.append(raw[i + 1])
                    i += 2
                    continue
                if c == '"':
                    break
                res.append(c)
                i += 1
            return "".join(res)
        for i in range(1, len(raw)):
            if raw[i] in ";#" and raw[i - 1] in " \t":
                raw = raw[: i - 1]
                break
        return raw.strip()

    data = {}
    sec = "global"
    for ln in text.split("\n"):
        s = ln.strip()
        if not s or s[0] in ";#":
            continue
        if s.startswith("[") and s.endswith("]"):
            sec = s[1:-1].strip().lower()
            continue
        k, _, v = s.partition("=")
        k = k.strip().lower()
        v = parse_value(v)
        d = data.setdefault(sec, {})
        if k.endswith("[]"):
            d.setdefault(k, []).append(v)
        else:
            d[k] = v
    queries = [
        "global.timeout", "global.name", "server.host", "server.port", "server.tag[]",
        "server.path", "db.user", "db.url", "db.pass", "db.empty", "server.quote",
        "server.missing", "db.tag[]",
    ]
    out = []
    for q in queries:
        s, _, k = q.partition(".")
        out.append(data.get(s, {}).get(k))
    prompt = (
        "Parse this INI text (between <<< and >>>) and answer the lookups below.\n<<<\n" + text + ">>>\n"
        "Rules. Trim spaces and tabs from each line's ends. Skip blank lines and lines starting with ; or #. "
        "A line [name] starts a section; section names and keys are lowercased; a repeated section continues the same section. Lines before the first section belong to section global. "
        "Any other line is key=value split at the first =; trim both parts. "
        "Value: if it starts with a double quote, it ends at the next unescaped double quote; inside, backslash-quote means a quote and double-backslash means one backslash, "
        "any other backslash stays, and text after the closing quote is ignored. "
        "Otherwise the first whitespace character immediately followed by ; or # begins an inline comment, removed with the rest of the line, then trailing spaces are trimmed "
        "(; or # not preceded by whitespace is ordinary text; backslashes are ordinary). "
        "A key ending with [] collects all its values into a list in order of appearance across the whole file (the key keeps its [] suffix); "
        "for any other key the last assignment wins.\n"
        "Lookups (section.key): " + ", ".join(queries) + ".\n"
        "A lookup that finds nothing gives null. Return answer as a JSON array of the 13 results in lookup order (strings, arrays of strings, or null)."
    )
    return ("hard", prompt, out)


# ------------------------------------------------------------ 07 URL query
def task_url():
    url = (
        "https://shop.example/search?q=caf%C3%A9+au+lait&tag=a&%74ag=q0&tag=b%26c&&flag&n=1%2B1"
        "&tag=&x=%zz%41&=empty&k=v=w&tag[]=z&e=%e2%82%ac5&d=%2541&a%20b=1+2&e=%C3%A9#frag?ignored=1&q=late"
    )

    def pdec(s):
        s = s.replace("+", " ")
        b, i = bytearray(), 0
        while i < len(s):
            if s[i] == "%" and re.fullmatch(r"[0-9A-Fa-f]{2}", s[i + 1: i + 3]):
                b.append(int(s[i + 1: i + 3], 16))
                i += 3
            else:
                b.extend(s[i].encode("utf-8"))
                i += 1
        return b.decode("utf-8")

    u = url.split("#", 1)[0]
    q = u.split("?", 1)[1]
    res = {}
    for seg in q.split("&"):
        if seg == "":
            continue
        k, _, v = seg.partition("=")
        k, v = pdec(k), pdec(v)
        if k == "":
            continue
        res.setdefault(k, []).append(v)
    prompt = (
        "Parse the query string of this URL: " + url + "\n"
        "Rules, in order. (1) Remove the fragment: drop the first # and everything after it. (2) The query is everything after the first ? that remains. "
        "(3) Split the query at every & ; skip empty segments. (4) Split each segment at its first = ; a segment without = has the empty string as value. "
        "(5) Decode the key and the value separately: first each + becomes a space, then each % followed by exactly two hex digits (either letter case) becomes one byte, "
        "and the whole resulting byte sequence is read as UTF-8 (all inputs here are valid); a % not followed by two hex digits is kept as a literal %. Decoding happens once only, so %2541 gives %41. "
        "(6) Skip the segment if its decoded key is empty. "
        "(7) Group values by decoded key (case-sensitive; a key such as tag[] is just another key), each key mapping to the list of its values in order of appearance in the URL.\n"
        "Return answer as a JSON object mapping each decoded key to its JSON array of decoded value strings."
    )
    return ("hard", prompt, res)


# ----------------------------------------------------------------- main
def build():
    makers = [task_csv, task_unicode, task_mdtable, task_logs, task_template, task_ini, task_url]
    tasks = []
    for n, mk in enumerate(makers, 1):
        tier, prompt, ans = mk()
        assert 300 <= len(prompt) <= 1800, (n, len(prompt))
        assert prompt.rstrip().endswith("."), n
        assert "Return answer as" in prompt.split("\n")[-1], n
        tasks.append({
            "id": "%s-%02d" % (CATEGORY, n),
            "category": CATEGORY,
            "tier": tier,
            "prompt": prompt,
            "expectedAnswer": ans,
        })
    assert sum(t["tier"] == "medium" for t in tasks) == 3
    assert sum(t["tier"] == "hard" for t in tasks) == 4
    return tasks


def main():
    tasks = build()
    with open(os.path.join(HERE, "text-formats.tasks.json"), "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)
        f.write("\n")
    pr = [{k: v for k, v in t.items() if k != "expectedAnswer"} for t in tasks]
    with open(os.path.join(HERE, "text-formats.prompts.json"), "w", encoding="utf-8") as f:
        json.dump(pr, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(len(tasks))


if __name__ == "__main__":
    main()
