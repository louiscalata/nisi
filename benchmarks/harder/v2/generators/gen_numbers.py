#!/usr/bin/env python3
"""Generator for the nisi-harder-v2 "numbers" category (7 tasks).

Python 3 standard library only. Deterministic (fixed seeds). No network, no
input files. Every expectedAnswer is computed here; none is typed by hand.

Running `python3 gen_numbers.py` writes, next to this script:
  numbers.tasks.json    full tasks (with expectedAnswer)
  numbers.prompts.json  the same tasks with expectedAnswer removed
"""
import heapq
import itertools
import json
import os
import random
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, localcontext
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
CATEGORY = "numbers"


def fr(x):
    """Fraction -> exact JSON fraction object."""
    return {"numerator": x.numerator, "denominator": x.denominator}


# --------------------------------------------------------------------------
# numbers-01 (medium): 12-bit two's complement, wrapped deltas, run-length
# --------------------------------------------------------------------------
def task_01():
    deltas_build = [-100, 7, 7, 7, 0, 0, 0, 0, -2048, 5, 5, 1999, 1999,
                    -3, -3, -3, 2047, 2047, -1, 0, 0, 12]
    cur = 0
    samples = []
    for d in deltas_build:
        cur = (cur + d) % 4096
        samples.append(cur)
    hexes = ["%03X" % s for s in samples]

    # independent decode from the hex strings
    def signed12(h):
        v = int(h, 16)
        return v - 4096 if v >= 2048 else v

    vals = [signed12(h) for h in hexes]
    deltas = [vals[0]]
    for i in range(1, len(vals)):
        d = vals[i] - vals[i - 1]
        while d > 2047:
            d -= 4096
        while d < -2048:
            d += 4096
        deltas.append(d)
    rle = []
    for d in deltas:
        if rle and rle[-1][0] == d:
            rle[-1][1] += 1
        else:
            rle.append([d, 1])

    prompt = (
        "A sensor emits 12-bit two's-complement samples, written as 3-digit "
        "uppercase hexadecimal strings. The sample sequence, in order, is:\n"
        + " ".join(hexes) + "\n\n"
        "Step 1: decode each sample to its signed decimal value (range -2048..2047).\n"
        "Step 2: build a delta list: the first delta is the first decoded value "
        "itself; every later delta is (current value minus previous value), "
        "then wrapped into the range -2048..2047 by adding or subtracting 4096 "
        "as many times as needed (so a raw difference of +2048 or -2048 both "
        "become -2048).\n"
        "Step 3: run-length encode the delta list: collapse each maximal run of "
        "equal consecutive deltas into a pair [delta, count].\n"
        "Return answer as a JSON array of [delta, count] pairs of integers, in "
        "order, e.g. {\"answer\": [[-5, 1], [3, 2]]}."
    )
    return {"id": "numbers-01", "category": CATEGORY, "tier": "medium",
            "prompt": prompt, "expectedAnswer": rle}


# --------------------------------------------------------------------------
# numbers-02 (medium): Luhn, ISBN-13, IBAN check digits
# --------------------------------------------------------------------------
def luhn_check_digit(body):
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:  # rightmost digit of the body is doubled
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10


def isbn13_check_digit(body):
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(body))
    return (10 - total % 10) % 10


def iban_value(s):
    out = []
    for c in s:
        out.append(str(ord(c) - 55) if c.isalpha() else c)
    return int("".join(out))


def iban_check(country, bban):
    n = iban_value(bban + country + "00")
    return "%02d" % (98 - n % 97)


