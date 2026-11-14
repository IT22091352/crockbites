import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

async function buildOgImage() {
  const root = process.cwd();
  const heroPath = path.join(root, 'src/assets/hero.png');
  const logoPath = path.join(root, 'public/images/crockbites-logo-light.svg');
  const outputPath = path.join(root, 'public/images/og-default.png');

  // Exact Open Graph standard dimensions
  const WIDTH = 1200;
  const HEIGHT = 630;

  // 1. Process food photo: 520x520 square with rounded corners
  const foodSize = 510;
  const cornerRadius = 28;

  const mask = Buffer.from(
    `<svg width="${foodSize}" height="${foodSize}">
      <rect x="0" y="0" width="${foodSize}" height="${foodSize}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#fff"/>
    </svg>`
  );

  const croppedFood = await sharp(heroPath)
    .resize(foodSize, foodSize, { fit: 'cover', position: 'center' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 2. Render logo SVG to crisp high-density buffer
  const logoSvg = fs.readFileSync(logoPath);
  const renderedLogo = await sharp(logoSvg, { density: 288 })
    .resize(360)
    .png()
    .toBuffer();

  // 3. Vector graphic backdrop and typography layout
  const backdropSvg = Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bgGrad" cx="75%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#2A4333" />
          <stop offset="60%" stop-color="#1B2B21" />
          <stop offset="100%" stop-color="#121D16" />
        </radialGradient>
        <filter id="cardShadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.45" />
        </filter>
        <filter id="pillShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.25" />
        </filter>
      </defs>

      <!-- Background Canvas -->
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGrad)" />

      <!-- Outer Inset Border -->
      <rect x="16" y="16" width="${WIDTH - 32}" height="${HEIGHT - 32}" rx="20" fill="none" stroke="#2D4636" stroke-width="2" />

      <!-- Warm Terracotta Frame around Food Image -->
      <rect x="626" y="56" width="${foodSize + 8}" height="${foodSize + 8}" rx="${cornerRadius + 4}" fill="none" stroke="#C66A45" stroke-width="4" filter="url(#cardShadow)" />

      <!-- Left Content Column -->
      <!-- Tagline Pill -->
      <g transform="translate(68, 162)">
        <rect x="0" y="0" width="186" height="30" rx="15" fill="#C66A45" fill-opacity="0.22" stroke="#C66A45" stroke-width="1.5" />
        <text x="14" y="20" font-family="'Segoe UI', -apple-system, system-ui, sans-serif" font-size="13" font-weight="700" fill="#E8865D" letter-spacing="1.4">GOOD FOOD. LESS FUSS.</text>
      </g>

      <!-- Main Headline -->
      <text x="68" y="250" font-family="'Fraunces', 'Georgia', serif" font-size="43" font-weight="bold" fill="#F7F1E5">
        <tspan x="68" dy="0">Easy Slow Cooker Recipes</tspan>
        <tspan x="68" dy="54" fill="#E8865D">&amp; Everyday Meals</tspan>
      </text>

      <!-- Subtext / Description -->
      <text x="68" y="372" font-family="'Figtree', 'Segoe UI', -apple-system, sans-serif" font-size="18" fill="#C5D4CB" font-weight="400">
        <tspan x="68" dy="0">Kitchen-tested comfort food with clear cooking steps,</tspan>
        <tspan x="68" dy="28">practical ingredients, and family-friendly guides.</tspan>
      </text>

      <!-- Feature Badges -->
      <g transform="translate(68, 452)">
        <!-- Badge 1 -->
        <g filter="url(#pillShadow)">
          <rect x="0" y="0" width="156" height="38" rx="19" fill="#243A2D" stroke="#3D5E4A" stroke-width="1.2" />
          <text x="14" y="24" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="14" font-weight="600" fill="#F7F1E5">&#127858; Tested Recipes</text>
        </g>
        <!-- Badge 2 -->
        <g transform="translate(168, 0)" filter="url(#pillShadow)">
          <rect x="0" y="0" width="150" height="38" rx="19" fill="#243A2D" stroke="#3D5E4A" stroke-width="1.2" />
          <text x="14" y="24" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="14" font-weight="600" fill="#F7F1E5">&#9201;&#65039; Clear Timing</text>
        </g>
        <!-- Badge 3 -->
        <g transform="translate(330, 0)" filter="url(#pillShadow)">
          <rect x="0" y="0" width="168" height="38" rx="19" fill="#243A2D" stroke="#3D5E4A" stroke-width="1.2" />
          <text x="14" y="24" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="14" font-weight="600" fill="#F7F1E5">&#127807; Allergen Safety</text>
        </g>
      </g>

      <!-- Domain Indicator -->
      <g transform="translate(68, 526)">
        <circle cx="8" cy="10" r="5" fill="#10B981" />
        <text x="24" y="16" font-family="'Figtree', 'Segoe UI', sans-serif" font-size="16" font-weight="700" fill="#F7F1E5" letter-spacing="0.5">crockbites.site</text>
      </g>
    </svg>
  `);

  // 4. Render raster backdrop directly at exact 1200x630
  const renderedBackdrop = await sharp(backdropSvg, { density: 144 })
    .resize(WIDTH, HEIGHT)
    .png()
    .toBuffer();

  const tempPath = path.join(root, 'public/images/og-default-temp.png');

  // 5. Final Composite: Backdrop + Food Hero + Vector Logo
  await sharp(renderedBackdrop)
    .composite([
      { input: croppedFood, left: 630, top: 60 },
      { input: renderedLogo, left: 68, top: 60 }
    ])
    .png({ quality: 92, compressionLevel: 8 })
    .toFile(tempPath);

  fs.copyFileSync(tempPath, outputPath);
  fs.unlinkSync(tempPath);

  const meta = await sharp(outputPath).metadata();
  const stats = fs.statSync(outputPath);
  console.log(`Success: Generated ${outputPath} (${meta.width}x${meta.height}, ${stats.size} bytes)`);
}

buildOgImage().catch((err) => {
  console.error('Build OG Image failed:', err);
  process.exit(1);
});
