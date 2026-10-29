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
 * Generates an optimized Cloudinary delivery URL with width and auto formatting.
 */
export function getOptimizedCloudinaryUrl(url: string, width?: number): string {
  if (!url || !url.includes('res.cloudinary.com')) {
    return url;
  }

  // Example: https://res.cloudinary.com/<cloud>/image/upload/v1234/path.jpg
  // Target: https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto,w_<width>,c_limit/v1234/path.jpg
  const uploadIndex = url.indexOf('/upload/');
  if (uploadIndex === -1) return url;

  const transformations = ['f_auto', 'q_auto'];
  if (width) {
    transformations.push(`w_${width}`, 'c_limit');
  }

  const transformString = transformations.join(',');
  return `${url.slice(0, uploadIndex + 8)}${transformString}/${url.slice(uploadIndex + 8)}`;
}
