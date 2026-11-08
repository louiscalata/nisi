#!/usr/bin/env python3
"""Generator for the nisi-harder-v2 "state-sim" category.

Python 3 standard library only. Deterministic (fixed seeds, seed search loops
with trap-coverage assertions). No network, no input files.

Running it writes, next to this script:
  state-sim.tasks.json    full tasks including expectedAnswer
  state-sim.prompts.json  same tasks with expectedAnswer removed

Every expectedAnswer is computed by the simulators below; none is typed by hand.
"""
import json
import os
import random

CATEGORY = "state-sim"
HERE = os.path.dirname(os.path.abspath(__file__))


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def j(v):
    """Compact JSON for embedding in prompts."""
    return json.dumps(v, separators=(",", ":"))


# --------------------------------------------------------------------------
# 01  LRU cache (medium)
# --------------------------------------------------------------------------
def lru_sim(cap, ops):
    cache = []  # list of [key, value], index 0 = least recently used
    gets = []
    stats = {"evict": 0, "update": 0, "miss": 0, "hit": 0}
    for op in ops:
        if op[0] == "get":
            k = op[1]
            idx = next((i for i, kv in enumerate(cache) if kv[0] == k), None)
            if idx is None:
                gets.append(-1)
                stats["miss"] += 1
            else:
                kv = cache.pop(idx)
                cache.append(kv)
                gets.append(kv[1])
                stats["hit"] += 1
        else:
            _, k, v = op
            idx = next((i for i, kv in enumerate(cache) if kv[0] == k), None)
            if idx is not None:
                cache.pop(idx)
                cache.append([k, v])
                stats["update"] += 1
            else:
                if len(cache) == cap:
                    cache.pop(0)
                    stats["evict"] += 1
                cache.append([k, v])
    return {"gets": gets, "final": [[k, v] for k, v in cache]}, stats


def task_lru():
    cap = 3
    for seed in range(1, 5000):
        rnd = random.Random(1000 + seed)
        ops = []
        for _ in range(22):
            k = rnd.choice("ABCDE")
            if rnd.random() < 0.5:
                ops.append(("put", k, rnd.randint(10, 99)))
            else:
                ops.append(("get", k))
        ans, st = lru_sim(cap, ops)
        if st["evict"] >= 4 and st["update"] >= 2 and st["miss"] >= 3 and st["hit"] >= 4:
            break
    else:
        raise RuntimeError("lru seed search failed")
    text = "; ".join(f"put {o[1]} {o[2]}" if o[0] == "put" else f"get {o[1]}" for o in ops)
    prompt = (
        "A cache holds at most 3 entries (key -> integer value) and starts empty. "
        "It evicts by least-recently-used order. Rules: 'put K V' on a key already present "
        "replaces its value and makes it the most recently used (nothing is evicted). "
        "'put K V' on a new key first evicts the least recently used entry if the cache already holds 3 entries, "
        "then inserts K as the most recently used. "
        "'get K' on a present key returns its value and makes it the most recently used; on an absent key it returns -1 "
        "and changes nothing. Keys are single capital letters and are case sensitive. "
        f"Process these operations in order: {text}. "
        "Collect the return value of every 'get' in order. After the last operation, list the remaining entries from "
        "least recently used to most recently used as [key, value] pairs. "
        'Return answer as {"gets": [int, ...], "final": [[key, value], ...]}.'
    )
    return "medium", prompt, ans


# --------------------------------------------------------------------------
# 02  token bucket rate limiter (medium)
# --------------------------------------------------------------------------
def bucket_sim(cap, period, reqs, keep_remainder=True):
    tokens = cap
    anchor = 0
    out = []
    for t, cost in reqs:
        n = (t - anchor) // period
        tokens = min(cap, tokens + n)
        if tokens == cap or not keep_remainder:
            anchor = t
        else:
            anchor += period * n
        if tokens >= cost:
            tokens -= cost
            out.append("A")
        else:
            out.append("D")
    return out, tokens


