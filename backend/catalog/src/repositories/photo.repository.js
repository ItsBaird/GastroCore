import { prisma } from '../config/prisma.js';

// Fotos de productos en la tabla product_photos (ver db/init/schema/catalog.sql). En Render gratis no hay disco
// persistente: por eso viven en la base y no en una carpeta.
export const photoRepository = {
  create: ({ filename, mimeType, content }) =>
    prisma.productPhoto.create({ data: { filename, mimeType, content } }),

  // Para el seed: crea la foto solo si no existe (no pisa una que ya este)
  createIfMissing: async ({ filename, mimeType, content }) => {
    const { count } = await prisma.productPhoto.createMany({
      data: [{ filename, mimeType, content }],
      skipDuplicates: true,
    });
    return count === 1;
  },

  findByFilename: (filename) =>
    prisma.productPhoto.findUnique({
      where: { filename },
      select: { mimeType: true, content: true },
    }),

  // deleteMany no falla si la foto ya no existe
  delete: (filename) => prisma.productPhoto.deleteMany({ where: { filename } }),
};
