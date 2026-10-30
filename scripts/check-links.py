#!/usr/bin/env python3
"""Crawl dist/ and verify every internal href/src/srcset resolves to a built file or valid SSR route, plus basic SEO sanity checks."""
import os, re, sys, json, html
from urllib.parse import urlparse, unquote
DIST_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist')
ROOT = os.path.join(DIST_BASE, 'client') if os.path.isdir(os.path.join(DIST_BASE, 'client')) else DIST_BASE

SSR_ROUTE_PREFIXES = (
    '/login/',
    '/register/',
    '/logout/',
    '/account/',
    '/admin/',
    '/api/',
)

pages = []
for d, _, fs in os.walk(ROOT):
    for f in fs:
        if f.endswith('.html'): pages.append(os.path.join(d, f))

def parse_srcset_urls(srcset_val):
    # Split srcset candidates separated by comma + whitespace before the next URL,
    # without splitting commas inside URL transformation segments (e.g. Cloudinary f_auto,q_auto,w_480).
    urls = []
    for candidate in re.split(r',\s+(?=(?:https?:|/|data:))', srcset_val.strip()):
        parts = candidate.strip().split()
        if parts:
            urls.append(parts[0])
    return urls

def exists(path):
    clean = unquote(path)
    if clean in ('/login', '/register', '/logout', '/account', '/admin') or clean.startswith(SSR_ROUTE_PREFIXES):
        return True
    p = os.path.join(ROOT, clean.lstrip('/'))
    return os.path.isfile(p) or os.path.isfile(os.path.join(p, 'index.html'))

bad, ids_missing, issues = [], [], []
for pg in pages:
    s = open(pg, encoding='utf-8').read()
    rel = os.path.relpath(pg, ROOT)
    own_ids = set(re.findall(r'\sid="([^"]+)"', s))
    refs = re.findall(r'(?:href|src)="([^"]+)"', s)
    for m in re.findall(r'srcset="([^"]+)"', s):
        refs += parse_srcset_urls(m)
    for r in refs:
        r = html.unescape(r)
        if r.startswith(('mailto:', 'tel:', 'http://', 'https://', 'data:', 'javascript:')) or r == '': continue
        u = urlparse(r)
        if r.startswith('#'):
            if r[1:] not in own_ids: ids_missing.append((rel, r))
            continue
        if not exists(u.path): bad.append((rel, r))
        elif u.fragment and u.path.endswith('/'):
            tgt = os.path.join(ROOT, u.path.lstrip('/'), 'index.html')
            if os.path.isfile(tgt) and f'id="{u.fragment}"' not in open(tgt, encoding='utf-8').read(): ids_missing.append((rel, r))
    # SEO sanity
    if rel != '404.html':
        t = re.findall(r'<title>(.*?)</title>', s)
        if len(t) != 1: issues.append((rel, 'title count', len(t)))
        if not re.search(r'<meta name="description" content="[^"]+"', s): issues.append((rel, 'no description'))
        if not re.search(r'<link rel="canonical" href="https://crockbites\.com/[^"]*"', s): issues.append((rel, 'no canonical'))
        if len(re.findall(r'<h1[ >]', s)) != 1: issues.append((rel, 'h1 count', len(re.findall(r'<h1[ >]', s))))
    for blk in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try: json.loads(blk)
        except Exception as e: issues.append((rel, 'bad json-ld', str(e)))
    for img in re.findall(r'<img [^>]*>', s):
        if not re.search(r'\salt(=|\s|>)', img): issues.append((rel, 'img without alt', img[:80]))
        if ' width=' not in img or ' height=' not in img: issues.append((rel, 'img without dimensions', img[:90]))
print(f'{len(pages)} pages checked')
print('broken links/assets:', bad or 'none')
print('missing fragment targets:', ids_missing or 'none')
print('seo/structure issues:', issues or 'none')
sys.exit(1 if bad or ids_missing or issues else 0)
