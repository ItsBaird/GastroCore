// Categorias y productos de demostracion. Uso: docker compose exec catalog npm run seed:demo
// Idempotente. Si ya existe una categoria o un producto con ese nombre se respeta (y se avisa si el producto tiene
// otro id, porque entonces sus ordenes de ejemplo en Orders no coincidiran con el del catalogo).
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { PHOTOS_URL_PREFIX } from '../services/photo.service.js';
import { CATEGORIES, PRODUCTS, photoFileName, placeholderSvg } from './demo/data.js';
import { assertDemoSeedAllowed, seedUuid } from './demo/ids.js';

async function seedCategories() {
  const ids = new Map();
  let created = 0;
  for (const demo of CATEGORIES) {
    const existing = await prisma.category.findUnique({ where: { name: demo.name } });
    if (existing) {
      ids.set(demo.name, existing.categoryId);
      continue;
    }
    const category = await prisma.category.create({
      data: {
        categoryId: seedUuid(`category:${demo.name}`),
        name: demo.name,
        displayOrder: demo.displayOrder,
      },
    });
    ids.set(demo.name, category.categoryId);
    created += 1;
  }
  console.log(
    `Categorias de demostracion: ${created} creadas, ${CATEGORIES.length - created} ya existian.`,
  );
  return ids;
}

// La foto es obligatoria en la base: se deja un SVG de relleno en el volumen de fotos (sin pisar uno existente)
async function writePlaceholder(product, tint) {
  await fs.mkdir(env.uploadsDir, { recursive: true });
  try {
    await fs.writeFile(
      path.join(env.uploadsDir, photoFileName(product.slug)),
      placeholderSvg({ name: product.name, tint }),
      { flag: 'wx' },
    );
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function seedProducts(categoryIds) {
  const tints = new Map(CATEGORIES.map((c) => [c.name, c.tint]));
  let created = 0;
  for (const demo of PRODUCTS) {
    const categoryId = categoryIds.get(demo.category);
    const existing = await prisma.product.findFirst({ where: { categoryId, name: demo.name } });
    if (existing) {
      if (existing.productId !== seedUuid(`product:${demo.slug}`)) {
        console.log(
          `  ya existia "${demo.name}" con otro id: sus ordenes de ejemplo no coincidiran con el catalogo`,
        );
      }
      continue;
    }
    await writePlaceholder(demo, tints.get(demo.category));
    await prisma.product.create({
      data: {
        productId: seedUuid(`product:${demo.slug}`),
        categoryId,
        name: demo.name,
        description: demo.description,
        price: demo.price,
        photoUrl: PHOTOS_URL_PREFIX + photoFileName(demo.slug),
        isAvailable: demo.isAvailable ?? true,
      },
    });
    created += 1;
  }
  console.log(
    `Productos de demostracion: ${created} creados, ${PRODUCTS.length - created} ya existian.`,
  );
}

try {
  assertDemoSeedAllowed();
  await seedProducts(await seedCategories());
} catch (err) {
  console.error(`No se pudo ejecutar el seed de demostracion: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
