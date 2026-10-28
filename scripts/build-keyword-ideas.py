#!/usr/bin/env python3
"""
Turns the uploaded keyword research CSVs into a cleaned dataset and a content roadmap.

Input : research/keyword-magic-800rows.csv, research/keyword-magic-1000rows.csv
Output: research/keyword-ideas.json   (cleaned, de-duplicated, clustered)
        docs/content-roadmap.md       (human-readable priorities)

Rules: values come straight from the CSVs. Missing or truncated values stay null and are
shown as "n/a". Nothing is estimated or invented. Run: python3 scripts/build-keyword-ideas.py
"""
import csv, json, os, re, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ['research/keyword-magic-800rows.csv', 'research/keyword-magic-1000rows.csv']
INTENT = {'I': 'Informational', 'C': 'Commercial', 'N': 'Navigational', 'T': 'Transactional'}

def to_int(s):
    s = (s or '').strip().replace(',', '')
    return int(s) if s.isdigit() else None

def intent(s):
    parts = [p.strip() for p in (s or '').split(',') if p.strip()]
    return sorted({INTENT.get(p, p) for p in parts}) or None

rows, seen, stats = {}, collections.Counter(), {'files': {}}
for rel in FILES:
    n = 0
    for r in csv.DictReader(open(os.path.join(ROOT, rel), encoding='utf-8-sig')):
        n += 1
        k = r['Keyword'].strip().lower()
        seen[k] += 1
        serp = (r.get('SERP Features') or '').strip()
        rec = dict(keyword=k, volume=to_int(r['Volume']), difficulty=to_int(r['Keyword Difficulty']),
                   cpc=float(r['CPC (USD)']) if re.fullmatch(r'\d+(\.\d+)?', (r.get('CPC (USD)') or '').strip()) else None,
                   intent=intent(r['Intent']), serpTruncated=bool(re.fullmatch(r'\+\d+', serp)),
                   source=[os.path.basename(rel)])
        if k in rows:
            rows[k]['source'].append(os.path.basename(rel))
            for fld in ('volume', 'difficulty', 'cpc', 'intent'):   # fill gaps only; never overwrite
                if rows[k][fld] is None and rec[fld] is not None: rows[k][fld] = rec[fld]
        else:
            rows[k] = rec
    stats['files'][os.path.basename(rel)] = n

TOPICAL = re.compile(r'slow[- ]?cook|crock|slow cooker|\brecipes?\b|\bsoups?\b|\bstews?\b|casserole|chili|roast|dinner|breakfast|meals?\b')
FOOD = re.compile(r'chicken|beef|pork|lamb|turkey|ham|bean|vegetable|potato|pasta|rice|dessert|cake|meatball|curry|sauce|egg|oat|ribs?\b|sausage|lasagn|taco|soup|stew')
EXCLUDE = re.compile(r'rice cooker|pressure cooker|gas cooker|\baga\b|crawfish|cooker books|cooker hood|trunk or treat|induction|air fryer|instant pot|ninja foodi|hob\b')
def relevant(k):
    if EXCLUDE.search(k): return False
    return bool(TOPICAL.search(k)) and bool(FOOD.search(k) or re.search(r'slow[- ]?cook|crock', k))

CLUSTERS = [
    ('Pulled pork', r'pulled pork'), ('Pork loin, chops & tenderloin', r'pork (loin|chop|tenderloin|fillet|roast|steak|shoulder)|pork fillet'),
    ('Ribs', r'\bribs?\b'), ('Pot roast & beef roasts', r'pot roast|roast beef|beef roast|chuck roast|brisket'),
    ('Beef stew', r'beef stew|\bstews?\b'), ('Chili', r'chili'), ('Chicken thighs', r'chicken thighs?'),
    ('Chicken breast', r'chicken breasts?'), ('Whole chicken', r'whole chicken'),
    ('Chicken (other)', r'chicken'), ('Bean soups & beans', r'\bbeans?\b'), ('Soups', r'\bsoups?\b'),
    ('Breakfast & eggs', r'breakfast|\begg|casserole|oatmeal'), ('Desserts', r'dessert|cake|cobbler|pudding|cookie|brownie'),
    ('Vegetarian', r'vegetarian|vegan|veggie|vegetable'), ('Easy dinners & meals', r'dinner|meals?\b|easy|family'),
    ('Beef (other)', r'beef|meatball'), ('Pork (other)', r'pork|ham\b'), ('General slow cooker', r'slow cook|crock'),
]
def cluster(k):
    for name, pat in CLUSTERS:
        if re.search(pat, k): return name
    return 'Other'

kept = []
dropped = []
for r in rows.values():
    if relevant(r['keyword']):
        r['cluster'] = cluster(r['keyword']); kept.append(r)
    else:
        dropped.append(r['keyword'])
kept.sort(key=lambda r: (-(r['volume'] or 0), r['difficulty'] if r['difficulty'] is not None else 999))

json.dump({'generatedFrom': FILES, 'counts': {'uniqueKeywords': len(rows), 'kept': len(kept), 'droppedOffTopic': len(dropped)},
           'keywords': kept}, open(os.path.join(ROOT, 'research/keyword-ideas.json'), 'w'), indent=1)

