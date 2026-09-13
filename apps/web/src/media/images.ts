export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';
export const IMAGE_UPLOAD_MAX_BYTES = 10_000_000;

const allowedImageTypes = new Set(IMAGE_UPLOAD_ACCEPT.split(','));

export function validateImageFile(file: File): string | undefined {
  if (file.size === 0) return 'Choose an image that is not empty.';
  if (!allowedImageTypes.has(file.type.toLowerCase())) {
    return 'Choose a JPEG, PNG, or WebP image.';
  }
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
    return 'Choose an image smaller than 10 MB.';
  }
  return undefined;
}

export function formatImageBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.ceil(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