def task_02():
    rng = random.Random(20261108)

    def rand_digits(n):
        return "".join(str(rng.randrange(10)) for _ in range(n))

    def pick(gen, cond):
        while True:
            v = gen()
            if cond(v):
                return v

    luhn_a = pick(lambda: "4" + rand_digits(14), lambda b: luhn_check_digit(b) == 0)
    luhn_b = pick(lambda: "5" + rand_digits(14),
                  lambda b: luhn_check_digit(b) not in (0,) and "9" in b[-3:])
    isbn_a = pick(lambda: "978" + rand_digits(9), lambda b: isbn13_check_digit(b) == 0)
    isbn_b = pick(lambda: "979" + rand_digits(9), lambda b: isbn13_check_digit(b) not in (0,))
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    # IBAN A: GB, BBAN = 4 letters + 14 digits ; require check digits < 10 (leading zero)
    iban_a_bban = pick(lambda: "".join(rng.choice(letters) for _ in range(4)) + rand_digits(14),
                       lambda b: int(iban_check("GB", b)) < 10)
    # IBAN B: DE, BBAN = 18 digits
    iban_b_bban = pick(lambda: rand_digits(18), lambda b: int(iban_check("DE", b)) >= 10)

    items = [
        ("L", luhn_a), ("I", isbn_a), ("N", ("GB", iban_a_bban)),
        ("N", ("DE", iban_b_bban)), ("L", luhn_b), ("I", isbn_b),
    ]
    lines = []
    answer = []
    for n, (kind, v) in enumerate(items, 1):
        if kind == "L":
            lines.append("%d. LUHN body %s" % (n, v))
            answer.append(v + str(luhn_check_digit(v)))
        elif kind == "I":
            lines.append("%d. ISBN13 body %s" % (n, v))
            answer.append(v + str(isbn13_check_digit(v)))
        else:
            cc, bban = v
            lines.append("%d. IBAN country %s bban %s" % (n, cc, bban))
            answer.append(cc + iban_check(cc, bban) + bban)

    prompt = (
        "Compute the missing check data for six items and return each completed "
        "identifier as a string, in the listed order.\n"
        + "\n".join(lines) + "\n\n"
        "Rules.\n"
        "LUHN: the body has no check digit yet. Working from the RIGHTMOST digit "
        "of the body, double that digit and every second digit moving left; if a "
        "doubled value exceeds 9 subtract 9 from it. Let S be the sum of all "
        "resulting digits. The check digit is (10 - S mod 10) mod 10, appended "
        "to the right of the body.\n"
        "ISBN13: the body has 12 digits. Multiply the digits by weights 1,3,1,3,... "
        "from the left, sum them as S; the check digit is (10 - S mod 10) mod 10, "
        "appended to the right.\n"
        "IBAN: form the string bban + country + \"00\", replace each letter by its "
        "two-digit value (A=10, B=11, ..., Z=35), read the result as one decimal "
        "integer N, and compute check = 98 - (N mod 97), written as exactly two "
        "digits with a leading zero if needed. The completed IBAN is country + "
        "check + bban, with no spaces.\n"
        "Return answer as a JSON array of 6 strings, e.g. {\"answer\": "
        "[\"...\", \"...\", \"...\", \"...\", \"...\", \"...\"]}."
    )
    return {"id": "numbers-02", "category": CATEGORY, "tier": "medium",
            "prompt": prompt, "expectedAnswer": answer}


# --------------------------------------------------------------------------
# numbers-03 (medium): rounding under named modes, then exact sum
# --------------------------------------------------------------------------
def round_fraction(v, places, mode):
    """Independent Fraction-based rounding (for cross-checking Decimal)."""
    scale = 10 ** places
    q = v * scale
    sign = -1 if q < 0 else 1
    a = abs(q)
    fl = a.numerator // a.denominator
    rem = a - fl
    if mode == "TZ":
        r = fl
    elif mode == "HU":
        r = fl + 1 if rem >= Fraction(1, 2) else fl
    elif mode == "HE":
        if rem > Fraction(1, 2):
            r = fl + 1
        elif rem < Fraction(1, 2):
            r = fl
        else:
            r = fl if fl % 2 == 0 else fl + 1
    else:
        raise ValueError(mode)
    return Fraction(sign * r, scale)


def fmt_fixed(fr_val, places):
    """Exact decimal string of a Fraction with exactly `places` decimals."""
    scale = 10 ** places
    num = fr_val * scale
    assert num.denominator == 1
    n = num.numerator
    neg = n < 0
    n = abs(n)
    s = str(n).rjust(places + 1, "0")
    if places:
        s = s[:-places] + "." + s[-places:]
    if neg and n != 0:  # never print negative zero
        s = "-" + s
    return s


