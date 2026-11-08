#!/usr/bin/env python3
"""Generator for the "algorithms" category of nisi-harder-v2.

Python 3 standard library only. Deterministic (fixed seeds), no network, no
input files. Every expectedAnswer is computed by solver code below and, where
practical, cross-checked by an independent brute-force implementation.

Running this script writes, next to itself:
  algorithms.tasks.json    full tasks (with expectedAnswer)
  algorithms.prompts.json  the same tasks with expectedAnswer removed
"""
import heapq
import itertools
import json
import os
import random
import re

CATEGORY = "algorithms"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def jdump(value):
    """Compact JSON used inside prompts."""
    return json.dumps(value, separators=(",", ":"))


# --------------------------------------------------------------------------
# 01 (medium)  Topological order, smallest-text tie rule
# --------------------------------------------------------------------------
def topo_order(names, edges):
    preds = {n: set() for n in names}
    succs = {n: set() for n in names}
    for a, b in edges:
        preds[b].add(a)
        succs[a].add(b)
    done = set()
    order = []
    trace_choices = []  # number of candidates at each step
    while len(order) < len(names):
        avail = sorted(n for n in names if n not in done and preds[n] <= done)
        assert avail, "cycle"
        trace_choices.append(len(avail))
        pick = avail[0]  # Python str order == code point order == plain text
        done.add(pick)
        order.append(pick)
    return order, trace_choices


