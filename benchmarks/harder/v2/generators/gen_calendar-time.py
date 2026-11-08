#!/usr/bin/env python3
"""Generator for the nisi-harder-v2 "calendar-time" category.

Python 3 standard library only. Deterministic (fixed seeds), no network, no
input files. Every expectedAnswer is computed here, never typed by hand.

Running it writes, next to this script:
  calendar-time.tasks.json    full tasks (with expectedAnswer)
  calendar-time.prompts.json  same tasks with expectedAnswer removed
"""
import calendar
import datetime as dt
import json
import os
import random

CATEGORY = "calendar-time"
HERE = os.path.dirname(os.path.abspath(__file__))
D = dt.date
DT = dt.datetime
TD = dt.timedelta
WDN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def last_dom(y, m):
    return calendar.monthrange(y, m)[1]


def is_leap(y):
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def add_months(d, k):
    idx = d.year * 12 + (d.month - 1) + k
    y, m = divmod(idx, 12)
    m += 1
    return D(y, m, min(d.day, last_dom(y, m)))


def last_sunday(y, m):
    d = D(y, m, last_dom(y, m))
    return d - TD(days=(d.weekday() + 1) % 7)


# ---------------------------------------------------------------- 01 medium
def t_business_days():
    nominal = [D(2027, 7, 4), D(2027, 9, 6), D(2027, 11, 25),
               D(2027, 12, 25), D(2028, 1, 1), D(2028, 1, 17)]

    def observed(d):
        if d.weekday() == 5:
            return d - TD(days=1)
        if d.weekday() == 6:
            return d + TD(days=1)
        return d

    obs = {observed(d) for d in nominal}
    assert len(obs) == len(nominal)
    assert D(2027, 1, 1).weekday() == 4  # anchor stated in prompt

    def is_bd(d):
        return d.weekday() < 5 and d not in obs

    def move(d, n):
        step = TD(days=1 if n > 0 else -1)
        for _ in range(abs(n)):
            d += step
            while not is_bd(d):
                d += step
        return d

    queries = [(D(2027, 6, 30), 3), (D(2027, 7, 2), 1), (D(2027, 7, 5), -1),
               (D(2027, 9, 3), 1), (D(2027, 11, 24), 2), (D(2027, 12, 23), 4),
               (D(2027, 12, 30), 3), (D(2028, 1, 4), -3), (D(2028, 1, 14), 5)]
    ans = [move(d, n).isoformat() for d, n in queries]
    qtxt = "; ".join(f"{i + 1}) {d.isoformat()} N={n:+d}" for i, (d, n) in enumerate(queries))
    prompt = (
        "A company calendar treats Saturdays, Sundays and observed holidays as non-business days. "
        "Nominal holidays: " + ", ".join(d.isoformat() for d in nominal) + ". "
        "A nominal holiday that falls on a Saturday is observed on the preceding Friday; one that falls "
        "on a Sunday is observed on the following Monday; otherwise it is observed on its own date. "
        "Only the observed date is a holiday (the nominal weekend day is just a weekend day). "
        "To move N business days from a date D (N>0 forward, N<0 backward): repeat |N| times: step one "
        "calendar day in that direction, and keep stepping until you land on a business day. D itself "
        "need not be a business day. Reference fact: 2027-01-01 is a Friday. "
        "Queries (start date, N): " + qtxt + ". "
        f"Return answer as a JSON array of {len(queries)} strings of the form \"YYYY-MM-DD\", one per query, in query order."
    )
    return "medium", prompt, ans


