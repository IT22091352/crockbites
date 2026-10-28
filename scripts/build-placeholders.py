#!/usr/bin/env python3
"""
Generates original, flat 'top-down slow cooker' illustrations used as PLACEHOLDER
images for the starter recipes and the homepage. They are not photographs of the
recipes. Replace them with your own food photography (see README, "Images").
Run: python3 scripts/build-placeholders.py
"""
import math, random, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src/assets/recipes')
os.makedirs(OUT, exist_ok=True)
W, H = 1600, 1200
CX, CY, R = 800, 600, 400   # crock centre and inner radius

def f(v): return ('%.1f' % v).rstrip('0').rstrip('.')

class Scene:
    def __init__(self, seed, table, crock='#2F4A3A', rim='#3B5A47', w=W, h=H, cx=CX, cy=CY, r=R):
        self.rng = random.Random(seed); self.w, self.h, self.cx, self.cy, self.r = w, h, cx, cy, r
        self.parts = []; self.table = table; self.crock = crock; self.rim = rim
    def pt(self, frac=0.86):
        a = self.rng.uniform(0, 2*math.pi); d = self.r*frac*math.sqrt(self.rng.random())
        return self.cx + d*math.cos(a), self.cy + d*math.sin(a)
    def add(self, s): self.parts.append(s)
    def ell(self, x, y, rx, ry, fill, rot=None, stroke=None, op=1):
        rot = self.rng.uniform(0, 180) if rot is None else rot
        st = f' stroke="{stroke}" stroke-width="3"' if stroke else ''
        self.add(f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(rx)}" ry="{f(ry)}" transform="rotate({f(rot)} {f(x)} {f(y)})" fill="{fill}" opacity="{op}"{st}/>')
    def rrect(self, x, y, s, fill, rot=None, rad=0.25, hi=None):
        rot = self.rng.uniform(0, 90) if rot is None else rot
        self.add(f'<rect x="{f(x-s/2)}" y="{f(y-s/2)}" width="{f(s)}" height="{f(s)}" rx="{f(s*rad)}" transform="rotate({f(rot)} {f(x)} {f(y)})" fill="{fill}"/>')
        if hi: self.add(f'<rect x="{f(x-s/2+s*.12)}" y="{f(y-s/2+s*.12)}" width="{f(s*.5)}" height="{f(s*.22)}" rx="{f(s*.1)}" transform="rotate({f(rot)} {f(x)} {f(y)})" fill="{hi}" opacity=".35"/>')
    def circ(self, x, y, r, fill, op=1): self.add(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" fill="{fill}" opacity="{op}"/>')
    def strand(self, color, width, length):
        x, y = self.pt(.8); a = self.rng.uniform(0, 2*math.pi)
        x2, y2 = x + length*math.cos(a), y + length*math.sin(a)
        mx, my = (x+x2)/2 + self.rng.uniform(-40, 40), (y+y2)/2 + self.rng.uniform(-40, 40)
        self.add(f'<path d="M{f(x)} {f(y)}Q{f(mx)} {f(my)} {f(x2)} {f(y2)}" stroke="{color}" stroke-width="{f(width)}" stroke-linecap="round" fill="none"/>')
    def lemon(self, x, y, r=62):
        self.circ(x, y, r, '#EFC93B'); self.circ(x, y, r-9, '#F8EBA0')
        for i in range(8):
            a = i*math.pi/4
            self.add(f'<path d="M{f(x)} {f(y)}L{f(x+(r-12)*math.cos(a))} {f(y+(r-12)*math.sin(a))}" stroke="#EFC93B" stroke-width="4" stroke-linecap="round"/>')
    def herbs(self, n, colors=('#5E8C49', '#78A25B', '#4A7339')):
        for _ in range(n):
            x, y = self.pt(.9); self.ell(x, y, self.rng.uniform(7, 13), self.rng.uniform(3, 6), self.rng.choice(colors))
    def render(self, contents_svg_extra='', oval=False):
        w, h, cx, cy, r = self.w, self.h, self.cx, self.cy, self.r
        stripes = ''.join(f'<rect x="0" y="{y}" width="{w}" height="2" fill="#000" opacity=".025"/>' for y in range(0, h, 14))
        # napkin + spoon for an editorial tabletop feel
        napkin = (f'<g transform="rotate(-14 {w*0.14} {h*0.82})"><rect x="{w*0.02}" y="{h*0.70}" width="{w*0.26}" height="{h*0.24}" rx="14" fill="#FFFEFA"/>'
                  + ''.join(f'<rect x="{w*0.02}" y="{h*0.70+i*h*0.04+10}" width="{w*0.26}" height="7" fill="#C66A45" opacity=".55"/>' for i in range(1)) + '</g>')
        sx, sy = w*0.90, h*0.18
        spoon = (f'<g transform="rotate(38 {sx} {sy})"><rect x="{sx-12}" y="{sy}" width="24" height="{h*0.26}" rx="12" fill="#B98B58"/>'
                 f'<ellipse cx="{sx}" cy="{sy-18}" rx="46" ry="62" fill="#C99A63"/></g>')
        body = ''.join(self.parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
                f'<rect width="{w}" height="{h}" fill="{self.table}"/>{stripes}{napkin}{spoon}'
                f'<circle cx="{cx+14}" cy="{cy+22}" r="{r+86}" fill="#000" opacity=".10"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r+80}" fill="{self.crock}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r+54}" fill="{self.rim}"/>'
                f'<rect x="{cx-r-130}" y="{cy-34}" width="{(r+130)*2}" height="68" rx="34" fill="{self.crock}" opacity="0"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r+14}" fill="#1E2F25"/>'
                f'<clipPath id="c"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>'
                f'<g clip-path="url(#c)">{body}</g>'
                f'<circle cx="{cx}" cy="{cy}" r="{r-6}" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="12"/>'
                f'<path d="M{cx-r-40} {cy-110}A{r+54} {r+54} 0 0 1 {cx-120} {cy-r-30}" stroke="#fff" stroke-opacity=".16" stroke-width="14" stroke-linecap="round" fill="none"/>'
                f'</svg>\n')

def base(s, color, ring='#00000022'):
    s.circ(s.cx, s.cy, s.r, color)
    s.circ(s.cx, s.cy, s.r*0.62, '#ffffff', op=.05)

def pulled_pork(seed=1):
    s = Scene(seed, '#EADFC8'); base(s, '#8C4E2B')
    for _ in range(150): s.strand(s.rng.choice(['#B9703F', '#A35A2E', '#D19060', '#C47F4D']), s.rng.uniform(12, 22), s.rng.uniform(110, 230))
    for _ in range(26): x, y = s.pt(.85); s.ell(x, y, s.rng.uniform(14, 28), s.rng.uniform(8, 14), '#5A2F18')
    for _ in range(18): x, y = s.pt(.85); s.ell(x, y, 22, 6, '#E9C77D', op=.8)  # onion ribbons
    return s.render()

def lemon_chicken(seed=2):
    s = Scene(seed, '#DCE3D3'); base(s, '#E2B85B')
    for _ in range(7): x, y = s.pt(.62); s.ell(x, y, 120, 70, '#D9A066', stroke='#C48A4C'); s.ell(x-14, y-18, 60, 24, '#EDBF8C', rot=0, op=.5)
    for _ in range(7): x, y = s.pt(.78); s.lemon(x, y)
    for _ in range(6): x, y = s.pt(.85); s.ell(x, y, 18, 10, '#F4EBD6')
    s.herbs(90); return s.render()

def chicken_gravy(seed=3):
    s = Scene(seed, '#EADFC8'); base(s, '#B98A5B')
    for _ in range(5): x, y = s.pt(.55); s.ell(x, y, 150, 85, '#E6C79B', stroke='#D4AE7B')
    for _ in range(9): x, y = s.pt(.8); s.ell(x, y, 38, 24, '#9C7A56')
    s.circ(s.cx, s.cy, s.r, '#C39A6A', op=.45)
    for _ in range(40): x, y = s.pt(.85); s.ell(x, y, 30, 14, '#E8D2AE', op=.55)
    s.herbs(110); return s.render()

def beef_stew(seed=4, scale=1.0):
    s = Scene(seed, '#CBD6C4'); base(s, '#6B3A24')
    for _ in range(26): x, y = s.pt(.84); s.rrect(x, y, 78, '#57291A', rad=.3, hi='#FFFFFF')
    for _ in range(22): x, y = s.pt(.84); s.rrect(x, y, 62, '#E9D08E', rad=.28, hi='#FFFFFF')
    for _ in range(26): x, y = s.pt(.86); s.circ(x, y, 34, '#E58A2B'); s.circ(x, y, 17, '#F0A85A')
    for _ in range(70): x, y = s.pt(.9); s.circ(x, y, 9, '#6FA04E')
    s.herbs(40); return s.render()

def bean_soup(seed=5):
    s = Scene(seed, '#E7C3AF'); base(s, '#B87B44')
    for _ in range(230): x, y = s.pt(.93); s.ell(x, y, 34, 21, '#F4EAD2', stroke='#E2D3B3')
    for _ in range(34): x, y = s.pt(.86); s.rrect(x, y, 36, '#E58A2B', rad=.2)
    for _ in range(30): x, y = s.pt(.86); s.rrect(x, y, 28, '#8DB36B', rad=.2)
    for _ in range(10): x, y = s.pt(.8); s.ell(x, y, 46, 24, '#C88B87')  # ham pieces
    s.herbs(40); return s.render()

def breakfast_casserole(seed=6):
    s = Scene(seed, '#DCE3D3'); base(s, '#F0CD5C')
    for i in range(-12, 13):
        s.add(f'<path d="M{s.cx-R} {s.cy+i*40}L{s.cx+R} {s.cy+i*40-60}" stroke="#D9AE3E" stroke-width="6" opacity=".55"/>')
    for _ in range(40): x, y = s.pt(.9); s.ell(x, y, 54, 40, '#F2A93B', op=.85)  # melted cheese
    for _ in range(36): x, y = s.pt(.88); s.circ(x, y, 26, '#8A4A2C'); s.circ(x-6, y-6, 10, '#A4603B', op=.8)  # sausage
    for _ in range(26): x, y = s.pt(.9); s.rrect(x, y, 30, '#C93C2E', rad=.2)
    for _ in range(18): x, y = s.pt(.9); s.rrect(x, y, 24, '#5E8C49', rad=.2)
    s.herbs(60); return s.render()

def easy_chicken_dinner(seed=7):
    s = Scene(seed, '#E7C3AF'); base(s, '#C79456')
    for _ in range(14): x, y = s.pt(.78); s.ell(x, y, 62, 40, '#E8C879', stroke='#D3B05F'); s.ell(x-8, y-8, 30, 12, '#F3DFA0', rot=0, op=.6)
    for _ in range(5): x, y = s.pt(.6); s.ell(x, y, 112, 68, '#C98A4A', stroke='#B4773B'); s.ell(x-20, y-20, 50, 20, '#E0A770', rot=0, op=.5)
    for _ in range(16): x, y = s.pt(.84); s.rrect(x, y, 30, '#E8832A', rad=.45, hi='#FFFFFF')
    s.herbs(90); return s.render()

def veg_soup(seed=8):
    s = Scene(seed, '#CBD6C4'); base(s, '#C45537')
    cols = ['#E58A2B', '#F2CF4A', '#E9D9A6', '#6FA04E', '#9CC26A', '#F4EAD2']
    for _ in range(200): x, y = s.pt(.93); s.rrect(x, y, s.rng.uniform(22, 36), s.rng.choice(cols), rad=.3)
    for _ in range(14): x, y = s.pt(.8); s.ell(x, y, 62, 30, '#3F7A3F')   # kale
    for _ in range(40): x, y = s.pt(.9); s.circ(x, y, 9, '#7EB852')
    return s.render()

def hero(seed=11):
    s = Scene(seed, '#E4D6BA', w=1200, h=1500, cx=600, cy=800, r=440)
    base(s, '#6B3A24')
    for _ in range(30): x, y = s.pt(.84); s.rrect(x, y, 84, '#57291A', rad=.3, hi='#FFFFFF')
    for _ in range(24): x, y = s.pt(.84); s.rrect(x, y, 66, '#E9D08E', rad=.28, hi='#FFFFFF')
    for _ in range(30): x, y = s.pt(.86); s.circ(x, y, 36, '#E58A2B'); s.circ(x, y, 18, '#F0A85A')
    for _ in range(80): x, y = s.pt(.9); s.circ(x, y, 9, '#6FA04E')
    s.herbs(50); return s.render()

SCENES = {
  'slow-cooker-pulled-pork': pulled_pork, 'slow-cooker-lemon-chicken': lemon_chicken,
  'slow-cooker-chicken-and-gravy': chicken_gravy, 'slow-cooker-beef-stew': beef_stew,
  'slow-cooker-bean-soup': bean_soup, 'slow-cooker-breakfast-casserole': breakfast_casserole,
  'easy-slow-cooker-chicken-dinner': easy_chicken_dinner, 'slow-cooker-vegetable-soup': veg_soup,
}
for name, fn in SCENES.items():
    open(os.path.join(OUT, f'{name}.svg'), 'w').write(fn())
open(os.path.join(ROOT, 'src/assets/hero.svg'), 'w').write(hero())
print('wrote', len(SCENES) + 1, 'placeholder illustrations')
