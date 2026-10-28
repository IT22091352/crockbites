#!/usr/bin/env python3
"""
Generates the CrockBites logo SVGs.

The wordmark is converted from Fraunces (SIL Open Font License, bundled via
@fontsource-variable/fraunces) into plain vector outlines, so the SVG files need
no fonts, no external images and no filters.

Run:  python3 scripts/build-logo.py   (requires: pip install fonttools brotli)
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2')
OUT = os.path.join(ROOT, 'public/images')
os.makedirs(OUT, exist_ok=True)

FOREST, CREAM, TERRA = '#243A2D', '#F7F1E5', '#C66A45'

font = TTFont(FONT)
font = instancer.instantiateVariableFont(font, {'wght': 640, 'opsz': 48, 'SOFT': 40, 'WONK': 0})
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm

def wordmark(text, size, x0, baseline, tracking=-0.012):
    """Return (svg path d, right edge x) for text outlined at font size `size`."""
    scale = size / upm
    x = x0
    pen = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
        gs[g].draw(tp)
        x += gs[g].width * scale + tracking * size
    return pen.getCommands(), x - tracking * size

def pot(fill, steam, steam_w=2.8, favicon=False):
    """Pot geometry on a 64x64 grid. Steam is stroked, everything else is filled."""
    if favicon:  # fewer, heavier steam lines so it stays crisp at 16px
        steam_paths = [
            'M25.5 22q-4.5-3.5 0-7t0-7',
            'M38.5 22q-4.5-3.5 0-7t0-7',
        ]
        sw = 4.4
    else:
        steam_paths = [
            'M21 21q-3-2.5 0-5t0-5',
            'M32 21q-3-2.5 0-5t0-5t0-5',
            'M43 21q-3-2.5 0-5t0-5',
        ]
        sw = steam_w
    steam_svg = ''.join(f'<path d="{d}"/>' for d in steam_paths)
    return (
        f'<g fill="none" stroke="{steam}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{steam_svg}</g>'
        f'<g fill="{fill}">'
        '<rect x="9" y="24" width="46" height="5.5" rx="2.75"/>'
        '<path d="M12 31.5H52V41a15 15 0 0 1-15 15H27A15 15 0 0 1 12 41Z"/>'
        '<rect x="4.5" y="34" width="9" height="4.5" rx="2.25"/>'
        '<rect x="50.5" y="34" width="9" height="4.5" rx="2.25"/>'
        '</g>'
    )

def svg(w, h, body, title, desc):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" '
        f'role="img" aria-labelledby="t d"><title id="t">{title}</title><desc id="d">{desc}</desc>{body}</svg>\n'
    )

def write(name, content):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write(content)

# ---- Horizontal logo (icon + wordmark) --------------------------------------
SIZE, BASE, GAP = 40, 46, 14
d, right = wordmark('CrockBites', SIZE, 64 + GAP, BASE)
W, H = round(right + 2), 64
def horizontal(word_fill, pot_fill):
    return svg(W, H, pot(pot_fill, TERRA) + f'<path d="{d}" fill="{word_fill}"/>',
               'CrockBites', 'CrockBites logo: a cooking pot with three steam lines beside the CrockBites wordmark.')
write('crockbites-logo.svg', horizontal(FOREST, FOREST))          # for light backgrounds
write('crockbites-logo-light.svg', horizontal(CREAM, CREAM))      # for dark / forest backgrounds

# ---- Icon only ---------------------------------------------------------------
write('crockbites-icon.svg', svg(64, 64, pot(FOREST, TERRA, steam_w=3.2), 'CrockBites', 'CrockBites icon: a cooking pot with steam.'))
write('crockbites-icon-light.svg', svg(64, 64, pot(CREAM, TERRA, steam_w=3.2), 'CrockBites', 'CrockBites icon: a cooking pot with steam.'))

# ---- Favicon: forest tile, cream pot, two heavy steam lines --------------------
fav_body = (f'<rect width="64" height="64" rx="14" fill="{FOREST}"/>'
            f'<g transform="translate(5.1 6.4) scale(.84)">{pot(CREAM, TERRA, favicon=True)}</g>')
fav = svg(64, 64, fav_body, 'CrockBites', 'CrockBites favicon: a cream cooking pot with steam on a deep green tile.')
write('favicon.svg', fav)
with open(os.path.join(ROOT, 'public/favicon.svg'), 'w', encoding='utf-8') as f:
    f.write(fav)

# ---- Default social share image (SVG source; PNG is rendered by build-icons.mjs) ---
og_d, og_right = wordmark('CrockBites', 120, 0, 0)
bp = BoundsPen(gs)
tag_d, tag_right = wordmark('Good Food. Less Fuss.', 46, 0, 0, tracking=0)
og = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">'
    f'<rect width="1200" height="630" fill="{FOREST}"/>'
    f'<g transform="translate(120 150) scale(3.2)">{pot(CREAM, TERRA, steam_w=3.2)}</g>'
    f'<g transform="translate(120 470)"><path d="{og_d}" fill="{CREAM}"/></g>'
    f'<g transform="translate(124 548)"><path d="{tag_d}" fill="{CREAM}" fill-opacity=".82"/></g>'
    f'</svg>\n'
)
open(os.path.join(ROOT, 'scripts/og-source.svg'), 'w').write(og)
print('logo width', W, 'height', H)
