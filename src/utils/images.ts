import type { ImageMetadata } from 'astro';

/** Responsive widths for raster photos. SVG placeholders are vector, so they are left as a single file. */
export const rw = (img: ImageMetadata, widths: number[]) => (img.format === 'svg' ? {} : { widths });
