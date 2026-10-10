import {
  AlphaAction,
  ImageMagick,
  initializeImageMagick,
  MagickColor,
  MagickFormat,
  MagickGeometry,
  ResourceLimits,
} from '@imagemagick/magick-wasm';

import { HttpError } from '../_shared/http.ts';

// Checking and cleaning an uploaded screenshot (PRD 6.3, 9.2 rule 9,
// Appendix A #21).
//
// The image only ever exists in this function's memory. It is never written
// to disk, storage or the database, and never logged (PRD 1.2).
//
// Order of checks, cheapest first:
//   1. Size: at most 5 MB.
//   2. Type, from the file's first bytes (never from a name or a header the
//      sender chose): JPEG or PNG only.
//   3. Pixel size, read from the file's own header before decoding, so a
//      small file that would expand into a huge image (a "decompression
//      bomb") is refused without being opened. ImageMagick's own limits are
//      set as a second line of defence.
//   4. Decode with the format fixed to the one detected, so ImageMagick never
//      guesses and never runs any of its other, riskier readers.
//   5. Re-encode: turned upright, every piece of metadata removed (EXIF,
//      location, camera details, comments, colour profiles), any transparency
//      flattened onto white, shrunk to at most 1568 pixels on the long side
//      (the most Claude uses), and saved as a fresh JPEG. Only this new file
//      is sent to Claude.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 4096;
const OUTPUT_LONG_SIDE = 1568;

type Kind = 'jpeg' | 'png';

export type CleanImage = {
  jpeg: Uint8Array;
  // Perceptual fingerprint (dHash) of the cleaned image, as a signed 64-bit
  // number, the way Postgres stores a bigint.
  dhash: bigint;
};

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= (async () => {
    const wasm = await Deno.readFile(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm')));
    await initializeImageMagick(wasm);
    ResourceLimits.width = BigInt(MAX_SIDE);
    ResourceLimits.height = BigInt(MAX_SIDE);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export function detectKind(bytes: Uint8Array): Kind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'png';
  return null;
}

// Width and height from the file header, without decoding any pixels.
export function headerSize(bytes: Uint8Array, kind: Kind): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (kind === 'png') {
    // The first chunk must be IHDR: width and height at bytes 16 and 20.
    if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the segments to the frame header (SOF0 to SOF15, except the
  // DHT, JPG and DAC markers that share the range).
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const length = view.getUint16(i + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

const unreadable = () => new HttpError(415, 'unreadable_image', "We couldn't open that image. Try another screenshot, or type the run in.");

export async function cleanImage(bytes: Uint8Array): Promise<CleanImage> {
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'image_too_large', 'That screenshot is too big. The limit is 5 MB.');
  }
  const kind = detectKind(bytes);
  if (!kind) {
    throw new HttpError(415, 'unsupported_image', 'Use a screenshot saved as JPEG or PNG.');
  }
  const size = headerSize(bytes, kind);
  if (!size || size.width < 1 || size.height < 1) throw unreadable();
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
    throw new HttpError(413, 'image_too_large', 'That screenshot is too big. Try a normal phone screenshot.');
  }

  await init();
  try {
    return ImageMagick.read(bytes, kind === 'jpeg' ? MagickFormat.Jpeg : MagickFormat.Png, (img) => {
      img.autoOrient();
      img.strip();
      img.backgroundColor = new MagickColor('#ffffff');
      img.alpha(AlphaAction.Remove);
      const fit = new MagickGeometry(OUTPUT_LONG_SIDE, OUTPUT_LONG_SIDE);
      fit.greater = true; // only ever shrink
      img.resize(fit);
      img.quality = 85;
      const jpeg = img.write(MagickFormat.Jpeg, (data) => data.slice());

      const gray = img.clone((small) => {
        small.grayscale();
        const thumb = new MagickGeometry(9, 8);
        thumb.ignoreAspectRatio = true;
        small.resize(thumb);
        small.depth = 8;
        return small.write(MagickFormat.Gray, (data) => data.slice());
      });
      return { jpeg, dhash: dhash(gray) };
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw unreadable();
  }
}

// dHash: shrink to 9 by 8 grey pixels, then for each row record whether each
// pixel is brighter than the one to its right. 8 rows of 8 comparisons give 64
// bits. Visually identical images give the same or nearly the same bits.
export function dhash(gray: Uint8Array): bigint {
  if (gray.length !== 72) throw new Error('Unexpected thumbnail size');
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, bits);
}
