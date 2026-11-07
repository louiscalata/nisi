# Copyright 2026 Louis Calata
# SPDX-License-Identifier: Apache-2.0
# Builds the frozen harder task set. Every expected answer is computed here, not typed.
import json, datetime, base64, hashlib, os
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_EVEN

def lev(a,b):
    d=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        p,d[0]=d[0],i
        for j,cb in enumerate(b,1):
            p,d[j]=d[j],min(d[j]+1,d[j-1]+1,p+(ca!=cb))
    return d[-1]
def merge(iv):
    out=[]
    for s,e in sorted(iv):
        if out and s<=out[-1][1]: out[-1][1]=max(out[-1][1],e)
        else: out.append([s,e])
    return out
def topo(edges,nodes):
    import heapq
    ind={n:0 for n in nodes}; adj={n:[] for n in nodes}
    for a,b in edges: adj[a].append(b); ind[b]+=1
    h=[n for n in nodes if ind[n]==0]; heapq.heapify(h); out=[]
    while h:
        n=heapq.heappop(h); out.append(n)
        for m in adj[n]:
            ind[m]-=1
            if ind[m]==0: heapq.heappush(h,m)
    return out
def bizdays(a,b,hol):
    d=datetime.date.fromisoformat(a); e=datetime.date.fromisoformat(b); n=0
    while d<e:
        d+=datetime.timedelta(days=1)
        if d.weekday()<5 and d.isoformat() not in hol: n+=1
    return n
def rle(s):
    out=[];i=0
    while i<len(s):
        j=i
        while j<len(s) and s[j]==s[i]: j+=1
        out.append(f"{j-i}{s[i]}"); i=j
    return ''.join(out)
def roman(n):
    v=[(1000,'M'),(900,'CM'),(500,'D'),(400,'CD'),(100,'C'),(90,'XC'),(50,'L'),(40,'XL'),(10,'X'),(9,'IX'),(5,'V'),(4,'IV'),(1,'I')]
    s=''
    for k,r in v:
        while n>=k: s+=r; n-=k
    return s
def r2(x): return float(Decimal(str(x)).quantize(Decimal('0.01'),rounding=ROUND_HALF_EVEN))

recs=[{"name":"ivy","dept":"ops","age":31,"score":88},{"name":"abe","dept":"eng","age":45,"score":92},{"name":"kai","dept":"eng","age":31,"score":92},{"name":"bo","dept":"ops","age":27,"score":75},{"name":"cy","dept":"eng","age":27,"score":81},{"name":"dee","dept":"hr","age":31,"score":88}]
sales=[{"region":"north","amount":12.345},{"region":"south","amount":7.125},{"region":"north","amount":3.335},{"region":"east","amount":0.005},{"region":"south","amount":2.5}]
agg={}
for s in sales: agg[s["region"]]=agg.get(s["region"],0)+s["amount"]
edges=[["lint","test"],["build","test"],["fetch","build"],["fetch","lint"],["test","deploy"],["docs","deploy"]]
nodes=sorted({x for e in edges for x in e})
phones=["(415) 555-0132","+44 20 7946 0958","415.555.0199 x12","001 212 555 0100","555-0100"]
def e164(p):
    core=p.split(' x')[0]; digits=''.join(c for c in core if c.isdigit())
    if core.strip().startswith('+'): return '+'+digits
    if digits.startswith('001'): return '+1'+digits[3:]
    if len(digits)==10: return '+1'+digits
    return None
text="The quick brown fox, the lazy dog; THE end. A fox! Then the fox ran."
words=[w.strip('.,;!').lower() for w in text.split()]
from collections import Counter
cnt=Counter(words)
top=sorted(cnt.items(),key=lambda kv:(-kv[1],kv[0]))[:3]