def topo_order_heap(names, edges):
    """Independent implementation (Kahn with a heap) for cross-checking."""
    indeg = {n: 0 for n in names}
    adj = {n: set() for n in names}
    for a, b in set(edges):
        adj[a].add(b)
        indeg[b] += 1
    heap = [n for n in names if indeg[n] == 0]
    heapq.heapify(heap)
    out = []
    while heap:
        n = heapq.heappop(heap)
        out.append(n)
        for m in adj[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                heapq.heappush(heap, m)
    return out


def natural_key(s):
    m = re.match(r"([a-z]+)(\d+)$", s)
    return (m.group(1), int(m.group(2)))


def task_topo():
    names = ["n1", "n2", "n3", "n9", "n10", "n11", "n12", "n20", "n100", "m5", "m50", "m6"]
    for seed in range(2000):
        rng = random.Random(7100 + seed)
        hidden = names[:]
        rng.shuffle(hidden)
        edges = set()
        for i in range(len(hidden)):
            for j in range(i + 1, len(hidden)):
                if rng.random() < 0.2:
                    edges.add((hidden[i], hidden[j]))
        edges = sorted(edges)
        if not (13 <= len(edges) <= 17):
            continue
        order, choices = topo_order(names, edges)
        assert order == topo_order_heap(names, edges)
        # natural numeric tie-break must give a different (tempting wrong) answer
        nat = []
        done = set()
        preds = {n: {a for a, b in edges if b == n} for n in names}
        while len(nat) < len(names):
            avail = sorted((n for n in names if n not in done and preds[n] <= done), key=natural_key)
            nat.append(avail[0])
            done.add(avail[0])
        if nat == order:
            continue
        if sum(1 for c in choices if c >= 3) < 3:
            continue
        shown = edges[:]
        rng.shuffle(shown)
        shown.append(shown[rng.randrange(len(shown))])  # one duplicated line
        shown_names = names[:]
        rng.shuffle(shown_names)
        lines = "\n".join(f"{a} -> {b}" for a, b in shown)
        prompt = (
            "A build has 12 tasks: " + ", ".join(shown_names) + ".\n"
            "Each line below means the left task must be completed before the right task. "
            "A line may appear more than once; a repeated line is still just one constraint.\n"
            + lines + "\n"
            "Build the completion order with this procedure, repeated 12 times: among the "
            "not-yet-completed tasks whose prerequisites are ALL already completed, pick the one "
            "whose name is smallest when compared as plain text, character by character from the "
            "left (so 'n10' comes before 'n2', and 'm6' comes before 'n1'), and complete it.\n"
            "Return answer as a JSON array of the 12 task names in completion order, "
            'for example ["x1","x2",...].'
        )
        return {
            "id": "algorithms-01",
            "category": CATEGORY,
            "tier": "medium",
            "prompt": prompt,
            "expectedAnswer": order,
        }
    raise RuntimeError("topo: no instance")


# --------------------------------------------------------------------------
# 02 (medium)  Interval partitioning with a lowest-numbered-free-room rule
# --------------------------------------------------------------------------
def hhmm(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def partition_rooms(meetings, pick="lowest"):
    """meetings: list of (num, start, end). Returns dict num -> room."""
    order = sorted(meetings, key=lambda x: (x[1], x[2], x[0]))
    last_end = []  # last_end[r-1] = end of the last meeting in room r
    assign = {}
    for num, s, e in order:
        free = [r for r in range(len(last_end)) if last_end[r] <= s]
        if free:
            if pick == "lowest":
                r = min(free)
            else:  # most recently freed (largest last_end), ties lowest room
                r = min(free, key=lambda q: (-last_end[q], q))
            last_end[r] = e
        else:
            last_end.append(e)
            r = len(last_end) - 1
        assign[num] = r + 1
    return assign


def task_rooms():
    for seed in range(5000):
        rng = random.Random(9200 + seed)
        meetings = []
        for num in range(1, 13):
            s = 480 + 15 * rng.randrange(0, 17)       # 08:00 .. 12:00
            d = 15 * rng.randrange(2, 9)              # 30 .. 120 min
            meetings.append((num, s, s + d))
        ends = {e for _, _, e in meetings}
        touching = sum(1 for _, s, _ in meetings if s in ends)
        same_start = len({s for _, s, _ in meetings}) <= 10
        lowest = partition_rooms(meetings, "lowest")
        recent = partition_rooms(meetings, "recent")
        n_rooms = max(lowest.values())
        if touching < 3 or not same_start or n_rooms < 4:
            continue
        if lowest == recent:
            continue
        answer = [lowest[n] for n in range(1, 13)]
        lines = "\n".join(f"M{n}: {hhmm(s)}-{hhmm(e)}" for n, s, e in meetings)
        prompt = (
            "Twelve meetings must be placed into numbered rooms (Room 1, Room 2, ...). "
            "Times are 24-hour HH:MM and each meeting's end time is exclusive, so a meeting "
            "ending at 10:00 and one starting at 10:00 may use the same room.\n"
            + lines + "\n"
            "Process the meetings in this order: earliest start time first; if starts are equal, "
            "the earlier end time first; if still equal, the smaller meeting number first. "
            "Put each meeting in the LOWEST-numbered room that is free at its start time (a room "
            "is free if its most recently assigned meeting has ended by then). If no existing room "
            "is free, open the next unused room number (rooms are opened in order 1, 2, 3, ...).\n"
            "Return answer as a JSON array of 12 integers: the room number of M1, M2, ..., M12 in "
            "that order (meeting-number order, not processing order)."
        )
        return {
            "id": "algorithms-02",
            "category": CATEGORY,
            "tier": "medium",
            "prompt": prompt,
            "expectedAnswer": answer,
        }
    raise RuntimeError("rooms: no instance")


# --------------------------------------------------------------------------
# 03 (medium)  Glob matching with classes, negation, escapes
# --------------------------------------------------------------------------
def parse_glob(p):
    toks = []
    i = 0
    while i < len(p):
        c = p[i]
        if c == "\\":
            toks.append(("lit", p[i + 1]))
            i += 2
        elif c == "*":
            toks.append(("star",))
            i += 1
        elif c == "?":
            toks.append(("any",))
            i += 1
        elif c == "[":
            j = i + 1
            neg = False
            if p[j] == "!":
                neg = True
                j += 1
            items = []
            while p[j] != "]":
                if j + 2 < len(p) and p[j + 1] == "-" and p[j + 2] != "]":
                    items.append((p[j], p[j + 2]))
                    j += 3
                else:
                    items.append((p[j], p[j]))
                    j += 1
            toks.append(("cls", neg, tuple(items)))
            i = j + 1
        else:
            toks.append(("lit", c))
            i += 1
    return toks


def glob_match(p, s):
    toks = parse_glob(p)
    memo = {}

    def go(ti, si):
        key = (ti, si)
        if key in memo:
            return memo[key]
        if ti == len(toks):
            r = si == len(s)
        else:
            t = toks[ti]
            if t[0] == "star":
                r = go(ti + 1, si) or (si < len(s) and go(ti, si + 1))
            elif si >= len(s):
                r = False
            elif t[0] == "any":
                r = go(ti + 1, si + 1)
            elif t[0] == "lit":
                r = s[si] == t[1] and go(ti + 1, si + 1)
            else:
                inside = any(lo <= s[si] <= hi for lo, hi in t[2])
                r = (inside != t[1]) and go(ti + 1, si + 1)
        memo[key] = r
        return r

    return go(0, 0)


def glob_match_regex(p, s):
    """Independent implementation: translate to a regular expression."""
    out = []
    for t in parse_glob(p):
        if t[0] == "lit":
            out.append(re.escape(t[1]))
        elif t[0] == "star":
            out.append(".*")
        elif t[0] == "any":
            out.append(".")
        else:
            body = "".join(
                (re.escape(lo) if lo == hi else re.escape(lo) + "-" + re.escape(hi))
                for lo, hi in t[2]
            )
            out.append("[" + ("^" if t[1] else "") + body + "]")
    return re.fullmatch("".join(out), s, re.S) is not None


def task_glob():
    pairs = [
        ("*.t[xs]t", "notes.v2.txt"),
        ("[!a-c]*[a-c]", "zzzb"),
        ("\\*?*", "*"),
        ("\\*?*", "*x"),
        ("[a-]x", "-x"),
        ("[a-]x", "bx"),
        ("??[0-9][0-9]*", "ab07"),
        ("??[0-9][0-9]*", "a1b07"),
        ("*[A-Z]*[a-z]", "x9Zq9"),
        ("[a-cx-z]*[!a-cx-z]", "azb7"),
        ("a**b?", "ab"),
        ("\\[a\\]", "[a]"),
        ("[a]", "[a]"),
        ("*?*?*?", "ab"),
        ("*a*a?", "baab"),
        ("[!-a]?*", "-q"),
        ("*\\\\*", "dir\\file"),
    ]
    answers = []
    for p, s in pairs:
        a = glob_match(p, s)
        assert a == glob_match_regex(p, s), (p, s)
        answers.append(a)
    assert 6 <= sum(answers) <= 11
    lines = "\n".join(f"{i}. P={p}   S={s}" for i, (p, s) in enumerate(pairs, 1))
    prompt = (
        "Decide, for each numbered pair, whether the whole string S matches the glob pattern P. "
        "Matching is case-sensitive and must cover the entire string. Pattern syntax: "
        "'*' matches any sequence of characters (including none); '?' matches exactly one "
        "character; '[...]' matches exactly one character from the set listed inside (a range "
        "like a-c means a, b, c); '[!...]' matches exactly one character NOT in the set; inside "
        "brackets a '-' that is first (right after '[' or '[!') or last (right before ']') is a "
        "literal '-'; the first ']' after the opening bracket closes the set; a backslash makes "
        "the next character literal (so \\* is a star, \\[ is a bracket, \\\\ is one backslash). "
        "Every character in P and S is shown exactly as it is, with no extra quoting and no "
        "surrounding spaces.\n"
        + lines + "\n"
        f"Return answer as a JSON array of {len(pairs)} booleans (true or false), one per pair in order."
    )
    return {
        "id": "algorithms-03",
        "category": CATEGORY,
        "tier": "medium",
        "prompt": prompt,
        "expectedAnswer": answers,
    }


# --------------------------------------------------------------------------
# 04 (hard)  Shortest path: one free edge, blocked nodes, three-level tie rule
# --------------------------------------------------------------------------
def all_simple_paths(adj, src, dst, blocked):
    res = []

    def dfs(node, path, cost_list):
        if node == dst:
            res.append((list(path), list(cost_list)))
            return
        for nxt, w in adj.get(node, []):
            if nxt in path or nxt in blocked:
                continue
            path.append(nxt)
            cost_list.append(w)
            dfs(nxt, path, cost_list)
            path.pop()
            cost_list.pop()

    dfs(src, [src], [])
    return res


def best_route(adj, src, dst, blocked, coupon=True):
    best = None
    ranked = []
    for path, ws in all_simple_paths(adj, src, dst, blocked):
        cost = sum(ws) - (max(ws) if coupon else 0)
        key = (cost, len(path) - 1, tuple(path))
        ranked.append(key)
        if best is None or key < best:
            best = key
    ranked.sort()
    return best, ranked


def dijkstra_cost(adj, src, dst, blocked):
    """Independent check of the coupon-free cost via Dijkstra."""
    dist = {src: 0}
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1 << 30):
            continue
        for v, w in adj.get(u, []):
            if v in blocked:
                continue
            nd = d + w
            if nd < dist.get(v, 1 << 30):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist.get(dst)


def coupon_cost_layered(adj, src, dst, blocked):
    """Independent check of the coupon cost: Dijkstra over (node, coupon_used)."""
    INF = 1 << 30
    dist = {(src, 0): 0}
    pq = [(0, src, 0)]
    while pq:
        d, u, k = heapq.heappop(pq)
        if d > dist.get((u, k), INF):
            continue
        for v, w in adj.get(u, []):
            if v in blocked:
                continue
            options = [(d + w, k)]
            if k == 0:
                options.append((d, 1))
            for nd, nk in options:
                if nd < dist.get((v, nk), INF):
                    dist[(v, nk)] = nd
                    heapq.heappush(pq, (nd, v, nk))
    return min(dist.get((dst, 0), INF), dist.get((dst, 1), INF))


def task_path():
    names = ["K1", "K2", "K10", "K11", "M3", "M4", "P7", "P12", "S5", "S50"]
    for seed in range(20000):
        rng = random.Random(11300 + seed)
        src, dst = "K1", "P12"
        blocked = {"M4"}
        edges = {}
        for a in names:
            for b in names:
                if a == b or b == src or a == dst:
                    continue
                if rng.random() < 0.3:
                    edges[(a, b)] = rng.randrange(1, 4)
        if not (26 <= len(edges) <= 34):
            continue
        adj = {}
        for (a, b), w in sorted(edges.items()):
            adj.setdefault(a, []).append((b, w))
        best, ranked = best_route(adj, src, dst, blocked, True)
        if best is None:
            continue
        cost = best[0]
        assert cost == coupon_cost_layered(adj, src, dst, blocked)
        no_coupon, _ = best_route(adj, src, dst, blocked, False)
        assert no_coupon[0] == dijkstra_cost(adj, src, dst, blocked)
        optimal = [r for r in ranked if r[0] == cost]
        min_edges = best[1]
        tied_edges = [r for r in optimal if r[1] == min_edges]
        if len(optimal) < 3 or len(tied_edges) < 2:
            continue
        if not any(r[1] != min_edges for r in optimal):
            continue
        # coupon must change the winning route
        if list(no_coupon[2]) == list(best[2]):
            continue
        # the blocked node must matter: ignoring the block changes the answer
        free_best, _ = best_route(adj, src, dst, set(), True)
        if free_best == best:
            continue
        shown = sorted(edges.items())
        rng.shuffle(shown)
        lines = "\n".join(f"{a}>{b}:{w}" for (a, b), w in shown)
        prompt = (
            "A directed road network has these one-way roads, each written FROM>TO:COST "
            "(all costs are positive integers):\n"
            + lines + "\n"
            f"Travel from {src} to {dst}. Rules: the node M4 is closed, so no route may enter "
            "M4 (it is not the start or destination). A route must not visit any node twice. "
            "You hold ONE coupon: you may make any single road on your route cost 0 "
            "(using it is optional, and you should apply it to whichever road lowers the total most; "
            "the cost of a route is the sum of its road costs minus the cost of that one road).\n"
            "Choose the route by these rules in order: (1) smallest cost after the best use of "
            "the coupon; (2) among those, the fewest roads; (3) among those, the "
            "lexicographically smallest list of node names, comparing the lists node by node "
            "from the start and comparing each pair of names as plain text character by "
            "character (so 'K10' < 'K2' and 'M3' < 'P12').\n"
            'Return answer as {"cost": <integer>, "path": [<node names from the start to the destination inclusive>]}.'
        )
        return {
            "id": "algorithms-04",
            "category": CATEGORY,
            "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {"cost": cost, "path": list(best[2])},
        }
    raise RuntimeError("path: no instance")


# --------------------------------------------------------------------------
# 05 (hard)  0/1 knapsack with conflicts, a dependency and a 3-level tie rule
# --------------------------------------------------------------------------
def knapsack_all(items, cap, excl, requires):
    """Returns list of (value, -count? , subset) for feasible subsets."""
    n = len(items)
    feas = []
    for mask in range(1 << n):
        chosen = [i + 1 for i in range(n) if mask >> i & 1]
        cs = set(chosen)
        w = sum(items[i - 1][0] for i in chosen)
        if w > cap:
            continue
        if any(a in cs and b in cs for a, b in excl):
            continue
        if any(a in cs and b not in cs for a, b in requires):
            continue
        v = sum(items[i - 1][1] for i in chosen)
        feas.append((v, w, chosen))
    return feas


def knapsack_dp_value(items, cap, excl, requires):
    """Independent value check by recursive search with pruning (no bitmask)."""
    n = len(items)
    best = [0]

    def rec(i, chosen, w, v):
        if i > n:
            if any(a in chosen and b in chosen for a, b in excl):
                return
            if any(a in chosen and b not in chosen for a, b in requires):
                return
            best[0] = max(best[0], v)
            return
        rec(i + 1, chosen, w, v)
        if w + items[i - 1][0] <= cap:
            chosen.add(i)
            rec(i + 1, chosen, w + items[i - 1][0], v + items[i - 1][1])
            chosen.discard(i)

    rec(1, set(), 0, 0)
    return best[0]


def task_knapsack():
    for seed in range(20000):
        rng = random.Random(13400 + seed)
        n = 12
        items = [(rng.randrange(3, 12), rng.randrange(4, 20)) for _ in range(n)]  # (weight, value)
        cap = rng.randrange(26, 34)
        ids = list(range(1, n + 1))
        rng.shuffle(ids)
        excl = [tuple(sorted((ids[0], ids[1]))), tuple(sorted((ids[2], ids[3]))),
                tuple(sorted((ids[4], ids[5])))]
        requires = [(ids[6], ids[7])]  # ids[6] may only be taken together with ids[7]
        feas = knapsack_all(items, cap, excl, requires)
        best_v = max(v for v, _, _ in feas)
        assert best_v == knapsack_dp_value(items, cap, excl, requires)
        opt = [(len(c), c, w) for v, w, c in feas if v == best_v]
        if len(opt) < 3:
            continue
        sizes = {k for k, _, _ in opt}
        if len(sizes) < 2:
            continue
        kmin = min(sizes)
        at_min = [c for k, c, _ in opt if k == kmin]
        if len(at_min) < 2:
            continue
        winner = min(at_min)  # list comparison: numeric, element by element
        # unconstrained optimum must differ (constraints matter)
        free = knapsack_all(items, cap, [], [])
        fbest = max(v for v, _, _ in free)
        if fbest == best_v:
            continue
        w_total = sum(items[i - 1][0] for i in winner)
        lines = "\n".join(f"{i}: weight {items[i - 1][0]}, value {items[i - 1][1]}" for i in range(1, n + 1))
        ex = "; ".join(f"{a} and {b}" for a, b in excl)
        prompt = (
            f"Choose a subset of the 12 numbered items below with total weight at most {cap}.\n"
            + lines + "\n"
            f"Conflicts: these pairs can never both be chosen: {ex}. "
            f"Dependency: item {requires[0][0]} may be chosen only if item {requires[0][1]} is also chosen "
            f"(item {requires[0][1]} may be chosen without item {requires[0][0]}).\n"
            "Pick the subset with the greatest total value. If several subsets tie on value, pick "
            "the one with the fewest items. If still tied, pick the one whose ascending-sorted list "
            "of item numbers is smallest when compared numerically, element by element from the "
            "first element (so [2,9,11] is smaller than [3,4,5], and [2,9,12] is smaller than [2,10,11]).\n"
            'Return answer as {"items": [<chosen item numbers in ascending order>], "value": <total value>, "weight": <total weight>}.'
        )
        return {
            "id": "algorithms-05",
            "category": CATEGORY,
            "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {"items": winner, "value": best_v, "weight": w_total},
        }
    raise RuntimeError("knapsack: no instance")


# --------------------------------------------------------------------------
# 06 (hard)  Lexicographically smallest LCS and the number of distinct LCSs
# --------------------------------------------------------------------------
def lcs_all(s, t):
    n, m = len(s), len(t)
    L = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if s[i - 1] == t[j - 1]:
                L[i][j] = L[i - 1][j - 1] + 1
            else:
                L[i][j] = max(L[i - 1][j], L[i][j - 1])
    memo = {}

    def go(i, j):
        if (i, j) in memo:
            return memo[(i, j)]
        if i == 0 or j == 0:
            r = frozenset([""])
        elif s[i - 1] == t[j - 1]:
            r = frozenset(x + s[i - 1] for x in go(i - 1, j - 1))
        else:
            acc = set()
            if L[i - 1][j] == L[i][j]:
                acc |= go(i - 1, j)
            if L[i][j - 1] == L[i][j]:
                acc |= go(i, j - 1)
            r = frozenset(acc)
        memo[(i, j)] = r
        return r

    return L[n][m], go(n, m)


def subsequences(s):
    out = set()
    n = len(s)
    for mask in range(1 << n):
        out.add("".join(s[i] for i in range(n) if mask >> i & 1))
    return out


def task_lcs():
    for seed in range(20000):
        rng = random.Random(15500 + seed)
        s = "".join(rng.choice("abcd") for _ in range(14))
        t = "".join(rng.choice("abcd") for _ in range(13))
        length, all_set = lcs_all(s, t)
        if not (7 <= length <= 10):
            continue
        if not (4 <= len(all_set) <= 9):
            continue
        # independent brute-force check
        common = subsequences(s) & subsequences(t)
        mx = max(len(x) for x in common)
        brute = {x for x in common if len(x) == mx}
        assert mx == length and brute == set(all_set)
        smallest = min(all_set)
        # tempting wrong answers: a plain DP backtrack preferring one direction
        if len({x for x in all_set}) < 4:
            continue
        prompt = (
            "A common subsequence of two strings is a string that can be obtained from each of them by "
            "deleting zero or more characters without reordering the rest.\n"
            f"A = {s}\n"
            f"B = {t}\n"
            "Consider all common subsequences of A and B that have the maximum possible length L. "
            "Among those strings (count each distinct string once, even if it can be formed in several ways), "
            "find the one that is smallest in dictionary order (alphabetical, letters a < b < c < d), "
            "and also count how many distinct such strings exist.\n"
            'Return answer as {"length": <L>, "lcs": "<the dictionary-smallest one>", "distinct_count": <how many distinct strings of length L are common subsequences>}.'
        )
        return {
            "id": "algorithms-06",
            "category": CATEGORY,
            "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {"length": length, "lcs": smallest, "distinct_count": len(all_set)},
        }
    raise RuntimeError("lcs: no instance")


# --------------------------------------------------------------------------
# 07 (hard)  Kruskal minimum spanning forest with edge-order ties, union-find
# --------------------------------------------------------------------------
class DSU:
    def __init__(self, n):
        self.p = list(range(n + 1))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.p[rb] = ra
        return True


def kruskal(n, edges, banned, tie="listing"):
    """edges: list of (label_num, u, v, w). Returns (chosen label nums, total, components)."""
    usable = [e for e in edges if e[0] not in banned]
    if tie == "listing":
        usable.sort(key=lambda e: (e[3], e[0]))
    else:
        usable.sort(key=lambda e: (e[3], -e[0]))
    d = DSU(n)
    chosen = []
    total = 0
    for num, u, v, w in usable:
        if u == v:
            continue
        if d.union(u, v):
            chosen.append(num)
            total += w
    comps = {}
    for x in range(1, n + 1):
        comps.setdefault(d.find(x), []).append(x)
    components = sorted((sorted(c) for c in comps.values()), key=lambda c: c[0])
    return chosen, total, components


def kruskal_prim_total(n, edges, banned):
    """Independent check of the forest weight via Prim per component."""
    adj = {i: [] for i in range(1, n + 1)}
    for num, u, v, w in edges:
        if num in banned or u == v:
            continue
        adj[u].append((w, v))
        adj[v].append((w, u))
    seen = set()
    total = 0
    for start in range(1, n + 1):
        if start in seen:
            continue
        seen.add(start)
        pq = list(adj[start])
        heapq.heapify(pq)
        while pq:
            w, v = heapq.heappop(pq)
            if v in seen:
                continue
            seen.add(v)
            total += w
            for item in adj[v]:
                if item[1] not in seen:
                    heapq.heappush(pq, item)
    return total


def task_mst():
    n = 12
    for seed in range(20000):
        rng = random.Random(17600 + seed)
        # three groups so the result is a forest; plus a self-loop and parallel edges
        groups = [list(range(1, 6)), list(range(6, 10)), list(range(10, 13))]
        edges = []
        num = 0
        order_pool = []
        for g in groups:
            for i in range(len(g)):
                for j in range(i + 1, len(g)):
                    order_pool.append((g[i], g[j]))
        rng.shuffle(order_pool)
        picked = order_pool[:19]
        picked.append((7, 7))  # self-loop
        picked.append(picked[rng.randrange(0, 5)])  # a parallel edge
        rng.shuffle(picked)
        for u, v in picked:
            num += 1
            a, b = (u, v) if rng.random() < 0.5 else (v, u)
            edges.append((num, a, b, rng.randrange(1, 5)))
        labels = [e[0] for e in edges]
        banned = set(rng.sample(labels, 2))
        chosen, total, comps = kruskal(n, edges, banned, "listing")
        chosen_rev, _, _ = kruskal(n, edges, banned, "reverse")
        if set(chosen) == set(chosen_rev):
            continue  # ties must matter
        if total != kruskal_prim_total(n, edges, banned):
            raise AssertionError("MST weight mismatch")
        if len(comps) < 3 or len(comps) > 5:
            continue
        # banned edges should matter
        c0, t0, _ = kruskal(n, edges, set(), "listing")
        if (c0, t0) == (chosen, total):
            continue
        # skipped-by-cycle edges: need a decent amount
        if len(chosen) < 8:
            continue
        lines = "\n".join(f"e{k}: {u}-{v} w={w}" for k, u, v, w in edges)
        bl = ", ".join(f"e{k}" for k in sorted(banned))
        prompt = (
            f"An undirected weighted graph has vertices 1..{n} and these edges (label: endpoints, weight); "
            "the labels e1, e2, ... define the listing order, with the number after 'e' compared as a number "
            "(e2 is listed before e10). An edge such as 7-7 is a self-loop.\n"
            + lines + "\n"
            f"Edges {bl} are out of service and must be ignored completely. Run Kruskal's algorithm on the "
            "rest: sort by weight ascending, breaking weight ties by listing order (earlier-listed edge "
            "first); go through the sorted edges once, and accept an edge only if its two endpoints are not "
            "already connected through accepted edges (self-loops are never accepted). The graph may be "
            "disconnected, so the result is a spanning forest.\n"
            'Return answer as {"chosen": [<accepted edge labels such as "e3", in the order they were accepted>], '
            '"total": <sum of accepted weights>, "components": [<one ascending list of vertex numbers per '
            "connected component of the final forest, components ordered by their smallest vertex>]}."
        )
        return {
            "id": "algorithms-07",
            "category": CATEGORY,
            "tier": "hard",
            "prompt": prompt,
            "expectedAnswer": {
                "chosen": [f"e{k}" for k in chosen],
                "total": total,
                "components": comps,
            },
        }
    raise RuntimeError("mst: no instance")


# --------------------------------------------------------------------------
def main():
    tasks = [
        task_topo(),
        task_rooms(),
        task_glob(),
        task_path(),
        task_knapsack(),
        task_lcs(),
        task_mst(),
    ]
    for t in tasks:
        assert 300 <= len(t["prompt"]) <= 1800, (t["id"], len(t["prompt"]))
        assert t["tier"] in ("medium", "hard")
        assert t["prompt"].rstrip().endswith(".") or "Return answer as" in t["prompt"]
    assert sum(1 for t in tasks if t["tier"] == "medium") == 3
    assert sum(1 for t in tasks if t["tier"] == "hard") == 4
    with open(os.path.join(OUT_DIR, "algorithms.tasks.json"), "w") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)
        f.write("\n")
    prompts = [{k: v for k, v in t.items() if k != "expectedAnswer"} for t in tasks]
    with open(os.path.join(OUT_DIR, "algorithms.prompts.json"), "w") as f:
        json.dump(prompts, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(tasks)} tasks to {OUT_DIR}")


if __name__ == "__main__":
    main()
