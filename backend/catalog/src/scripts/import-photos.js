// Pasa a la tabla product_photos las fotos que ya estaban en la carpeta de fotos (UPLOADS_DIR, el volumen de Docker
// de antes). Solo hace falta una vez en bases que ya existian (local o de un companero); una base nueva no tiene
// fotos en disco. Uso: docker compose exec -T catalog npm run --silent photos:import
// Es idempotente: una foto que ya esta en la tabla no se toca. No borra nada de la carpeta.
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { photoRepository } from '../repositories/photo.repository.js';
import { MAX_PHOTO_BYTES, MIME_BY_EXT, isPhotoFilename } from '../services/photo.service.js';

async function main() {
  let names;
  try {
    names = await fs.readdir(env.uploadsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`No existe ${env.uploadsDir}: no hay fotos que pasar.`);
      return;
    }
    throw err;
  }

  const counts = { imported: 0, existing: 0, skipped: 0 };
  for (const filename of names) {
    const ext = path.extname(filename).slice(1);
    if (!isPhotoFilename(filename) || !MIME_BY_EXT[ext]) {
      console.log(`  se omite "${filename}": no es un nombre de foto valido`);
      counts.skipped += 1;
      continue;
    }
    const content = await fs.readFile(path.join(env.uploadsDir, filename));
    if (content.length === 0 || content.length > MAX_PHOTO_BYTES) {
      console.log(`  se omite "${filename}": tamaño fuera de rango (${content.length} bytes)`);
      counts.skipped += 1;
      continue;
    }
    const created = await photoRepository.createIfMissing({
      filename,
      mimeType: MIME_BY_EXT[ext],
      content,
    });
    counts[created ? 'imported' : 'existing'] += 1;
  }

  console.log(
    `Fotos: ${counts.imported} pasadas a la base, ${counts.existing} ya estaban, ${counts.skipped} omitidas.`,
  );

  // Productos cuya foto no quedo en la tabla (responderian 404): se avisan para volver a subirlas
  const products = await prisma.product.findMany({ select: { name: true, photoUrl: true } });
  const missing = [];
  for (const p of products) {
    const filename = p.photoUrl.split('/').pop();
    if (!(await photoRepository.findByFilename(filename))) missing.push(p.name);
  }
  if (missing.length > 0) {
    console.log(`Productos sin foto en la base (hay que volver a subirla): ${missing.join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
