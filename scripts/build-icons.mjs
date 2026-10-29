// Renders PNG icons and the social share image from the SVG sources.
// Run after build-logo.py:  node scripts/build-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const img = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const out = (p) => new URL(`../public/${p}`, import.meta.url).pathname;


const fav = img('public/favicon.svg');
await sharp(fav, { density: 384 }).resize(32, 32).png().toFile(out('favicon-32.png'));
await sharp(fav, { density: 384 }).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
await sharp(fav, { density: 384 }).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(fav, { density: 384 }).resize(512, 512).png().toFile(out('icon-512.png'));
await sharp(img('scripts/og-source.svg'), { density: 144 }).resize(1200, 630).png().toFile(out('images/og-default.png'));

// Review renders (not shipped): the logo on light and on dark.
const render = async (file, bg, name) => {
  const svg = img(`public/images/${file}`);
  const logo = await sharp(svg, { density: 288 }).resize({ height: 160 }).png().toBuffer();
  const m = await sharp(logo).metadata();
  await sharp({ create: { width: m.width + 120, height: 280, channels: 4, background: bg } })
    .composite([{ input: logo, left: 60, top: 60 }]).png().toFile(`/tmp/${name}.png`);
};
await render('crockbites-logo.svg', '#F7F1E5', 'logo-on-light');
await render('crockbites-logo-light.svg', '#243A2D', 'logo-on-dark');
await sharp(fav, { density: 384 }).resize(16, 16).resize(160, 160, { kernel: 'nearest' }).png().toFile('/tmp/fav16.png');
console.log('icons ok');