# ---------------------------------------------------------------- 02 medium
def t_iso_weeks():
    def iso_manual(d):
        for y in (d.year + 1, d.year, d.year - 1):
            jan4 = D(y, 1, 4)
            w1 = jan4 - TD(days=jan4.weekday())
            if d >= w1:
                return y, (d - w1).days // 7 + 1, d.weekday() + 1

    items = [("d", D(2020, 12, 31)), ("d", D(2021, 1, 3)), ("o", 2024, 366),
             ("d", D(2024, 12, 29)), ("d", D(2026, 12, 31)), ("d", D(2027, 1, 3)),
             ("d", D(2028, 1, 2)), ("o", 2026, 365), ("o", 2021, 3), ("d", D(2032, 12, 31))]
    ans, txt = [], []
    for it in items:
        if it[0] == "d":
            d = it[1]
            txt.append(d.isoformat())
        else:
            d = D(it[1], 1, 1) + TD(days=it[2] - 1)
            txt.append(f"year {it[1]} day-of-year {it[2]}")
        y, w, wd = d.isocalendar()
        assert (y, w, wd) == iso_manual(d)
        ans.append(f"{y}-W{w:02d}-{wd}")
    assert D(2024, 1, 1).weekday() == 0
    prompt = (
        "Use ISO 8601 week dating: weeks run Monday to Sunday; week 1 of a year is the week that contains "
        "that year's first Thursday (equivalently the week containing January 4); weekday numbers are "
        "Monday=1 ... Sunday=7; the ISO week-year of a date is the calendar year of the Thursday of its "
        "week, so it can differ from the date's own year. A year has 52 or 53 ISO weeks. Day-of-year counts "
        "January 1 as day 1 and uses Gregorian leap years (divisible by 4, except centuries not divisible "
        "by 400). Reference fact: 2024-01-01 is a Monday. For each input below give its ISO week-date as "
        "\"<week-year>-W<two-digit week>-<weekday>\" (example form: 2019-W07-3). Inputs, in order: "
        + "; ".join(f"{i + 1}) {t}" for i, t in enumerate(txt)) + ". "
        f"Return answer as a JSON array of {len(items)} strings of that form, one per input, in input order."
    )
    return "medium", prompt, ans


# ---------------------------------------------------------------- 03 medium
def t_month_end_chains():
    def apply(d, op):
        if op == "EOM":
            return D(d.year, d.month, last_dom(d.year, d.month))
        kind, k = op[0], int(op[1:])
        if kind == "M":
            return add_months(d, k)
        if kind == "Y":
            return add_months(d, 12 * k)
        if kind == "D":
            return d + TD(days=k)
        raise ValueError(op)

    chains = [
        (D(2024, 1, 31), ["M+1", "M+1", "M-1", "Y+1", "D-1"]),
        (D(2000, 2, 29), ["Y+100", "D+1", "M-1", "EOM", "D+1"]),
        (D(2099, 12, 31), ["D+60", "EOM", "M-1", "Y-4", "D+2"]),
        (D(1900, 3, 1), ["D-1", "Y+4", "EOM", "Y+1", "M+12"]),
        (D(2023, 8, 31), ["M+6", "D+366", "M-13", "EOM", "M+1"]),
        (D(2026, 10, 31), ["M+4", "D+1", "M-1", "D-1", "Y+2"]),
        (D(2096, 2, 29), ["Y+4", "D+1", "Y-4", "D-1", "M+1"]),
    ]
    ans, lines = [], []
    for i, (s, ops) in enumerate(chains):
        d = s
        for op in ops:
            d = apply(d, op)
        ans.append(d.isoformat())
        lines.append(f"{i + 1}) {s.isoformat()}: " + ", ".join(ops))
    prompt = (
        "Calendar is Gregorian: a year is leap if divisible by 4, except centuries, which are leap only if "
        "divisible by 400 (so 1900 and 2100 are not leap; 2000 and 2096 are). Operations on a date: "
        "M+k / M-k = move k calendar months forward/back, keeping the day-of-month, but if the target month "
        "is too short use that month's last day. Y+k / Y-k = move k years, i.e. exactly 12k months with the "
        "same clamping rule. D+k / D-k = move k calendar days. EOM = set the day to the last day of the "
        "date's current month. Each operation uses only the date produced by the previous one (no memory of "
        "an earlier, larger day-of-month). Apply the operations of each chain left to right to its start "
        "date. Chains: " + " | ".join(lines) + ". "
        f"Return answer as a JSON array of {len(chains)} strings of the form \"YYYY-MM-DD\", one final date per chain, in chain order."
    )
    return "medium", prompt, ans


