import jsQR from 'jsqr';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const MAX_PIXELS = 25e6; // garde-fou mémoire : au-delà, on refuse l'image

/** Décode une image (JPEG ou PNG) en pixels RGBA, ou null si le format n'est pas géré. */
function toRgba(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const img = jpeg.decode(buffer, { useTArray: true, maxResolutionInMP: 25, formatAsRGBA: true });
    return { data: img.data, width: img.width, height: img.height };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const img = PNG.sync.read(buffer);
    return { data: img.data, width: img.width, height: img.height };
  }
  return null;
}

/**
 * Transforme une image (JPEG/PNG) en « vidéo » MJPEG de quelques images identiques : c'est le format
 * que Chromium accepte comme fausse caméra (--use-file-for-fake-video-capture). Le robot s'en sert
 * pour présenter ton QR au scanner de SoWeSoft, comme si tu le filmais. null si l'image est illisible.
 */
export function toMjpeg(buffer, frames = 15) {
  try {
    const img = buffer?.length ? toRgba(buffer) : null;
    if (!img || img.width * img.height > MAX_PIXELS) return null;
    const frame = jpeg.encode({ data: img.data, width: img.width, height: img.height }, 90).data; // JPEG propre, sans miniature EXIF
    return Buffer.concat(Array.from({ length: frames }, () => frame));
  } catch {
    return null;
  }
}

/**
 * Lit le QR code d'une photo/capture (JPEG ou PNG) et renvoie son contenu texte, ou null si aucun
 * QR n'est lisible. Ne lance jamais d'exception (image corrompue, format inconnu → null).
 */
export function decodeQr(buffer) {
  try {
    if (!buffer?.length) return null;
    const img = toRgba(buffer);
    if (!img || img.width * img.height > MAX_PIXELS) return null;
    const result = jsQR(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height, {
      inversionAttempts: 'attemptBoth', // QR clair sur fond sombre aussi
    });
    return result?.data || null;
  } catch {
    return null;
  }
}
