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

  // Execute bundled RecipeDetail scripts linked via src
  for (const m of html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/gi)) {
    const src = m[1];
    if (src.includes('RecipeDetail')) {
      const scriptPath = `${DIST_ROOT}/${src.replace(/^\//, '')}`;
      if (fs.existsSync(scriptPath)) {
        try {
          const code = fs.readFileSync(scriptPath, 'utf8');
          dom.window.eval(code);
        } catch (err) {
          // Ignore
        }
      }
    }
  }

  // Execute inline scripts
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim()) {
      try {
        dom.window.eval('(function(){\n' + m[1] + '\n})()');
      } catch (err) {
        // Ignore
      }
    }
  }

  return dom;
}

const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) process.exitCode = 1;
};

// ---- Dynamic recipe discovery ----
const recipeParentDir = `${DIST_ROOT}/recipe`;
let recipeSlugs = [];
if (fs.existsSync(recipeParentDir)) {
  recipeSlugs = fs.readdirSync(recipeParentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(`${recipeParentDir}/${entry.name}/index.html`))
    .map((entry) => entry.name);
}

if (recipeSlugs.length === 0) {
  console.error(`FAIL: No published recipes found in build output at ${recipeParentDir}`);
  process.exit(1);
}

const targetSlug = recipeSlugs[0];
console.log(`Discovered ${recipeSlugs.length} published recipe(s). Testing: ${targetSlug}`);

// ---- Recipe page: serving scaler & interactive controls ----
const dom = load(`dist/recipe/${targetSlug}/index.html`, `https://crockbites.com/recipe/${targetSlug}/`);
const d = dom.window.document;
const txt = (sel) => d.querySelector(sel)?.textContent.trim();
const rows = () => d.querySelectorAll('[data-ing]');

ok(Boolean(d.querySelector('h1')?.textContent.trim()), `Recipe title present: "${txt('h1')}"`);

// Feature 3: Jump to Recipe
const jumpBtn = d.querySelector('a[href="#recipe-card"]');
ok(Boolean(jumpBtn), 'Feature 3: Jump to recipe button exists with href="#recipe-card"');
const cardTarget = d.getElementById('recipe-card');
ok(Boolean(cardTarget), 'Feature 3: Recipe card anchor target #recipe-card exists');

// Feature 1: Serving Scaler
const baseServingsStr = txt('[data-servings-out]');
const baseServings = parseInt(baseServingsStr || '0', 10);
ok(baseServings > 0, `base servings valid: ${baseServings}`);

const ingList = rows();
ok(ingList.length > 0, `ingredients list rendered: ${ingList.length} rows`);

const inc = d.querySelector('[data-inc]');
const dec = d.querySelector('[data-dec]');
const reset = d.querySelector('[data-reset]');
ok(Boolean(inc && dec && reset), 'scaler controls exist (+, -, reset)');

inc?.click();
const scaledServings = parseInt(txt('[data-servings-out]') || '0', 10);
ok(scaledServings > baseServings, `servings increased after inc: ${scaledServings}`);
ok(!reset.hidden, 'reset button visible after scaling');

reset?.click();
ok(parseInt(txt('[data-servings-out]') || '0', 10) === baseServings, `reset restores base servings: ${baseServings}`);
ok(reset.hidden, 'reset button hidden after reset');

for (let i = 0; i < 50; i += 1) dec?.click();
ok(txt('[data-servings-out]') === '1' && dec.disabled, 'min 1 enforced, dec button disabled at 1');

reset?.click();

// Feature 2: US / Metric Unit Converter
const metricBtn = d.querySelector('[data-unit-btn="metric"]');
const usBtn = d.querySelector('[data-unit-btn="us"]');
ok(Boolean(metricBtn && usBtn), 'Feature 2: Unit converter buttons (US/Metric) exist');

if (metricBtn && usBtn) {
  metricBtn.click();
  ok(metricBtn.classList.contains('active'), 'Feature 2: Metric toggle activates on click');
  usBtn.click();
  ok(usBtn.classList.contains('active'), 'Feature 2: US toggle restores on click');
}