# ---------------------------------------------------------------- 04 hard
def t_cron():
    minutes, hours = {5, 35}, {0, 23}
    months = {2, 3, 4}
    doms = {29, 30, 31}
    wd = 1  # Tuesday
    blackout = {D(2028, 3, 7), D(2028, 3, 29)}
    assert D(2028, 1, 1).weekday() == 5
    start = DT(2028, 2, 29, 0, 5)
    want = 18

    def fires(t):
        if t.minute not in minutes or t.hour not in hours or t.month not in months:
            return False
        if t.date() in blackout:
            return False
        return t.day in doms or t.weekday() == wd

    out, t = [], start
    while len(out) < want:
        t += TD(minutes=1)
        if fires(t):
            out.append(t.strftime("%Y-%m-%d %H:%M"))
    prompt = (
        "A scheduler fires at a given minute when ALL of these hold: the minute is 5 or 35; the hour is 0 or "
        "23; the month is February, March or April; and the calendar day qualifies. A day qualifies if its "
        "day-of-month is 29, 30 or 31, OR its weekday is Tuesday (either condition alone is enough; a day "
        "meeting both still fires only once per matching time). Blackout dates: nothing fires at any time "
        "on 2028-03-07 or 2028-03-29. All times are in one fixed time zone with no daylight saving. 2028 is "
        "a leap year. Reference fact: 2028-01-01 is a Saturday. List the next 18 firing times strictly "
        "after 2028-02-29 00:05, in chronological order. "
        "Return answer as a JSON array of 18 strings of the form \"YYYY-MM-DD HH:MM\" (24-hour clock)."
    )
    return "hard", prompt, out


# ---------------------------------------------------------------- 05 hard
STD, DSTO = -210, -150  # minutes offset from UTC for zone Zeta


def zeta_transitions(y):
    s_local = DT.combine(last_sunday(y, 3), dt.time(2, 0))  # 02:00 standard
    e_local = DT.combine(last_sunday(y, 10), dt.time(2, 0))  # 02:00 daylight
    return s_local - TD(minutes=STD), e_local - TD(minutes=DSTO)


def zeta_off(utc):
    s, e = zeta_transitions(utc.year)
    return DSTO if s <= utc < e else STD


def zeta_cands(local):
    c = []
    for o in (STD, DSTO):
        u = local - TD(minutes=o)
        if zeta_off(u) == o:
            c.append(u)
    return sorted(c)


def zeta_parse(local, tag=None):
    c = zeta_cands(local)
    assert c, f"nonexistent local time {local}"
    if len(c) == 2:
        assert tag in ("first", "second")
        return c[0] if tag == "first" else c[1]
    assert tag is None
    return c[0]


def zeta_fmt(utc):
    off = zeta_off(utc)
    local = utc + TD(minutes=off)
    s = local.strftime("%Y-%m-%d %H:%M")
    if len(zeta_cands(local)) == 2:
        s += " (first)" if off == DSTO else " (second)"
    return s


