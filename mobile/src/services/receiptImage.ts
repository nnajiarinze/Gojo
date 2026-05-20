import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type ReceiptImageSource = 'camera' | 'gallery';

export type ReceiptImage = {
  uri: string;
  width: number;
  height: number;
  source: ReceiptImageSource;
};

type CameraInput = {
  source: 'camera';
  uri: string;
  width?: number;
  height?: number;
};

type GalleryInput = {
  source: 'gallery';
};

type RawReceiptImage = {
  uri: string;
  width?: number;
  height?: number;
  source: ReceiptImageSource;
};

const MAX_DIMENSION = 2000;
const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const REJECTED_EXTENSIONS = new Set(['pdf', 'txt', 'doc', 'docx', 'heif-sequence', 'mov', 'mp4']);

export class ReceiptImagePermissionError extends Error {}
export class ReceiptImageValidationError extends Error {}

export async function getReceiptImage(input: CameraInput | GalleryInput): Promise<ReceiptImage | null> {
  if (input.source === 'camera') {
    return normalizeReceiptImage({
      uri: input.uri,
      width: input.width,
      height: input.height,
      source: 'camera',
    });
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ReceiptImagePermissionError('Photo library permission is required to choose a receipt image.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset?.uri) return null;

  validateImageType(asset.uri, asset.mimeType, asset.fileName);

  return normalizeReceiptImage({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    source: 'gallery',
  });
}

function validateImageType(uri: string, mimeType?: string | null, fileName?: string | null) {
  const normalizedMimeType = mimeType?.toLowerCase();
  if (normalizedMimeType && ACCEPTED_MIME_TYPES.has(normalizedMimeType)) return;
  if (normalizedMimeType && !normalizedMimeType.startsWith('image/')) {
    throw new ReceiptImageValidationError('Choose an image file from your photo library.');
  }

  const extension = getExtension(fileName) ?? getExtension(uri);
  if (extension && ACCEPTED_EXTENSIONS.has(extension)) return;
  if (extension && REJECTED_EXTENSIONS.has(extension)) {
    throw new ReceiptImageValidationError('Choose an image file from your photo library.');
  }

  // iOS often returns photo-library assets without a filename extension, or as
  // HEIC/HEIF camera-roll images. The picker is already restricted to images,
  // and normalizeReceiptImage converts supported image assets to JPEG.
}

async function normalizeReceiptImage(image: RawReceiptImage): Promise<ReceiptImage> {
  const actions = resizeActions(image.width, image.height);
  const normalized = await manipulateAsync(
    image.uri,
    actions,
    {
      compress: 0.82,
      format: SaveFormat.JPEG,
    }
  );

  return {
    uri: normalized.uri,
    width: normalized.width,
    height: normalized.height,
    source: image.source,
  };
}

function resizeActions(width?: number, height?: number) {
  if (!width || !height) return [];

  const largestDimension = Math.max(width, height);
  if (largestDimension <= MAX_DIMENSION) return [];

  if (width >= height) {
    return [{ resize: { width: MAX_DIMENSION } }];
  }
  return [{ resize: { height: MAX_DIMENSION } }];
}

function getExtension(value?: string | null): string | null {
  if (!value) return null;
  const clean = value.split('?')[0]?.split('#')[0] ?? value;
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}
