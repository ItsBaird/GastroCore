import { randomUUID } from 'node:crypto';
import { photoRepository } from '../repositories/photo.repository.js';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB (GC-CAT-0001)
export const PHOTOS_URL_PREFIX = '/api/catalog/photos/';

// Tipo MIME de cada extension que se guarda (el SVG solo lo usan las fotos de relleno del seed demo)
export const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

// Nombres validos de una foto: los que genera savePhoto (<uuid>.jpg|png|webp) y los del seed (seed-<slug>.svg).
// Cualquier otro nombre ni se consulta a la base.
const FILENAME_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)|seed-[a-z0-9-]{1,60}\.svg)$/;

export const isPhotoFilename = (filename) => FILENAME_RE.test(filename);

// Se decide por el contenido real (firma del archivo), no por el nombre ni el Content-Type
// que declara el cliente, que se pueden falsificar (RNF-04).
export function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

// Guarda la foto en la base (tabla product_photos). El nombre lo genera el servidor: el del cliente nunca se usa.
// Devuelve el nombre y la URL publica que queda en products.photo_url.
export async function savePhoto(buffer, ext) {
  const filename = `${randomUUID()}.${ext}`;
  await photoRepository.create({ filename, mimeType: MIME_BY_EXT[ext], content: buffer });
  return { filename, url: PHOTOS_URL_PREFIX + filename };
}

// Borrado de mejor esfuerzo (por ejemplo, al revertir una creacion fallida o al reemplazar la foto)
export async function deletePhoto(filename) {
  try {
    await photoRepository.delete(filename);
  } catch {
    // ya no existe o no se pudo borrar: no debe ocultar el error original
  }
}

// La foto para servirla: { mimeType, content } o null si el nombre no es valido o no existe
export async function getPhoto(filename) {
  if (!isPhotoFilename(filename)) return null;
  const photo = await photoRepository.findByFilename(filename);
  return photo ? { mimeType: photo.mimeType, content: Buffer.from(photo.content) } : null;
}
