import type { ImageMetadata } from 'astro';
import { getOptimizedCloudinaryUrl } from '../lib/cloudinary.ts';

/** Responsive widths for raster photos. SVG placeholders are vector, so they are left as a single file. */
export const rw = (img: ImageMetadata | string, widths: number[]) => {
  if (typeof img === 'string') {
    return {};
  }
  return img.format === 'svg' ? {} : { widths };
};

export const isRemoteImage = (img: unknown): img is string => {
  return typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'));
};

export { getOptimizedCloudinaryUrl };