def task_03():
    # (value, places, mode)
    rows = [
        ("2.5", 0, "HE"), ("-2.5", 0, "HU"), ("0.125", 2, "HE"),
        ("-0.135", 2, "HE"), ("7.0449", 2, "TZ"), ("-7.0451", 2, "TZ"),
        ("-0.0049", 2, "TZ"), ("1.0005", 3, "HU"), ("-1.0005", 3, "HE"),
        ("123.4565", 3, "HE"), ("-0.5", 0, "HE"), ("99.9995", 3, "HU"),
    ]
    out = []
    total = Fraction(0)
    ctx_modes = {"HE": ROUND_HALF_EVEN, "HU": ROUND_HALF_UP, "TZ": ROUND_DOWN}
    for v, p, m in rows:
        f = Fraction(v)
        r_frac = round_fraction(f, p, m)
        with localcontext() as ctx:
            ctx.prec = 60
            r_dec = Decimal(v).quantize(Decimal(1).scaleb(-p), rounding=ctx_modes[m])
        assert Fraction(r_dec) == r_frac, (v, p, m, r_dec, r_frac)
        out.append(fmt_fixed(r_frac, p))
        total += r_frac
    out.append(fmt_fixed(total, 3))

    lines = ["%d. value %s, %d decimal places, mode %s" % (i, v, p, m)
             for i, (v, p, m) in enumerate(rows, 1)]
    prompt = (
        "Round each decimal value below to the given number of decimal places "
        "using the named mode, then add up the twelve ROUNDED values exactly.\n"
        + "\n".join(lines) + "\n\n"
        "Modes. HE = half-even: a value exactly halfway between two candidates "
        "goes to the candidate whose last kept digit is even. HU = half-up as "
        "taught in school: an exact tie goes to the candidate farther from zero "
        "(so -2.5 to 0 places becomes -3). TZ = toward zero: simply drop the "
        "extra digits (truncate). All non-tie values round to the nearest "
        "candidate under HE and HU.\n"
        "Format. Write every rounded value as a plain decimal string with exactly "
        "the requested number of decimal places (for 0 places, no decimal "
        "point). Never write negative zero: a result equal to zero is written "
        "without a minus sign, e.g. \"0.00\". The final element is the exact sum "
        "of the twelve rounded values, written with exactly 3 decimal places.\n"
        "Return answer as a JSON array of 13 strings (twelve rounded values in "
        "order, then the sum), e.g. {\"answer\": [\"1.50\", \"-2\", ..., \"0.000\"]}."
    )
    return {"id": "numbers-03", "category": CATEGORY, "tier": "medium",
            "prompt": prompt, "expectedAnswer": out}


# --------------------------------------------------------------------------
# numbers-04 (hard): Huffman code lengths and codes with a total tie order
# --------------------------------------------------------------------------
def huffman(freqs):
    # node = (weight, kind, tiebreak, id, left_id, right_id); kind 0 leaf, 1 internal
    heap = []
    nodes = {}
    nid = 0
    for sym, w in freqs.items():
        nodes[nid] = (sym, None, None)
        heapq.heappush(heap, (w, 0, sym, nid))
        nid += 1
    created = 0
    while len(heap) > 1:
        a = heapq.heappop(heap)
        b = heapq.heappop(heap)
        created += 1
        nodes[nid] = (None, a[3], b[3])
        heapq.heappush(heap, (a[0] + b[0], 1, "%09d" % created, nid))
        nid += 1
    root = heap[0][3]
    codes = {}

    def walk(n, pre):
        sym, l, r = nodes[n]
        if sym is not None:
            codes[sym] = pre or "0"
            return
        walk(l, pre + "0")
        walk(r, pre + "1")

    walk(root, "")
    return codes


def task_04():
    freqs = {"A": 5, "B": 9, "C": 12, "D": 13, "E": 16, "F": 5, "G": 9,
             "H": 3, "I": 3, "J": 14}
    codes = huffman(freqs)
    total_bits = sum(freqs[s] * len(c) for s, c in codes.items())
    # check prefix-freeness and Kraft equality
    cl = list(codes.values())
    for x, y in itertools.permutations(cl, 2):
        assert not y.startswith(x)
    assert sum(Fraction(1, 2 ** len(c)) for c in cl) == 1

    order = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]
    table = ", ".join("%s=%d" % (s, freqs[s]) for s in order)
    prompt = (
        "Build a Huffman code for these symbol frequencies: " + table + ".\n\n"
        "Use exactly this procedure. Every node (leaf or internal) has a weight. "
        "Nodes are ordered by the key (weight, kind, tiebreak), compared "
        "lexicographically: smaller weight first; at equal weight a LEAF comes "
        "before an INTERNAL node; two leaves of equal weight are ordered by "
        "symbol in alphabetical order; two internal nodes of equal weight are "
        "ordered by creation order (the node created earlier comes first). "
        "Repeat until one node remains: remove the two smallest nodes under this "
        "order; the FIRST one removed becomes the left child (edge label \"0\"), "
        "the SECOND one removed becomes the right child (edge label \"1\"); "
        "create an internal node whose weight is the sum, and which counts as "
        "newly created (internal nodes are numbered 1, 2, 3, ... in creation "
        "order). A symbol's code is the string of edge labels from the root "
        "down to its leaf.\n\n"
        "Report the code of every symbol and the total number of bits needed to "
        "encode a message that contains each symbol exactly as many times as its "
        "frequency (sum of frequency times code length).\n"
        "Return answer as a JSON object {\"codes\": {\"A\": \"<bits>\", ... for "
        "all 10 symbols}, \"total_bits\": <integer>}."
    )
    return {"id": "numbers-04", "category": CATEGORY, "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {"codes": {s: codes[s] for s in order},
                               "total_bits": total_bits}}