// Feature 4: Print Recipe
const printBtn = d.querySelector('[data-print]');
ok(Boolean(printBtn), 'Feature 4: Print button exists');
printBtn?.click();
ok(dom.window.__printed === true, 'Feature 4: Print button triggers window.print()');

const checkboxes = d.querySelectorAll('.check-row input[type=checkbox]');
ok(checkboxes.length > 0, `ingredient checklist has ${checkboxes.length} checkboxes`);

const steps = d.querySelectorAll('ol > li[id^=step-]');
ok(steps.length > 0, `instructions have ${steps.length} numbered steps`);

// Feature 5: Interactive Cooking Mode
const startCookingBtn = d.querySelector('[data-start-cooking]');
ok(Boolean(startCookingBtn), 'Feature 5: Start Cooking button exists');
const cookingModal = d.getElementById('cookingModeModal');
ok(Boolean(cookingModal), 'Feature 5: Cooking mode modal element exists');

if (startCookingBtn && cookingModal) {
  startCookingBtn.click();
  ok(!cookingModal.hidden, 'Feature 5: Cooking mode opens upon clicking Start Cooking');
  const exitBtn = d.getElementById('exitCookingModeBtn');
  ok(Boolean(exitBtn), 'Feature 5: Exit Cooking Mode button exists');
  exitBtn?.click();
  ok(cookingModal.hidden, 'Feature 5: Cooking mode closes on Exit click');
}

// Feature 6: Step Cooking Timers
const stepTimerButtons = d.querySelectorAll('[data-step-timer-btn]');
if (stepTimerButtons.length > 0) {
  const firstTimerBtn = stepTimerButtons[0];
  ok(Boolean(firstTimerBtn.dataset.totalSeconds), `Feature 6: Timer duration detected: ${firstTimerBtn.dataset.label}`);
} else {
  console.log('NOTE: Target recipe instruction steps have no explicit timer durations');
}

// ---- Mobile menu ----
const menu = d.getElementById('mobile-menu');
const open = d.getElementById('menu-open');
if (menu && open) {
  open.click();
  ok(!menu.classList.contains('hidden') && open.getAttribute('aria-expanded') === 'true', 'menu opens');
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(menu.classList.contains('hidden') && open.getAttribute('aria-expanded') === 'false', 'Escape closes menu');
} else {
  console.log('SKIP: Mobile menu not found on page');
}

// ---- Search ----
function search(q, cat = '') {
  const s = load('dist/search/index.html', `https://crockbites.com/search/?q=${encodeURIComponent(q)}&category=${cat}`);
  const doc = s.window.document;
  return {
    n: doc.querySelectorAll('#search-results li').length,
    empty: !doc.getElementById('search-empty')?.hidden,
    status: doc.getElementById('search-status')?.textContent ?? '',
    titles: [...doc.querySelectorAll('#search-results h3')].map((h) => h.textContent?.trim() ?? ''),
    doc,
    win: s.window,
  };
}

let r = search('');
ok(r.n === recipeSlugs.length, `empty query lists all ${recipeSlugs.length} published recipe(s): ${r.status}`);

const firstWord = (txt('h1') || '').split(/\s+/)[0];
if (firstWord) {
  r = search(firstWord);
  ok(r.n >= 1, `search "${firstWord}" finds match: ${r.titles.join('; ')}`);
}

r = search('xyz_nonexistent_token_12345');
ok(r.n === 0 && r.empty, 'empty state shows when nothing matches query');

// live typing test
const t = search('');
const searchInput = t.doc.getElementById('search-input');
if (searchInput) {
  searchInput.value = 'xyz_nonexistent_token_12345';
  searchInput.dispatchEvent(new t.win.Event('input'));
  ok(t.doc.querySelectorAll('#search-results li').length === 0, 'typing nonexistent query filters live to 0');
}
