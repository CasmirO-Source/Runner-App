import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Picking and preparing a screenshot on the phone (PRD 6.3).
//
// The system photo picker is used, which on current iPhones and Androids
// needs no access to the photo library: the app only ever sees the one image
// the runner picks. The camera is never used.
//
// The picked image is redrawn as a fresh JPEG (which also turns iPhone HEIC
// files into JPEG) and shrunk so its long side is at most 1568 pixels, the
// most Claude uses. That keeps the upload small. The server still checks and
// re-encodes it, because nothing sent from a phone is trusted. The image only
// lives in the phone's temporary files and in memory; the app never saves it.

const LONG_SIDE = 1568;

export type Prepared = { base64: string } | { cancelled: true };

export async function pickScreenshot(): Promise<Prepared> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    exif: false,
    base64: false,
    quality: 1,
  });
  if (picked.canceled || picked.assets.length === 0) return { cancelled: true };

  const original = await ImageManipulator.manipulate(picked.assets[0].uri).renderAsync();
  const long = Math.max(original.width, original.height);
  const image =
    long > LONG_SIDE
      ? await ImageManipulator.manipulate(original)
          .resize(original.width >= original.height ? { width: LONG_SIDE } : { height: LONG_SIDE })
          .renderAsync()
      : original;
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!saved.base64) throw new Error('No image data');
  return { base64: saved.base64 };
}