def t_dst():
    sp27 = last_sunday(2027, 3)
    fa27 = last_sunday(2027, 10)
    sp28 = last_sunday(2028, 3)
    fa28 = last_sunday(2028, 10)
    fa29 = last_sunday(2029, 10)
    assert D(2027, 3, 1).weekday() == 0

    def at(d, hh, mm):
        return DT.combine(d, dt.time(hh, mm))

    def ts(local, tag=None):
        return local.strftime("%Y-%m-%d %H:%M") + (f" ({tag})" if tag else "")

    # elapsed-minutes items: (startlocal, starttag, endlocal, endtag)
    el = [
        (at(sp27 - TD(days=1), 22, 0), None, at(sp27, 5, 0), None),
        (at(fa27, 0, 30), None, at(fa27, 3, 15), None),
        (at(fa28, 1, 20), "first", at(fa28, 1, 10), "second"),
        (DT(2028, 2, 28, 12, 0), None, DT(2028, 3, 1, 12, 0), None),
        (DT(2028, 3, 15, 8, 0), None, DT(2028, 10, 20, 8, 0), None),
    ]
    # forward items: (startlocal, tag, minutes)
    fw = [
        (at(sp28, 1, 30), None, 90),
        (at(fa28, 0, 45), None, 100),
        (at(fa29, 1, 50), "first", 30),
        (DT(2028, 12, 31, 22, 15), None, 2000),
    ]
    ans, a_txt, b_txt = [], [], []
    for sl, st, elc, et in el:
        u1, u2 = zeta_parse(sl, st), zeta_parse(elc, et)
        ans.append(int((u2 - u1).total_seconds() // 60))
        a_txt.append(f"{ts(sl, st)} to {ts(elc, et)}")
    for sl, st, mins in fw:
        u = zeta_parse(sl, st) + TD(minutes=mins)
        ans.append(zeta_fmt(u))
        b_txt.append(f"{ts(sl, st)} plus {mins} minutes")
    prompt = (
        "Time zone Zeta uses standard time UTC-03:30 and daylight time UTC-02:30. Daylight time starts at "
        "02:00 standard time on the last Sunday of March (clocks jump from 02:00 to 03:00, so local times "
        "02:00-02:59 do not exist that day) and ends at 02:00 daylight time on the last Sunday of October "
        "(clocks go back from 02:00 to 01:00, so local times 01:00-01:59 occur twice that day; the tag "
        "(first) marks the daylight-time occurrence and (second) the standard-time one). All timestamps are "
        "Zeta local times in format YYYY-MM-DD HH:MM. Gregorian leap years apply. Reference fact: "
        "2027-03-01 is a Monday. Part A, real elapsed minutes from the first to the second timestamp: "
        + "; ".join(f"A{i + 1}) {t}" for i, t in enumerate(a_txt)) + ". "
        "Part B, the Zeta local timestamp reached after adding the stated real elapsed minutes (append "
        "\" (first)\" or \" (second)\" to the result only if the result falls in a repeated hour): "
        + "; ".join(f"B{i + 1}) {t}" for i, t in enumerate(b_txt)) + ". "
        f"Return answer as a JSON array of {len(ans)} items in order A1..A{len(el)}, B1..B{len(fw)}: the first "
        f"{len(el)} are integers, the last {len(fw)} are strings like \"YYYY-MM-DD HH:MM\"."
    )
    return "hard", prompt, ans


# ---------------------------------------------------------------- 06 hard
def t_overlap():
    base = D(2026, 12, 7)  # Monday, UTC
    assert base.weekday() == 0
    dur = 60
    pool = [-480, -420, -360, -300, -240, -180, 0, 60, 120, 330, 345, 420, 480, 540, 570, 600, 660, 720]

    def feasible(people, check_weekday=True, check_lunch=True):
        res = []
        for t in range(0, 24 * 60, 30):
            ok = True
            for off, s, e, ls, le in people:
                loc = t + off  # minutes since 00:00 UTC of base date, shifted to local
                day, rem = divmod(loc, 1440)
                if check_weekday and (0 + day) % 7 >= 5:  # base day is Monday=0
                    ok = False
                    break
                if rem < s or rem + dur > e:
                    ok = False
                    break
                if check_lunch and not (rem + dur <= ls or rem >= le):
                    ok = False
                    break
            if ok:
                res.append(f"{t // 60:02d}:{t % 60:02d}")
        return res

    rng = random.Random(20261107)
    chosen = None
    for _ in range(400000):
        offs = rng.sample(pool, 4)
        people = []
        for off in offs:
            s = rng.choice([420, 450, 480, 510, 540, 570, 600])
            e = s + rng.choice([450, 480, 510, 540])
            ls = rng.choice([690, 720, 750, 780])
            le = ls + rng.choice([45, 60, 75])
            if not (s + 120 <= ls and le + 120 <= e):
                break
            people.append((off, s, e, ls, le))
        else:
            ans = feasible(people)
            if (3 <= len(ans) <= 9
                    and feasible(people, check_weekday=False) != ans
                    and feasible(people, check_lunch=False) != ans
                    and len({p[0] for p in people}) == 4):
                chosen = (people, ans)
                break
    assert chosen, "no parameter set found"
    people, ans = chosen

    def hhmm(m):
        return f"{m // 60:02d}:{m % 60:02d}"

    def offs(o):
        sign = "+" if o >= 0 else "-"
        return f"UTC{sign}{abs(o) // 60:02d}:{abs(o) % 60:02d}"

    plines = "; ".join(
        f"P{i + 1} is at {offs(o)}, works {hhmm(s)}-{hhmm(e)} local with lunch {hhmm(ls)}-{hhmm(le)} local"
        for i, (o, s, e, ls, le) in enumerate(people))
    prompt = (
        "Four people have fixed UTC offsets (no daylight saving): " + plines + ". Each person works only on "
        "their own local Monday to Friday; local Saturday and Sunday are fully off. A candidate meeting "
        f"lasts {dur} minutes and starts at a UTC time of day on 2026-12-07 that is a multiple of 30 "
        "minutes (00:00, 00:30, ..., 23:30). It is feasible when, for every person, the whole meeting lies "
        "inside that person's working hours on a local working day (judge each person's local date and "
        "time at the meeting, which may differ from the UTC date), and the meeting overlaps no one's lunch "
        "(a meeting may end exactly when lunch starts or start exactly when lunch ends). Working hours "
        "include their start and end instants. Reference fact: 2026-12-07 is a Monday in UTC. List every "
        "feasible start time as a UTC time. "
        "Return answer as a JSON array of strings \"HH:MM\" (UTC, 24-hour), in ascending order."
    )
    return "hard", prompt, ans


# ---------------------------------------------------------------- 07 hard
def t_recurring():
    start = D(2026, 12, 16)
    assert start.weekday() == 2 and D(2026, 12, 14).weekday() == 0
    count = 16
    byday = {0, 3}  # Monday, Thursday
    exdates = [D(2026, 12, 28), D(2027, 1, 14)]
    moves = [(D(2027, 2, 11), D(2027, 2, 8)), (D(2027, 1, 11), D(2027, 1, 16))]
    holidays = [D(2026, 12, 25), D(2026, 12, 31), D(2027, 1, 1), D(2027, 1, 18),
                D(2027, 1, 25), D(2027, 2, 8)]
    hol = set(holidays)

    first_monday = start - TD(days=start.weekday())
    occ, d = [], start
    while len(occ) < count:
        week = (d - first_monday).days // 7
        if week % 2 == 0 and d.weekday() in byday:
            occ.append(d)
        d += TD(days=1)
    ex = set(exdates)
    mv = dict(moves)
    res = []
    for o in occ:
        if o in ex:
            continue
        cur = mv.get(o, o)
        while cur in hol:
            cur += TD(days=1)
            while cur.weekday() >= 5 or cur in hol:
                cur += TD(days=1)
        res.append(cur)
    res.sort()
    ans = [r.isoformat() for r in res]
    # sanity: the deliberate duplicate must be present
    assert len(set(ans)) < len(ans)
    prompt = (
        "A calendar series starts on 2026-12-16 (a Wednesday) and repeats every 2 weeks on Monday and "
        "Thursday, with COUNT=16. Weeks run Monday to Sunday; the first week is the week containing the "
        "start date, and the series occurs in the first week and in every 2nd week after it. Days before "
        "the start date are not part of the series. Reference fact: 2026-12-14 is a Monday. Generate the "
        "first 16 occurrences in chronological order (COUNT is counted before any exception below). Then "
        "apply, in this order: (1) EXDATES: delete every occurrence whose original date is "
        + " or ".join(x.isoformat() for x in exdates) + ". "
        "(2) MOVES: an occurrence whose original date is on the left of an arrow is relocated to the date "
        "on the right: " + ", ".join(f"{a.isoformat()} -> {b.isoformat()}" for a, b in moves) + " (a moved "
        "date may fall on any weekday). (3) HOLIDAYS: " + ", ".join(h.isoformat() for h in holidays) + ". "
        "Every remaining occurrence whose current date (after step 2) is a holiday is moved to the first "
        "later date that is neither a Saturday, a Sunday nor a holiday; this uses only the holiday list, "
        "ignoring other occurrences. If two occurrences end on the same date, keep both entries. "
        "Return answer as a JSON array of the final dates as \"YYYY-MM-DD\" strings sorted ascending."
    )
    return "hard", prompt, ans


# ---------------------------------------------------------------- main
def main():
    builders = [t_business_days, t_iso_weeks, t_month_end_chains,
                t_cron, t_dst, t_overlap, t_recurring]
    tasks = []
    for i, b in enumerate(builders, 1):
        tier, prompt, ans = b()
        assert 300 <= len(prompt) <= 1800, (b.__name__, len(prompt))
        assert isinstance(ans, list) and 1 <= len(ans) <= 40, b.__name__
        assert all(isinstance(x, (str, int)) and not isinstance(x, bool) for x in ans)
        tasks.append({"id": f"{CATEGORY}-{i:02d}", "category": CATEGORY, "tier": tier,
                      "prompt": prompt, "expectedAnswer": ans})
    assert sum(t["tier"] == "medium" for t in tasks) == 3
    assert sum(t["tier"] == "hard" for t in tasks) == 4
    with open(os.path.join(HERE, f"{CATEGORY}.tasks.json"), "w") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)
        f.write("\n")
    stripped = [{k: v for k, v in t.items() if k != "expectedAnswer"} for t in tasks]
    with open(os.path.join(HERE, f"{CATEGORY}.prompts.json"), "w") as f:
        json.dump(stripped, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(tasks)} tasks")


if __name__ == "__main__":
    main()