fmt = lambda v: 'n/a' if v is None else f'{v:,}'
def line(r): return f"| {r['keyword']} | {fmt(r['volume'])} | {fmt(r['difficulty'])} | {', '.join(r['intent'] or []) or 'n/a'} |"

STARTERS = [
    ('Slow Cooker Pulled Pork', r'pulled pork'), ('Slow Cooker Lemon Chicken', r'lemon chicken'),
    ('Slow Cooker Chicken and Gravy', r'chicken (and|&) gravy|chicken gravy'), ('Slow Cooker Beef Stew', r'beef stew'),
    ('Slow Cooker Bean Soup', r'bean soup'), ('Slow Cooker Breakfast Casserole', r'breakfast casserole|egg casserole'),
    ('Easy Slow Cooker Chicken Dinner', r'chicken dinner'), ('Slow Cooker Vegetable Soup', r'vegetable soup'),
]
out = ['# CrockBites content roadmap (from keyword research)', '',
       'Generated by `npm run keywords` from the two uploaded CSV exports. Numbers are copied from the files as-is. '
       '"n/a" means the CSV had no value. The export does not state which country or database the volumes come from, '
       'so confirm that in your keyword tool before relying on them. Volume and difficulty are planning hints, not predictions.', '',
       '## Data notes', '']
out += [f"- `{f}`: {n} rows" for f, n in stats['files'].items()]
overlap = sum(1 for k, c in seen.items() if c > 1)
out += [f'- {overlap} keywords appear in both files (values matched; merged once). {len(rows)} unique keywords in total.',
        f'- {len(kept)} kept as topically relevant; {len(dropped)} dropped as off-topic (for example Bible verses, product model numbers, Halloween trunk-or-treat).',
        f"- {sum(1 for r in kept if r['serpTruncated'])} kept rows have a truncated SERP-features cell (shown as `+N` in the 800-row file); that column is not used.",
        f"- {sum(1 for r in kept if r['difficulty'] is None)} kept rows have no difficulty value; {sum(1 for r in kept if r['volume'] is None)} have no volume.",
        '- Columns found: Keyword, Intent, Volume, Keyword Difficulty, CPC (USD), SERP Features. The 800-row file writes volume with thousands separators and abbreviates intent (I, C).', '',
        '## Starter recipes: best matching keywords in the CSVs', '',
        'Where the CSVs contain no matching keyword, none is invented. Do your own research for those topics.', '']
for title, pat in STARTERS:
    m = [r for r in kept if re.search(pat, r['keyword'])][:4]
    out.append(f'### {title}')
    if not m: out += ['', 'No matching keyword in the provided CSVs.', '']; continue
    out += ['', '| Keyword | Volume | Difficulty | Intent |', '|---|---|---|---|'] + [line(r) for r in m] + ['']

starter_pat = re.compile('|'.join(p for _, p in STARTERS))
fresh = [r for r in kept if not starter_pat.search(r['keyword']) and r['volume'] and r['difficulty'] is not None]
easy = [r for r in fresh if r['difficulty'] <= 30 and r['volume'] >= 1000]
out += ['## Next recipes to write: lower difficulty (difficulty 30 or below, volume 1,000 or more)', '',
        '| Keyword | Volume | Difficulty | Intent | Cluster |', '|---|---|---|---|---|']
seen_c = collections.Counter(); picked = []
for r in sorted(easy, key=lambda r: -r['volume']):
    if seen_c[r['cluster']] < 3: picked.append(r); seen_c[r['cluster']] += 1
out += [line(r) + f" {r['cluster']} |" for r in picked[:30]]
hard = [r for r in fresh if r['difficulty'] >= 50 and r['volume'] >= 10000][:15]
out += ['', '## Bigger, harder topics for later (difficulty 50 or above, volume 10,000 or more)', '',
        '| Keyword | Volume | Difficulty | Intent |', '|---|---|---|---|'] + [line(r) for r in hard]
tot = collections.defaultdict(int)
for r in kept: tot[r['cluster']] += r['volume'] or 0
out += ['', '## Topic clusters by combined listed volume', '',
        'Combined volume double-counts overlapping searches, so treat it as a rough size comparison only.', '',
        '| Cluster | Keywords | Combined volume |', '|---|---|---|']
cnt = collections.Counter(r['cluster'] for r in kept)
out += [f'| {c} | {cnt[c]} | {v:,} |' for c, v in sorted(tot.items(), key=lambda x: -x[1])]
out += ['', '## Notes', '',
        '- Pair each new post with one primary keyword and a few close variants. Write for the reader first; do not stuff keywords.',
        '- Several head terms are the Crock-Pot trademark. Describing a slow cooker generically ("slow cooker") is safer for brand copy than relying on the trademark.', '']
open(os.path.join(ROOT, 'docs/content-roadmap.md'), 'w').write('\n'.join(out))
print(len(rows), 'unique;', len(kept), 'kept;', len(dropped), 'dropped')
print('sample dropped:', dropped[:30])
