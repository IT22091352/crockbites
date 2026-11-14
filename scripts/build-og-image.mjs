import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

async function buildOgImage() {
  const root = process.cwd();
  const heroPath = path.join(root, 'src/assets/hero.png');
  const logoPath = path.join(root, 'public/images/crockbites-logo-light.svg');
  const outputPath = path.join(root, 'public/images/og-default.png');

  // 1. Process hero food image: crop to square/rounded rect 520x520
  const heroWidth = 520;
  const heroHeight = 520;
  const heroCornerRadius = 24;

  const mask = Buffer.from(
    `<svg width="${heroWidth}" height="${heroHeight}"><rect x="0" y="0" width="${heroWidth}" height="${heroHeight}" rx="${heroCornerRadius}" ry="${heroCornerRadius}" fill="#fff"/></svg>`
  );

  const croppedHero = await sharp(heroPath)
    .resize(heroWidth, heroHeight, { fit: 'cover', position: 'center' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 2. Render logo SVG to buffer
  const logoSvg = fs.readFileSync(logoPath);
  const renderedLogo = await sharp(logoSvg, { density: 288 })
    .resize(350)
    .png()
    .toBuffer();

  // 3. Render vector canvas overlay for typography and graphic design
  const overlaySvg = Buffer.from(`
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg-radial" cx="80%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#2D4837" />
          <stop offset="55%" stop-color="#1E3126" />
          <stop offset="100%" stop-color="#142119" />
        </radialGradient>
        <filter id="cardGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.4" />
        </filter>
        <filter id="badgeShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.25" />
        </filter>
      </defs>

      <!-- Base Canvas Background -->
      <rect width="1200" height="630" fill="url(#bg-radial)" />

      <!-- Outer Subtle Frame Border -->
      <rect x="18" y="18" width="1164" height="594" rx="18" fill="none" stroke="#2E4837" stroke-width="2" />

      <!-- Decorative Food Frame Background and Terracotta Border -->
      <rect x="628" y="53" width="524" height="524" rx="26" fill="none" stroke="#C66A45" stroke-width="4" opacity="0.95" filter="url(#cardGlow)" />

      <!-- Left Content Column -->
      <!-- Subtitle Tagline Pill -->
      <g transform="translate(64, 160)">
        <rect x="0" y="0" width="186" height="30" rx="15" fill="#C66A45" fill-opacity="0.2" stroke="#C66A45" stroke-width="1.4" />
        <text x="14" y="20" font-family="'Segoe UI', -apple-system, system-ui, sans-serif" font-size="13" font-weight="700" fill="#E8865D" letter-spacing="1.5">GOOD FOOD. LESS FUSS.</text>
      </g>

      <!-- Main Headline -->
      <text x="64" y="248" font-family="'Fraunces', 'Georgia', serif" font-size="44" font-weight="bold" fill="#F7F1E5">
        <tspan x="64" dy="0">Easy Slow Cooker Recipes</tspan>
        <tspan x="64" dy="54" fill="#E8865D">&amp; Everyday Meals</tspan>
      </text>

      <!-- Subtext -->
      <text x="64" y="372" font-family="'Figtree', 'Segoe UI', -apple-system, sans-serif" font-size="18" fill="#C5D4CB" font-weight="400">
        <tspan x="64" dy="0">Kitchen-tested comfort food with clear cooking steps,</tspan>
        <tspan x="64" dy="28">practical ingredients, and family-friendly guides.</tspan>
      </text>

      <!-- Value Proposition Badges -->
      <g transform="translate(64, 452)">
        <!-- Badge 1 -->
        <g filter="url(#badgeShadow)">
          <rect x="0" y="0" width="158" height="38" rx="19" fill="#243A2D" stroke="#3D5E4A" stroke-width="1.2" />
          <text x="14" y="24" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="14" font-weight="600" fill="#F7F1E5">&#127858; Tested Recipes</text>
        </g>
        <!-- Badge 2 -->
        <g transform="translate(170, 0)" filter="url(#badgeShadow)">
          <rect x="0" y="0" width="152" height="38" rx="19" fill="#243A2D" stroke="#3D5E4A" stroke-width="1.2" />
          <text x="14" y="24" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="14" font-weight="600" fill="#F7F1E5">&#9201;&#65039; Clear Timing</text>
        </g>
        <!-- Badge 3 -->
        <g transform="translate(334, 0)" filter="url(#badgeShadow)">
          <rect x="0" y="0" width="170" height="38" rx="19" fill="#243A2D" stroke="#3D5E4A" stroke-width="1.2" />
          <text x="14" y="24" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="14" font-weight="600" fill="#F7F1E5">&#127807; Allergen Safety</text>
        </g>
      </g>

      <!-- Footer Domain URL Indicator -->
      <g transform="translate(64, 526)">
        <circle cx="8" cy="10" r="5" fill="#10B981" />
        <text x="24" y="16" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="16" font-weight="700" fill="#F7F1E5" letter-spacing="0.5">crockbites.site</text>
      </g>
    </svg>
  `);

  // 4. Composite all components onto 1200x630 canvas
  await sharp(overlaySvg)
    .composite([
      { input: croppedHero, left: 630, top: 55 },
      { input: renderedLogo, left: 64, top: 60 }
    ])
    .png({ quality: 92, compressionLevel: 8 })
    .toFile(outputPath);

  const stats = fs.statSync(outputPath);
  console.log(`Open Graph banner created successfully at ${outputPath} (${stats.size} bytes, 1200x630)`);
}

buildOgImage().catch((err) => {
  console.error('Failed to generate Open Graph image:', err);
  process.exit(1);
});

