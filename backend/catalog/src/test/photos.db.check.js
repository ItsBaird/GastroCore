// Fotos de productos en la tabla product_photos contra PostgreSQL REAL, en la base aislada catalog_db_test (nunca
// catalog_db). No es un test de vitest (no termina en .test.js): corre con el runner nativo de Node dentro del
// contenedor de catalog:
//
//   docker compose exec -T catalog sh -c \
//     'DATABASE_URL="${DATABASE_URL%/catalog_db}/catalog_db_test" node --test src/test/photos.db.check.js'
//
// Comprueba lo que la tabla en memoria de las pruebas no puede: que los bytes vuelven identicos (BYTEA), las
// restricciones de la tabla (tipo y 2 MB) y que el borrado y el "crear si no existe" del seed funcionan.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../config/prisma.js';
import { photoRepository } from '../repositories/photo.repository.js';
import { MAX_PHOTO_BYTES, deletePhoto, getPhoto, savePhoto } from '../services/photo.service.js';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8cfc0f01f0005000201a1e6a7b40000000049454e44ae426082',
  'hex',
);

async function wipe() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.equal(db, 'catalog_db_test', 'ABORTADO: este chequeo solo corre contra catalog_db_test');
  await prisma.$executeRaw`TRUNCATE product_photos`;
}

before(wipe);
after(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('product_photos (BD real)', () => {
  it('savePhoto + getPhoto: los bytes vuelven identicos, con su tipo', async () => {
    const { filename, url } = await savePhoto(PNG, 'png');
    assert.equal(url, `/api/catalog/photos/${filename}`);
    const photo = await getPhoto(filename);
    assert.equal(photo.mimeType, 'image/png');
    assert.ok(photo.content.equals(PNG));
  });

  it('una foto de 2 MB exactos (el maximo de la subida) se guarda y se lee completa', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(MAX_PHOTO_BYTES - 3)]);
    const { filename } = await savePhoto(big, 'jpg');
    const photo = await getPhoto(filename);
    assert.equal(photo.content.length, MAX_PHOTO_BYTES);
    assert.ok(photo.content.equals(big));
  });

  it('deletePhoto la borra; borrar una que no existe no falla', async () => {
    const { filename } = await savePhoto(PNG, 'png');
    await deletePhoto(filename);
    assert.equal(await getPhoto(filename), null);
    await deletePhoto(filename);
  });

  it('la base rechaza un tipo no permitido, una foto vacia o de mas de 2 MB, y un nombre repetido', async () => {
    const insert = (data) => photoRepository.create({ filename: 'x.gif', ...data });
    await assert.rejects(
      insert({ mimeType: 'image/gif', content: PNG }),
      /chk_product_photos_mime/,
    );
    await assert.rejects(
      insert({ filename: 'v.png', mimeType: 'image/png', content: Buffer.alloc(0) }),
      /chk_product_photos_size/,
    );
    await assert.rejects(
      insert({
        filename: 'g.png',
        mimeType: 'image/png',
        content: Buffer.alloc(MAX_PHOTO_BYTES + 1),
      }),
      /chk_product_photos_size/,
    );
    const { filename } = await savePhoto(PNG, 'png');
    await assert.rejects(
      photoRepository.create({ filename, mimeType: 'image/png', content: PNG }),
      (err) => err.code === 'P2002',
    );
  });

  it('createIfMissing (seed): crea la primera vez y no pisa la existente', async () => {
    const svg = (text) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`);
    const data = { filename: 'seed-prueba.svg', mimeType: 'image/svg+xml' };
    assert.equal(await photoRepository.createIfMissing({ ...data, content: svg('primera') }), true);
    assert.equal(
      await photoRepository.createIfMissing({ ...data, content: svg('segunda') }),
      false,
    );
    const photo = await getPhoto('seed-prueba.svg');
    assert.ok(photo.content.toString().includes('primera'));
  });
});