# --------------------------------------------------------------------------
# numbers-05 (hard): chained modular exponentiation (composite moduli, huge e)
# --------------------------------------------------------------------------
def task_05():
    x0 = 12
    steps = [  # (exponent, addend c, modulus m)
        (10 ** 12 + 7, -5, 101),
        (2 ** 40 + 1, 18, 91),
        (10 ** 9 + 6, -40, 360),
        (3 ** 25, 7, 1001),
        (10 ** 15 + 3, 1, 97),
    ]
    xs = []
    x = x0
    for e, c, m in steps:
        # independent check by square-and-multiply
        r, b, ee = 1, x % m, e
        while ee:
            if ee & 1:
                r = r * b % m
            b = b * b % m
            ee >>= 1
        assert r == pow(x, e, m)
        x = (r + c) % m
        xs.append(x)
    lines = ["step %d: exponent %d, addend %d, modulus %d" % (i, e, c, m)
             for i, (e, c, m) in enumerate(steps, 1)]
    prompt = (
        "Start with x0 = " + str(x0) + ". Apply the five steps below in order. "
        "In step i, x_i = ((x_(i-1) ^ exponent_i) + addend_i) mod modulus_i, "
        "where x_(i-1) is the exact integer produced by the previous step and "
        "^ is ordinary exponentiation. The final mod always yields a value in "
        "0..modulus_i - 1 (a negative sum is wrapped up into that range). "
        "Exponents are given in full decimal.\n"
        + "\n".join(lines) + "\n\n"
        "Return answer as a JSON array of the five integers [x_1, x_2, x_3, x_4, "
        "x_5], e.g. {\"answer\": [1, 2, 3, 4, 5]}."
    )
    return {"id": "numbers-05", "category": CATEGORY, "tier": "hard",
            "prompt": prompt, "expectedAnswer": xs}


# --------------------------------------------------------------------------
# numbers-06 (hard): continued fractions <-> exact fractions
# --------------------------------------------------------------------------
def cf_to_fraction(terms):
    val = Fraction(terms[-1])
    for a in reversed(terms[:-1]):
        val = a + 1 / val
    return val


def fraction_to_cf(x):
    terms = []
    num, den = x.numerator, x.denominator
    while True:
        a = num // den  # floor division (floor for negatives)
        terms.append(a)
        num, den = den, num - a * den
        if den == 0:
            break
    if len(terms) > 1 and terms[-1] == 1:  # canonical: last term > 1
        terms.pop()
        terms[-1] += 1
    return terms