def task_bucket():
    cap, period = 6, 4
    for seed in range(1, 5000):
        rnd = random.Random(2000 + seed)
        t = 0
        reqs = []
        for _ in range(20):
            t += rnd.choice([0, 1, 1, 2, 3, 3, 5, 6])
            reqs.append((t, rnd.choice([1, 1, 2, 2, 3, 4])))
        res, tok = bucket_sim(cap, period, reqs)
        alt, _ = bucket_sim(cap, period, reqs, keep_remainder=False)
        if res.count("D") >= 5 and res.count("A") >= 8 and res != alt and reqs[-1][0] >= 25:
            break
    else:
        raise RuntimeError("bucket seed search failed")
    text = ", ".join(f"({t},{c})" for t, c in reqs)
    prompt = (
        "A token-bucket rate limiter has capacity 6 and starts full (6 tokens) with refill anchor 0. "
        "Time is in whole seconds. You are given requests as (time, cost) pairs in non-decreasing time order. "
        "Processing one request at time t, in this exact order: "
        "(1) n = floor((t - anchor) / 4); "
        "(2) tokens = min(6, tokens + n); "
        "(3) if tokens is now exactly 6, set anchor = t, otherwise set anchor = anchor + 4*n (leftover partial time is kept); "
        "(4) if tokens >= cost, the request is allowed (A) and tokens decreases by cost; otherwise it is denied (D) "
        "and tokens is unchanged. The anchor is never changed by step 4. "
        f"Requests: {text}. "
        "Report the A/D outcome of each request in order and the token count after the last request. "
        'Return answer as {"results": ["A" or "D", ...], "tokens": int}.'
    )
    return "medium", prompt, {"results": res, "tokens": tok}


# --------------------------------------------------------------------------
# 03  vending machine with greedy change-making (medium)
# --------------------------------------------------------------------------
DENOMS = [100, 25, 10, 5]