tasks=[
 ("t01-iso-week","Compute the ISO 8601 week number and ISO week-year for each date: 2024-12-30, 2021-01-03, 2026-01-01, 2020-12-31. Return answer as an array of objects with keys \"date\", \"week\" (integer) and \"year\" (integer), in the given order.",
  [{"date":d,"week":datetime.date.fromisoformat(d).isocalendar()[1],"year":datetime.date.fromisoformat(d).isocalendar()[0]} for d in ["2024-12-30","2021-01-03","2026-01-01","2020-12-31"]]),
 ("t02-multikey-sort","Sort these records by dept ascending, then score descending, then age ascending, then name ascending: "+json.dumps(recs)+". Return answer as the array of names in sorted order.",
  [r["name"] for r in sorted(recs,key=lambda r:(r["dept"],-r["score"],r["age"],r["name"]))]),
 ("t03-merge-intervals","Merge overlapping or touching closed intervals [[8,10],[1,3],[2,6],[15,18],[10,12],[17,20],[6,7]] (intervals that share an endpoint merge). Return answer as the sorted array of merged [start, end] pairs.",
  merge([[8,10],[1,3],[2,6],[15,18],[10,12],[17,20],[6,7]])),
 ("t04-topo-sort","Edges mean the first task must run before the second: "+json.dumps(edges)+". Return answer as a topological order of all tasks, always choosing the alphabetically smallest available task next.",
  topo(edges,nodes)),
 ("t05-business-days","Count business days (Monday to Friday) strictly after 2026-12-18 up to and including 2027-01-08, excluding holidays 2026-12-25 and 2027-01-01. Return answer as an integer.",
  bizdays("2026-12-18","2027-01-08",{"2026-12-25","2027-01-01"})),
 ("t06-base64","Base64-encode the UTF-8 string \"Nisi: café ☕\" using standard padding. Return answer as the encoded string.",
  base64.b64encode("Nisi: café ☕".encode()).decode()),
 ("t07-levenshtein","Compute the Levenshtein edit distance (insert, delete, substitute, each cost 1) for each pair: [\"kitten\",\"sitting\"], [\"flaw\",\"lawn\"], [\"intention\",\"execution\"], [\"abc\",\"\"]. Return answer as an array of integers in the given order.",
  [lev(a,b) for a,b in [("kitten","sitting"),("flaw","lawn"),("intention","execution"),("abc","")]]),
 ("t08-rle","Run-length encode \"aaabccddddde\" as count followed by character for every run, including runs of length 1. Return answer as the encoded string.",
  rle("aaabccddddde")),
 ("t09-expression","Evaluate 7 - 3 * (2 + 4) / 6 + 2 ** 3 ** 2 / 64 where ** is exponentiation (right-associative, higher precedence than * and /). Return answer as a number.",
  7-3*(2+4)/6+2**3**2/64),
 ("t10-group-round","Sum amount by region for "+json.dumps(sales)+", then round each sum to 2 decimals using round-half-to-even on the exact decimal value. Return answer as an object mapping region to the rounded sum, with keys in alphabetical order.",
  {k:r2(Decimal(str(sum(Decimal(str(s['amount'])) for s in sales if s['region']==k)))) for k in sorted(agg)}),
 ("t11-e164","Normalize each phone number to E.164, assuming US (+1) when there is no country code and dropping extensions; a number that cannot be normalized becomes null. Numbers: "+json.dumps(phones)+". A leading 001 is the international prefix for +1. Return answer as an array in the given order.",
  [e164(p) for p in phones]),
 ("t12-word-freq","In the text "+json.dumps(text)+", lowercase every word and strip the punctuation characters . , ; ! from word ends. Return answer as an array of the 3 most frequent words as [word, count] pairs, ordered by count descending then word ascending.",
  [[w,c] for w,c in top]),
 ("t13-roman-sum","Convert MCMXCIV and MMXXIV to integers, add them, and return answer as the sum written in Roman numerals.",
  roman(1994+2024)),
 ("t14-fraction","Add 3/8, 5/12 and 7/18 exactly and return answer as an object {\"numerator\": n, \"denominator\": d} in lowest terms.",
  (lambda f: {"numerator":f.numerator,"denominator":f.denominator})(Fraction(3,8)+Fraction(5,12)+Fraction(7,18))),
 ("t15-weekday","For each date give the English weekday name: 1969-07-20, 2000-02-29, 2038-01-19, 1900-03-01. Return answer as an array of strings in the given order.",
  [datetime.date.fromisoformat(d).strftime('%A') for d in ["1969-07-20","2000-02-29","2038-01-19","1900-03-01"]]),
 ("t16-semver-sort","Sort these versions by Semantic Versioning 2.0.0 precedence, lowest first: [\"1.0.0\",\"1.0.0-rc.1\",\"1.0.0-alpha\",\"1.0.0-alpha.1\",\"1.0.0-beta.11\",\"1.0.0-beta.2\",\"1.0.0-alpha.beta\",\"1.0.0-beta\"]. Return answer as the sorted array.",
  ["1.0.0-alpha","1.0.0-alpha.1","1.0.0-alpha.beta","1.0.0-beta","1.0.0-beta.2","1.0.0-beta.11","1.0.0-rc.1","1.0.0"]),
]
data={"datasetId":"nisi-harder-v1","frozenAt":"2026-11-07","tasks":[{"id":i,"prompt":p,"expectedAnswer":a} for i,p,a in tasks]}
b=json.dumps(data,indent=1,ensure_ascii=False).encode()
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'tasks-v1.json'),'wb').write(b); print(hashlib.sha256(b).hexdigest(), len(tasks))
for t in data['tasks']: print(t['id'], json.dumps(t['expectedAnswer'],ensure_ascii=False)[:90])
