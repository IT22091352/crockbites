import { v2 as cloudinary } from 'cloudinary';
import { getRuntimeSecret } from './admin.ts';

export type CloudinaryUploadResult = {
  secure_url: string;
  public_id: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
};

export type RecipeImageMeta = {
  url: string;
  publicId?: string;
  alt: string;
  width?: number;
  height?: number;
  isPrimary?: boolean;
};

export interface AssetCleanupResult {
  publicId: string;
  status: 'deleted' | 'failed' | 'skipped_in_use';
  error?: string;
}

export function getCloudinaryConfig() {
  const cloudName = getRuntimeSecret('CLOUDINARY_CLOUD_NAME');
  const apiKey = getRuntimeSecret('CLOUDINARY_API_KEY');
  const apiSecret = getRuntimeSecret('CLOUDINARY_API_SECRET');

  return {
    cloudName,
    apiKey,
    apiSecret,
    isConfigured: Boolean(cloudName && apiKey && apiSecret),
  };
}

export function isCloudinaryConfigured(): boolean {
  return getCloudinaryConfig().isConfigured;
}

export async function uploadImageBuffer(
  buffer: Buffer,
  options: {
    folder?: string;
    publicId?: string;
    allowedFormats?: string[];
  } = {}
): Promise<CloudinaryUploadResult> {
  const config = getCloudinaryConfig();
  if (!config.isConfigured) {
    throw new Error('Cloudinary is not configured. Missing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET.');
  }

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  const folder = options.folder ?? 'crockbites/recipes';
  const allowedFormats = options.allowedFormats ?? ['jpg', 'jpeg', 'png', 'webp', 'avif'];

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: options.publicId,
        resource_type: 'image',
        allowed_formats: allowedFormats,
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error || !result) {
          return reject(new Error(error?.message || 'Cloudinary upload failed'));
        }
        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Extracts a Cloudinary public ID from a Cloudinary delivery URL or raw ID.
 * Handles transformations, version segments, and format extensions.
 */
export function extractCloudinaryPublicId(urlOrId: string | undefined): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  if (!trimmed.includes('res.cloudinary.com')) {
    // If it's already a relative public ID path (e.g. "crockbites/recipes/sample")
    if (trimmed.startsWith('crockbites/')) {
      return trimmed.replace(/\.[a-zA-Z0-9]+$/, '');
    }
    return null;
  }

  const uploadIndex = trimmed.indexOf('/upload/');
  if (uploadIndex === -1) return null;

  let path = trimmed.slice(uploadIndex + 8);
  // Strip transformations (e.g. "f_auto,q_auto,w_800,c_limit/")
  path = path.replace(/^(?:(?:[a-z]_[a-zA-Z0-9_.-]+,?)+|\/)+/, '');
  // Strip version segment (e.g. "v1793287677/")
  path = path.replace(/^v\d+\//, '');
  // Strip file extension
  path = path.replace(/\.[a-zA-Z0-9]+$/, '');

  return path || null;
}

/**
 * Authenticated server-side deletion of a single Cloudinary asset.
 */
export async function deleteCloudinaryAsset(publicId: string): Promise<{ result: string }> {
  const config = getCloudinaryConfig();
  if (!config.isConfigured) {
    throw new Error('Cloudinary is not configured. Missing credentials.');
  }

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: 'image' }, (error, result) => {
      if (error) {
        return reject(new Error(error.message || 'Cloudinary destroy failed'));
      }
      resolve(result ?? { result: 'ok' });
    });
  });
}

/**
 * Determines which Cloudinary assets belonging to targetRecipe are NOT referenced
 * by any other recipe in the collection, ensuring safe deletion without broken links.
 */
export function findUnusedRecipeAssets(
  targetRecipe: { image?: string; gallery?: Array<{ url?: string; publicId?: string }> },
  allOtherRecipes: Array<{ image?: string; gallery?: Array<{ url?: string; publicId?: string }> }>,
): string[] {
  const targetIds = new Set<string>();

  const targetMainId = extractCloudinaryPublicId(targetRecipe.image);
  if (targetMainId) targetIds.add(targetMainId);

  if (Array.isArray(targetRecipe.gallery)) {
    for (const item of targetRecipe.gallery) {
      const gId = item.publicId || extractCloudinaryPublicId(item.url);
      if (gId) targetIds.add(gId);
    }
  }

  const otherIds = new Set<string>();
  for (const other of allOtherRecipes) {
    const mainId = extractCloudinaryPublicId(other.image);
    if (mainId) otherIds.add(mainId);

    if (Array.isArray(other.gallery)) {
      for (const item of other.gallery) {
        const gId = item.publicId || extractCloudinaryPublicId(item.url);
        if (gId) otherIds.add(gId);
      }
    }
  }

  const unused: string[] = [];
  for (const id of targetIds) {
    if (!otherIds.has(id)) {
      unused.push(id);
    }
  }

  return unused;
}

/**
 * Safely cleans up orphaned Cloudinary media for a recipe confirmed to be deleted.
 * Deletes only assets verified to be unreferenced by any other recipe.
 */
export async function cleanupUnusedRecipeMedia(
  targetRecipe: { image?: string; gallery?: Array<{ url?: string; publicId?: string }> },
  allOtherRecipes: Array<{ image?: string; gallery?: Array<{ url?: string; publicId?: string }> }>,
): Promise<{
  candidateCount: number;
  unusedCount: number;
  results: AssetCleanupResult[];
}> {
  const targetIds: string[] = [];
  const mainId = extractCloudinaryPublicId(targetRecipe.image);
  if (mainId) targetIds.push(mainId);

  if (Array.isArray(targetRecipe.gallery)) {
    for (const item of targetRecipe.gallery) {
      const gId = item.publicId || extractCloudinaryPublicId(item.url);
      if (gId && !targetIds.includes(gId)) targetIds.push(gId);
    }
  }

  const unusedIds = findUnusedRecipeAssets(targetRecipe, allOtherRecipes);
  const results: AssetCleanupResult[] = [];

  const config = getCloudinaryConfig();
  if (!config.isConfigured) {
    for (const id of unusedIds) {
      results.push({
        publicId: id,
        status: 'failed',
        error: 'Cloudinary credentials not configured on server.',
      });
    }
    return { candidateCount: targetIds.length, unusedCount: unusedIds.length, results };
  }

  for (const id of unusedIds) {
    try {
      await deleteCloudinaryAsset(id);
      results.push({ publicId: id, status: 'deleted' });
    } catch (err) {
      results.push({
        publicId: id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    candidateCount: targetIds.length,
    unusedCount: unusedIds.length,
    results,
  };
}

/**
 * Generates an optimized Cloudinary delivery URL with width and auto formatting.
 */
export function getOptimizedCloudinaryUrl(url: string, width?: number): string {
  if (!url || !url.includes('res.cloudinary.com')) {
    return url;
  }

  const uploadIndex = url.indexOf('/upload/');
  if (uploadIndex === -1) return url;

  const transformations = ['f_auto', 'q_auto'];
  if (width) {
    transformations.push(`w_${width}`, 'c_limit');
  }

  const transformString = transformations.join(',');
  return `${url.slice(0, uploadIndex + 8)}${transformString}/${url.slice(uploadIndex + 8)}`;
}