def task_06():
    A = [-3, 2, 5, 1, 7]
    B = [0, 4, 1, 9, 2]
    fa, fb = cf_to_fraction(A), cf_to_fraction(B)
    X = fa * fb - fa + Fraction(1, 3)
    cf = fraction_to_cf(X)
    assert cf_to_fraction(cf) == X
    # convergents (for the extra question): first with denominator >= 20
    conv = None
    h0, h1, k0, k1 = 1, cf[0], 0, 1
    convs = [Fraction(h1, k1)]
    for a in cf[1:]:
        h0, h1 = h1, a * h1 + h0
        k0, k1 = k1, a * k1 + k0
        convs.append(Fraction(h1, k1))
    for c in convs:
        if c.denominator >= 20:
            conv = c
            break
    assert conv is not None
    prompt = (
        "Let A be the continued fraction [-3; 2, 5, 1, 7] and B be the continued "
        "fraction [0; 4, 1, 9, 2], where [a0; a1, a2, ...] means "
        "a0 + 1/(a1 + 1/(a2 + ...)). Compute the exact rational number\n"
        "X = A*B - A + 1/3\n"
        "and reduce it to lowest terms with a positive denominator.\n\n"
        "Then expand X as a simple continued fraction [c0; c1, c2, ...] where c0 "
        "is the FLOOR of X (so c0 is negative if X is negative), every later "
        "term is a positive integer, and the expansion is the canonical one "
        "whose last term is greater than 1 (unless X is an integer, in which "
        "case it has a single term).\n\n"
        "Finally list the convergents of that expansion in order (the k-th "
        "convergent is the value of [c0; c1, ..., ck] in lowest terms) and report "
        "the FIRST convergent whose denominator is at least 20.\n"
        "Return answer as a JSON object {\"fraction\": {\"numerator\": <int>, "
        "\"denominator\": <int>}, \"cf\": [<ints>], \"convergent\": "
        "{\"numerator\": <int>, \"denominator\": <int>}}."
    )
    return {"id": "numbers-06", "category": CATEGORY, "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {"fraction": fr(X), "cf": cf, "convergent": fr(conv)}}


# --------------------------------------------------------------------------
# numbers-07 (hard): constrained coin-change counting
# --------------------------------------------------------------------------
def task_07():
    coins = [4, 6, 9, 15, 25]
    target = 120
    max_coins = 12
    results = []
    for combo in itertools.product(*[range(target // c + 1) for c in coins]):
        if sum(n * c for n, c in zip(combo, coins)) != target:
            continue
        if sum(combo) > max_coins:
            continue
        if combo[2] % 2 != 1:  # number of 9-coins must be odd
            continue
        results.append(combo)
    count = len(results)
    fewest = min(sum(r) for r in results)
    n_fewest = sum(1 for r in results if sum(r) == fewest)
    # DP cross-check of the count
    dp = {(0, 0, 0): 1}  # (sum, coins, parity of 9s)
    for c in coins:
        new = {}
        for (s, k, p), ways in dp.items():
            j = 0
            while s + j * c <= target and k + j <= max_coins:
                key = (s + j * c, k + j, (p + (j if c == 9 else 0)) % 2)
                new[key] = new.get(key, 0) + ways
                j += 1
        dp = new
    dp_count = sum(w for (s, k, p), w in dp.items() if s == target and p == 1)
    assert dp_count == count, (dp_count, count)
    prompt = (
        "A cashier has unlimited coins of values 4, 6, 9, 15 and 25. A way to pay "
        "is a multiset of coins (order does not matter; two ways are the same "
        "if they use the same number of each denomination). Count the ways to "
        "pay exactly 120 that satisfy ALL of these rules: (a) at most 12 coins "
        "are used in total; (b) the number of 9-coins used is odd (so at least "
        "one 9-coin is used).\n\n"
        "Report three integers: the number of valid ways; the smallest total "
        "number of coins used by any valid way; and how many valid ways use "
        "exactly that smallest number of coins.\n"
        "Return answer as a JSON object {\"ways\": <int>, \"fewest_coins\": "
        "<int>, \"ways_with_fewest\": <int>}."
    )
    return {"id": "numbers-07", "category": CATEGORY, "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {"ways": count, "fewest_coins": fewest,
                               "ways_with_fewest": n_fewest}}


def main():
    tasks = [task_01(), task_02(), task_03(), task_04(), task_05(), task_06(),
             task_07()]
    for t in tasks:
        assert 300 <= len(t["prompt"]) <= 1800, (t["id"], len(t["prompt"]))
        json.dumps(t["expectedAnswer"])
    assert [t["tier"] for t in tasks].count("medium") == 3
    assert [t["tier"] for t in tasks].count("hard") == 4
    with open(os.path.join(HERE, "numbers.tasks.json"), "w") as f:
        json.dump(tasks, f, indent=2)
        f.write("\n")
    stripped = [{k: v for k, v in t.items() if k != "expectedAnswer"} for t in tasks]
    with open(os.path.join(HERE, "numbers.prompts.json"), "w") as f:
        json.dump(stripped, f, indent=2)
        f.write("\n")
    print("wrote %d tasks" % len(tasks))


if __name__ == "__main__":
    main()