def exact_change_possible(amount, stock):
    """Brute force: can amount be made from the stock at all?"""
    def rec(i, rem):
        if rem == 0:
            return True
        if i == len(DENOMS):
            return False
        d = DENOMS[i]
        for k in range(min(rem // d, stock[d]), -1, -1):
            if rec(i + 1, rem - k * d):
                return True
        return False
    return rec(0, amount)


def vend_sim(items, coins, txs):
    items = {k: dict(v) for k, v in items.items()}
    coins = dict(coins)
    outcomes = []
    stats = {"ok": 0, "soldout": 0, "short": 0, "nochange": 0, "greedy_gap": 0}
    for item, inserted in txs:
        total = sum(inserted)
        if items[item]["stock"] == 0:
            outcomes.append("SOLDOUT")
            stats["soldout"] += 1
            continue
        if total < items[item]["price"]:
            outcomes.append("SHORT")
            stats["short"] += 1
            continue
        trial = dict(coins)
        for c in inserted:
            trial[c] += 1
        rem = total - items[item]["price"]
        change = []
        t2 = dict(trial)
        for d in DENOMS:
            k = min(rem // d, t2[d])
            change += [d] * k
            t2[d] -= k
            rem -= k * d
        if rem != 0:
            outcomes.append("NOCHANGE")
            stats["nochange"] += 1
            if exact_change_possible(total - items[item]["price"], trial):
                stats["greedy_gap"] += 1
            continue
        coins = t2
        items[item]["stock"] -= 1
        outcomes.append("OK:" + ",".join(str(c) for c in change))
        stats["ok"] += 1
    return {"outcomes": outcomes, "coins": {str(d): coins[d] for d in DENOMS}}, stats


def task_vending():
    items = {"A": {"price": 135, "stock": 2}, "B": {"price": 60, "stock": 3}, "C": {"price": 90, "stock": 1}}
    coins = {100: 1, 25: 2, 10: 3, 5: 1}
    for seed in range(1, 20000):
        rnd = random.Random(3000 + seed)
        txs = []
        for _ in range(9):
            item = rnd.choice("ABC")
            n = rnd.randint(1, 4)
            ins = sorted((rnd.choice([100, 100, 25, 25, 10, 5]) for _ in range(n)), reverse=True)
            txs.append((item, ins))
        ans, st = vend_sim(items, coins, txs)
        if st["ok"] >= 3 and st["soldout"] >= 1 and st["short"] >= 1 and st["nochange"] >= 1 and st["greedy_gap"] >= 1:
            break
    else:
        raise RuntimeError("vending seed search failed")
    tx_text = "; ".join(f"{i}:{'+'.join(str(c) for c in ins)}" for i, ins in txs)
    prompt = (
        "A vending machine sells items A (price 135, stock 2), B (price 60, stock 3) and C (price 90, stock 1). "
        "Prices and coins are in cents. The coin box holds denominations 100, 25, 10 and 5 with these counts: "
        "100:1, 25:2, 10:3, 5:1. For each transaction 'Item:coins' a customer inserts those coins and selects the item. "
        "Check in this order: (1) if the item's stock is 0, outcome SOLDOUT; (2) else if the inserted total is below the price, "
        "outcome SHORT; (3) else add the inserted coins to the box, then make change = total - price greedily without backtracking: "
        "for denominations 100, 25, 10, 5 in that order, give as many coins of the denomination as fit in the remaining change "
        "and are available in the box (the box includes the coins just inserted). If the remaining change is not exactly 0 afterwards, "
        "outcome NOCHANGE; otherwise the sale completes and outcome is 'OK:' followed by the change coins in the order given, "
        "comma-separated (nothing after the colon if change is 0). "
        "SOLDOUT, SHORT and NOCHANGE return the inserted coins to the customer, so the box and item stock stay exactly as before that transaction. "
        "A completed sale keeps the inserted coins, removes the change coins from the box and reduces the item stock by 1. "
        f"Transactions in order: {tx_text}. "
        'Return answer as {"outcomes": [string, ...], "coins": {"100": int, "25": int, "10": int, "5": int}} '
        "where coins are the box counts after all transactions."
    )
    return "medium", prompt, ans


# --------------------------------------------------------------------------
# 04  bank ledger with fees, overdraft and freezing (hard)
# --------------------------------------------------------------------------
ACCTS = ["A", "B", "C", "D"]


def bank_sim(init, ops):
    bal = dict(init)
    frozen = {a: False for a in ACCTS}
    rejected = []
    stats = {"reject": 0, "odfee": 0, "freeze": 0, "unfreeze": 0, "month": 0, "limit_reject": 0, "frozen_reject": 0}

    def after_charge(a, before):
        if before >= 0 and bal[a] < 0:
            bal[a] -= 25
            stats["odfee"] += 1
        if bal[a] <= -120 and not frozen[a]:
            frozen[a] = True
            stats["freeze"] += 1

    def credit(a, amt):
        bal[a] += amt
        if frozen[a] and bal[a] >= 0:
            frozen[a] = False
            stats["unfreeze"] += 1

    for i, op in enumerate(ops, 1):
        kind = op[0]
        if kind == "DEP":
            credit(op[1], op[2])
        elif kind in ("WD", "XFER"):
            src = op[1]
            amt = op[3] if kind == "XFER" else op[2]
            cost = amt + (2 if kind == "WD" else 1)
            if frozen[src]:
                rejected.append(i)
                stats["frozen_reject"] += 1
                continue
            if bal[src] - cost < -100:
                rejected.append(i)
                stats["limit_reject"] += 1
                continue
            before = bal[src]
            bal[src] -= cost
            after_charge(src, before)
            if kind == "XFER":
                credit(op[2], amt)
        else:  # MONTH
            stats["month"] += 1
            for a in ACCTS:
                if bal[a] < 500:
                    before = bal[a]
                    bal[a] -= 10
                    after_charge(a, before)
    stats["reject"] = len(rejected)
    return {"balances": dict(bal), "frozen": [a for a in ACCTS if frozen[a]], "rejected": rejected}, stats


def task_bank():
    init = {"A": 300, "B": 40, "C": 650, "D": 90}
    for seed in range(1, 200000):
        rnd = random.Random(4000 + seed)
        ops = []
        for _ in range(18):
            r = rnd.random()
            if r < 0.2:
                ops.append(("DEP", rnd.choice(ACCTS), rnd.choice([20, 35, 50, 80, 120, 200])))
            elif r < 0.5:
                ops.append(("WD", rnd.choice(ACCTS), rnd.choice([20, 30, 45, 60, 90, 150])))
            elif r < 0.9:
                s = rnd.choice(ACCTS)
                d = rnd.choice([a for a in ACCTS if a != s])
                ops.append(("XFER", s, d, rnd.choice([25, 40, 70, 110, 160])))
            else:
                ops.append(("MONTH",))
        ans, st = bank_sim(init, ops)
        if (st["limit_reject"] >= 1 and st["frozen_reject"] >= 1 and st["unfreeze"] >= 1
                and st["odfee"] >= 3 and st["month"] >= 1 and st["freeze"] >= 2):
            break
    else:
        raise RuntimeError("bank seed search failed")
    parts = []
    for i, o in enumerate(ops, 1):
        if o[0] == "DEP":
            parts.append(f"{i}.DEP {o[1]} {o[2]}")
        elif o[0] == "WD":
            parts.append(f"{i}.WD {o[1]} {o[2]}")
        elif o[0] == "XFER":
            parts.append(f"{i}.XFER {o[1]}>{o[2]} {o[3]}")
        else:
            parts.append(f"{i}.MONTH")
    text = "; ".join(parts)
    prompt = (
        "Four bank accounts start with balances A=300, B=40, C=650, D=90 (integer currency units). All start unfrozen. "
        "Operations are numbered and processed in order. "
        "DEP X n adds n to X. "
        "WD X n costs X the amount n plus a flat fee of 2. "
        "XFER X>Y n costs X the amount n plus a flat fee of 1, and adds n to Y (the fee is not credited to anyone). "
        "Outgoing rules: a WD or XFER is rejected, with no effect at all, if its source account is frozen, or if "
        "balance - total cost would be below -100. "
        "MONTH charges each account in the order A,B,C,D a fee of 10 if its balance at that moment is below 500 "
        "(this fee is always charged, even if the balance drops under -100). "
        "Overdraft fee: whenever any charge (WD, XFER cost, or monthly fee) moves an account from balance >= 0 to balance < 0, "
        "an extra fee of 25 is charged to it immediately (once per such crossing; a deposit that does not restore balance >= 0 does not reset anything). "
        "Freeze: after the charge and any overdraft fee, if an account's balance is <= -120 it becomes frozen. "
        "A frozen account is unfrozen as soon as a credit (DEP or incoming XFER) leaves its balance >= 0; "
        "frozen accounts can still receive credits. "
        f"Operations: {text}. "
        'Return answer as {"balances": {"A": int, "B": int, "C": int, "D": int}, "frozen": [letters of frozen accounts in alphabetical order], '
        '"rejected": [operation numbers of rejected operations in ascending order]}.'
    )
    return "hard", prompt, ans


# --------------------------------------------------------------------------
# 05  FIFO/LIFO inventory with partial fills (hard)
# --------------------------------------------------------------------------
def inv_sim(policy, ops):
    lots = {"X": [], "Y": []}  # oldest first, [qty, cost]
    profits = []
    stats = {"partial": 0, "empty": 0, "recall": 0, "multi_lot": 0}
    for op in ops:
        kind = op[0]
        if kind == "BUY":
            _, p, q, c = op
            lots[p].append([q, c])
        elif kind == "RECALL":
            _, p, c = op
            before = len(lots[p])
            lots[p] = [l for l in lots[p] if l[1] != c]
            if len(lots[p]) < before:
                stats["recall"] += 1
        else:
            _, p, q, price = op
            need = q
            cost = 0
            filled = 0
            order = range(len(lots[p])) if policy[p] == "FIFO" else range(len(lots[p]) - 1, -1, -1)
            touched = 0
            for idx in order:
                if need == 0:
                    break
                take = min(need, lots[p][idx][0])
                if take:
                    touched += 1
                lots[p][idx][0] -= take
                cost += take * lots[p][idx][1]
                filled += take
                need -= take
            lots[p] = [l for l in lots[p] if l[0] > 0]
            if filled == 0:
                stats["empty"] += 1
            elif filled < q:
                stats["partial"] += 1
            if touched >= 2:
                stats["multi_lot"] += 1
            profits.append(filled * price - cost)
    return {"profits": profits, "remaining": {p: [list(l) for l in lots[p]] for p in lots}}, stats


def task_inventory():
    policy = {"X": "FIFO", "Y": "LIFO"}
    for seed in range(1, 200000):
        rnd = random.Random(5000 + seed)
        ops = []
        for _ in range(22):
            r = rnd.random()
            p = rnd.choice("XY")
            if r < 0.4:
                ops.append(("BUY", p, rnd.randint(2, 9), rnd.choice([4, 5, 6, 7, 9])))
            elif r < 0.9:
                ops.append(("SELL", p, rnd.randint(2, 14), rnd.choice([6, 8, 10, 12])))
            else:
                ops.append(("RECALL", p, rnd.choice([4, 5, 6, 7, 9])))
        ans, st = inv_sim(policy, ops)
        nsell = sum(1 for o in ops if o[0] == "SELL")
        if st["partial"] >= 2 and st["empty"] >= 1 and st["recall"] >= 1 and st["multi_lot"] >= 4 and nsell >= 9:
            break
    else:
        raise RuntimeError("inventory seed search failed")
    parts = []
    for o in ops:
        if o[0] == "BUY":
            parts.append(f"BUY {o[1]} {o[2]}@{o[3]}")
        elif o[0] == "SELL":
            parts.append(f"SELL {o[1]} {o[2]}@{o[3]}")
        else:
            parts.append(f"RECALL {o[1]} {o[2]}")
    text = "; ".join(parts)
    prompt = (
        "A shop tracks two products, X and Y, as lots [quantity, unit cost], both starting with no lots. "
        "'BUY P q@c' appends a new lot [q, c] for product P as its newest lot (lots with equal cost are never merged). "
        "'SELL P q@s' sells up to q units of P at unit price s. Product X is sold FIFO: units come from the oldest lot first. "
        "Product Y is sold LIFO: units come from the newest lot first. A sale takes from a lot as many units as are still needed "
        "and available, then moves on to the next lot in that order. If total stock is below q, the sale is a partial fill: "
        "it sells only what exists (possibly 0 units) and the unfilled remainder is lost, not backordered. "
        "A sale's profit = (units actually sold * s) - (sum of the unit costs of the units actually taken). "
        "Lots that reach quantity 0 are removed; a partly used lot keeps its place and cost. "
        "'RECALL P c' removes every lot of P whose unit cost equals c, whatever its quantity (no profit entry). "
        f"Operations in order: {text}. "
        "Report the profit of every SELL in order, and the remaining lots of each product listed from the oldest lot to the newest lot. "
        'Return answer as {"profits": [int, ...], "remaining": {"X": [[qty, cost], ...], "Y": [[qty, cost], ...]}}.'
    )
    return "hard", prompt, ans


# --------------------------------------------------------------------------
# 06  LFU cache with LRU tie-break (hard)
# --------------------------------------------------------------------------
def lfu_sim(cap, ops):
    entries = {}  # key -> [value, freq, last_access_tick]
    tick = 0
    gets = []
    evicted = []
    stats = {"evict": 0, "tie_evict": 0, "reinsert": 0, "miss": 0, "update": 0}
    ever_evicted = set()
    for op in ops:
        tick += 1
        if op[0] == "get":
            k = op[1]
            if k in entries:
                entries[k][1] += 1
                entries[k][2] = tick
                gets.append(entries[k][0])
            else:
                gets.append(-1)
                stats["miss"] += 1
        else:
            _, k, v = op
            if k in entries:
                entries[k][0] = v
                entries[k][1] += 1
                entries[k][2] = tick
                stats["update"] += 1
            else:
                if len(entries) == cap:
                    mf = min(e[1] for e in entries.values())
                    cands = [kk for kk, e in entries.items() if e[1] == mf]
                    if len(cands) > 1:
                        stats["tie_evict"] += 1
                    victim = min(cands, key=lambda kk: entries[kk][2])
                    del entries[victim]
                    evicted.append(victim)
                    ever_evicted.add(victim)
                    stats["evict"] += 1
                if k in ever_evicted:
                    stats["reinsert"] += 1
                entries[k] = [v, 1, tick]
    final = [[k, entries[k][0], entries[k][1]] for k in sorted(entries)]
    return {"gets": gets, "evicted": evicted, "final": final}, stats


def task_lfu():
    cap = 3
    for seed in range(1, 100000):
        rnd = random.Random(6000 + seed)
        ops = []
        for _ in range(26):
            k = rnd.choice("ABCDEF")
            if rnd.random() < 0.5:
                ops.append(("put", k, rnd.randint(10, 99)))
            else:
                ops.append(("get", k))
        ans, st = lfu_sim(cap, ops)
        if (st["evict"] >= 5 and st["tie_evict"] >= 3 and st["reinsert"] >= 2
                and st["update"] >= 2 and st["miss"] >= 3):
            break
    else:
        raise RuntimeError("lfu seed search failed")
    text = "; ".join(f"put {o[1]} {o[2]}" if o[0] == "put" else f"get {o[1]}" for o in ops)
    prompt = (
        "An LFU cache holds at most 3 entries (key -> integer value) and starts empty. Each entry has a use count. "
        "'put K V' on a present key replaces the value and increases its use count by 1. "
        "'put K V' on a new key: if the cache already holds 3 entries, first evict the entry with the lowest use count; "
        "if several entries tie for the lowest count, evict the one whose most recent access (a get hit or a put on it, "
        "counting its insertion) is oldest. Then insert K with use count 1 (an evicted key that returns starts again at 1). "
        "'get K' on a present key returns its value and increases its use count by 1; on an absent key it returns -1 and changes nothing. "
        "Keys are single capital letters. "
        f"Operations in order: {text}. "
        "Report the return value of every get in order, the evicted keys in eviction order, and the final entries "
        "as [key, value, use count] sorted alphabetically by key. "
        'Return answer as {"gets": [int, ...], "evicted": [key, ...], "final": [[key, value, count], ...]}.'
    )
    return "hard", prompt, ans


# --------------------------------------------------------------------------
# 07  elevator schedule with tie-break rules (hard)
# --------------------------------------------------------------------------
def elevator_sim(cap, passengers):
    """passengers: list of (id, reqtime, origin, dest)."""
    floor, d, t = 1, 1, 0
    waiting = []
    onboard = []
    drops = []
    delivered = 0
    stats = {"reverse": 0, "full_wait": 0, "idle": 0}
    pend = sorted(passengers, key=lambda p: (p[1], p[0]))
    while delivered < len(passengers):
        for p in pend:
            if p[1] == t:
                waiting.append(p)
        # exits (ascending id)
        out = sorted([p for p in onboard if p[3] == floor], key=lambda p: p[0])
        for p in out:
            onboard.remove(p)
            drops.append([p[0], t])
            delivered += 1
        if delivered == len(passengers):
            break
        # boarding (ascending id)
        here = sorted([p for p in waiting if p[2] == floor], key=lambda p: p[0])
        for p in here:
            if len(onboard) < cap:
                onboard.append(p)
                waiting.remove(p)
            else:
                stats["full_wait"] += 1
        # move
        targets = {p[3] for p in onboard} | {p[2] for p in waiting}
        targets.discard(floor)
        if targets:
            if any((f - floor) * d > 0 for f in targets):
                floor += d
            else:
                d = -d
                stats["reverse"] += 1
                floor += d
        else:
            stats["idle"] += 1
        t += 1
    return {"drops": drops, "finalFloor": floor}, stats


def task_elevator():
    cap = 2
    for seed in range(1, 200000):
        rnd = random.Random(7000 + seed)
        ps = []
        for i in range(1, 10):
            o = rnd.randint(1, 9)
            dd = rnd.choice([f for f in range(1, 10) if f != o])
            ps.append((i, rnd.randint(0, 14), o, dd))
        ans, st = elevator_sim(cap, ps)
        if st["reverse"] >= 3 and st["full_wait"] >= 2 and st["idle"] >= 1 and ans["drops"][-1][1] >= 28:
            break
    else:
        raise RuntimeError("elevator seed search failed")
    text = ", ".join(f"{p[0]}:{p[1]}:{p[2]}>{p[3]}" for p in ps)
    prompt = (
        "A single elevator serves floors 1 to 9 and holds at most 2 passengers. At time 0 it is at floor 1, empty, with direction UP. "
        "Passengers are given as id:requestTime:origin>destination. Time advances in whole steps; moving one floor takes exactly one step. "
        "At each time t, do the following in this order: "
        "(1) every passenger whose requestTime equals t starts waiting at their origin floor; "
        "(2) every passenger on board whose destination is the current floor exits, and is recorded as dropped at time t (several exits at the same time are listed by ascending id); "
        "(3) waiting passengers at the current floor board in ascending id order, while fewer than 2 are on board (the rest keep waiting; boarding ignores direction); "
        "(4) choose movement: targets are the destinations of passengers on board plus the origins of waiting passengers, ignoring any target equal to the current floor. "
        "If there are no targets, the elevator stays and keeps its direction. "
        "If some target lies strictly ahead in the current direction, move one floor in that direction. "
        "Otherwise reverse direction and move one floor in the new direction. Then t increases by 1. "
        "The simulation stops during the step in which the last passenger exits (nothing further happens after step 2 of that step). "
        f"Passengers: {text}. "
        'Return answer as {"drops": [[id, time], ...] in the order dropped, "finalFloor": int} where finalFloor is the floor at the end.'
    )
    return "hard", prompt, ans


# --------------------------------------------------------------------------
def build():
    builders = [
        task_lru, task_bucket, task_vending,      # medium
        task_bank, task_inventory, task_lfu, task_elevator,  # hard
    ]
    tasks = []
    for n, b in enumerate(builders, 1):
        tier, prompt, ans = b()
        assert 300 <= len(prompt) <= 1800, (n, len(prompt))
        assert prompt.rstrip().endswith("."), n
        assert "Return answer as" in prompt, n
        tasks.append({
            "id": f"{CATEGORY}-{n:02d}",
            "category": CATEGORY,
            "tier": tier,
            "prompt": prompt,
            "expectedAnswer": ans,
        })
    assert sum(1 for t in tasks if t["tier"] == "medium") == 3
    assert sum(1 for t in tasks if t["tier"] == "hard") == 4
    return tasks


def main():
    tasks = build()
    with open(os.path.join(HERE, "state-sim.tasks.json"), "w") as f:
        json.dump(tasks, f, indent=2)
        f.write("\n")
    prompts = [{k: v for k, v in t.items() if k != "expectedAnswer"} for t in tasks]
    with open(os.path.join(HERE, "state-sim.prompts.json"), "w") as f:
        json.dump(prompts, f, indent=2)
        f.write("\n")
    print(f"wrote {len(tasks)} tasks")


if __name__ == "__main__":
    main()
