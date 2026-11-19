import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB (GC-CAT-0001)
export const PHOTOS_URL_PREFIX = '/api/catalog/photos/';

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

// El nombre lo genera el servidor: el original del cliente nunca toca el sistema de archivos
export async function savePhoto(buffer, ext) {
  await fs.mkdir(env.uploadsDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(env.uploadsDir, filename), buffer, { flag: 'wx' });
  return { filename, url: PHOTOS_URL_PREFIX + filename };
}

// Borrado de mejor esfuerzo (por ejemplo, al revertir una creacion fallida)
export async function deletePhoto(filename) {
  try {
    await fs.unlink(path.join(env.uploadsDir, filename));
  } catch {
    // ya no existe o no se pudo borrar: no debe ocultar el error original
  }
}
