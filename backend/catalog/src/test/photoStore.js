// Tabla product_photos simulada en memoria para las pruebas sin base de datos. Se usa con:
//   vi.mock('../repositories/photo.repository.js', async () => (await import('../test/photoStore.js')).photoMock)
// y se vacia en cada prueba con photoStore.clear(). La verificacion contra PostgreSQL real esta en
// src/test/photos.db.check.js.
export const photoStore = new Map();

export const photoMock = {
  photoRepository: {
    create: async ({ filename, mimeType, content }) => {
      if (photoStore.has(filename)) throw new Error(`foto duplicada: ${filename}`);
      photoStore.set(filename, { mimeType, content: Buffer.from(content) });
      return { filename, mimeType };
    },
    createIfMissing: async ({ filename, mimeType, content }) => {
      if (photoStore.has(filename)) return false;
      photoStore.set(filename, { mimeType, content: Buffer.from(content) });
      return true;
    },
    findByFilename: async (filename) => photoStore.get(filename) ?? null,
    delete: async (filename) => ({ count: photoStore.delete(filename) ? 1 : 0 }),
  },
};

export const storedPhotos = () => [...photoStore.keys()];
