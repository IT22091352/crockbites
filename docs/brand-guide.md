# CrockBites logo and brand guide

## Files (all in `public/images/`, transparent backgrounds, vector only)

| File | Use |
|---|---|
| `crockbites-logo.svg` | Primary horizontal logo for light backgrounds (cream, white). Forest wordmark and pot, terracotta steam. |
| `crockbites-logo-light.svg` | Same logo reversed for dark backgrounds (forest footer, mobile menu). Cream wordmark and pot. |
| `crockbites-icon.svg` | Icon only, for light backgrounds. |
| `crockbites-icon-light.svg` | Icon only, for dark backgrounds. |
| `../favicon.svg` | Favicon: cream pot on a forest tile, two heavier steam lines so it stays crisp at 16 px. |
| `../favicon-32.png`, `../apple-touch-icon.png`, `../icon-192.png`, `../icon-512.png` | PNG renders of the favicon tile (Safari/iOS, manifest, Organization schema logo). |
| `og-default.png` | 1200x630 default social share image. |

There are no embedded rasters, external URLs, filters or fonts in the SVGs. The wordmark is converted to outlines.

## Colors

| Name | Hex | Role |
|---|---|---|
| Deep forest green | `#243A2D` | Wordmark, pot, primary buttons, footer |
| Warm cream | `#F7F1E5` | Page background, reversed logo |
| Soft white | `#FFFEFA` | Cards, form fields |
| Terracotta | `#C66A45` | Steam lines, icons, large decorative shapes |
| Terracotta deep | `#A4492A` | Small text accents and links (5.2:1 on cream) |
| Dark text | `#242822` | Body text (13.3:1 on cream) |

Brand terracotta alone is only about 3.4:1 on cream, so do not use it for small text. Contrast ratios above were calculated, not estimated.

## Typography

- Display and wordmark: **Fraunces** (variable, SIL Open Font License), weight about 600-640.
- Body and interface: **Figtree** (variable, SIL Open Font License).
- Both are self-hosted through `@fontsource-variable` packages. No Google Fonts request is made.

## Usage rules

- Minimum header logo height is 36 px; below 360 px viewport width the header switches to the icon only.
- Keep clear space around the logo equal to the height of the pot's lid.
- Do not recolor, stretch, rotate, or add effects. Use the `-light` files on dark backgrounds instead of recoloring.
- The tagline "Good Food. Less Fuss." is not part of the header logo. Use it in the hero, footer and social image.

## Regenerating

`npm run logo` rebuilds every file above from `scripts/build-logo.py` and `scripts/build-icons.mjs` (needs `pip install fonttools brotli`).
