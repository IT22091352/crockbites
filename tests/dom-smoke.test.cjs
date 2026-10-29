const { JSDOM } = require('jsdom');
const fs = require('fs');
const DIST_ROOT = fs.existsSync('dist/client') ? 'dist/client' : 'dist';
function load(file, url) {
  const relativePath = file.replace(/^dist\/?/, '').replace(/^\//, '');
  const html = fs.readFileSync(`${DIST_ROOT}/${relativePath}`, 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.print = () => { dom.window.__printed = true; };
  dom.window.matchMedia = dom.window.matchMedia || (() => ({ addEventListener() {}, matches: false }));
  dom.window.history.replaceState = dom.window.history.replaceState.bind(dom.window.history);
  for (const m of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) dom.window.eval('(function(){' + m[1] + '\n})()');
  return dom;
}
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };

// ---- Recipe page: serving scaler ----
let dom = load('dist/recipe/slow-cooker-pulled-pork/index.html', 'https://crockbites.com/recipe/slow-cooker-pulled-pork/');
let d = dom.window.document;
const txt = (sel) => d.querySelector(sel)?.textContent.trim();
const row = (i) => d.querySelectorAll('[data-ing]')[i].textContent.replace(/\s+/g, ' ').trim();
ok(row(0).startsWith('4 lb (1.8 kg) boneless pork shoulder'), 'base: ' + row(0));
const inc = d.querySelector('[data-inc]'), dec = d.querySelector('[data-dec]'), reset = d.querySelector('[data-reset]');
inc.click(); inc.click(); // 8 -> 10
ok(txt('[data-servings-out]') === '10', 'servings now 10');
ok(row(0).startsWith('5 lb') && d.querySelectorAll('[data-ing]')[0].querySelector('[data-alt]').hidden === true, 'scaled x1.25 hides metric hint');
ok(row(2).includes('5 cloves garlic'), 'plural unit: ' + row(2));
ok(row(1).startsWith('1 ¼ large yellow onions') || row(1).includes('1 ¼'), 'fractions: ' + row(1));
ok(!reset.hidden && !d.querySelector('[data-scale-note]').hidden, 'reset + scaling note visible');
reset.click();
ok(txt('[data-servings-out]') === '8' && row(0).includes('(1.8 kg)') && reset.hidden, 'reset restores base');
for (let i = 0; i < 20; i++) dec.click();
ok(txt('[data-servings-out]') === '1' && dec.disabled, 'min 1 enforced, button disabled');
const salt = [...d.querySelectorAll('[data-ing]')].find((r) => r.textContent.includes('kosher salt')).textContent.replace(/\s+/g, ' ');
ok(salt.startsWith('¼ tsp') || salt.startsWith('¼ tsp kosher'), 'salt at 1 serving: ' + salt);
d.querySelector('[data-print]').click();
ok(dom.window.__printed === true, 'print button calls window.print()');
ok(d.querySelectorAll('.check-row input[type=checkbox]').length === 15, 'ingredient checklist has 15 checkboxes');
ok(d.querySelectorAll('ol > li[id^=step-]').length === 7, '7 numbered steps');

// ---- Mobile menu ----
const menu = d.getElementById('mobile-menu'), open = d.getElementById('menu-open');
open.click(); ok(!menu.classList.contains('hidden') && open.getAttribute('aria-expanded') === 'true', 'menu opens');
menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok(menu.classList.contains('hidden') && open.getAttribute('aria-expanded') === 'false', 'Escape closes menu');

// ---- Search ----
function search(q, cat = '') {
  const s = load('dist/search/index.html', `https://crockbites.com/search/?q=${encodeURIComponent(q)}&category=${cat}`);
  const doc = s.window.document;
  return { n: doc.querySelectorAll('#search-results li').length, empty: !doc.getElementById('search-empty').hidden,
           status: doc.getElementById('search-status').textContent, titles: [...doc.querySelectorAll('#search-results h3')].map((h) => h.textContent), doc, win: s.window };
}
let r = search(''); ok(r.n === 9, 'empty query lists all 9: ' + r.status);
r = search('chicken'); ok(r.n === 4, `"chicken" => ${r.n} (${r.titles.join('; ')})`);
r = search('soup'); ok(r.n === 4, `"soup" => ${r.n} ${r.titles.join('; ')}`);
r = search('gravy'); ok(r.n === 2, `"gravy" => ${r.titles}`);
r = search('pork', 'beef-pork'); ok(r.n === 1, '"pork" in Beef & Pork => 1');
r = search('chicken', 'breakfast'); ok(r.n === 0 && r.empty, 'empty state shows when nothing matches');
r = search('vegetarian'); ok(r.n >= 1, `tag/category search "vegetarian" => ${r.titles}`);
r = search('CHICKEN dinner'); ok(r.titles[0] === 'Easy Slow Cooker Chicken Dinner', 'case-insensitive multi-word ranks title match first: ' + r.titles[0]);
// live typing
const t = search(''); t.doc.getElementById('search-input').value = 'beef'; t.doc.getElementById('search-input').dispatchEvent(new t.win.Event('input'));
ok(t.doc.querySelectorAll('#search-results li').length === 2, 'typing filters live (beef: stew + Beef & Pork category)');
