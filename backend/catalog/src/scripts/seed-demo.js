// Categorias y productos de demostracion. Uso: docker compose exec catalog npm run seed:demo
// Idempotente. Si ya existe una categoria o un producto con ese nombre se respeta (y se avisa si el producto tiene
// otro id, porque entonces sus ordenes de ejemplo en Orders no coincidiran con el del catalogo).
import { prisma } from '../config/prisma.js';
import { photoRepository } from '../repositories/photo.repository.js';
import { MIME_BY_EXT, PHOTOS_URL_PREFIX } from '../services/photo.service.js';
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

// La foto es obligatoria en la base: se guarda un SVG de relleno en product_photos (sin pisar uno existente)
async function writePlaceholder(product, tint) {
  await photoRepository.createIfMissing({
    filename: photoFileName(product.slug),
    mimeType: MIME_BY_EXT.svg,
    content: Buffer.from(placeholderSvg({ name: product.name, tint }), 'utf8'),
  });
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
