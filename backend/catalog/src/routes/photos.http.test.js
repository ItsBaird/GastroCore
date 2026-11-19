// GET /api/catalog/photos/:filename con la app real: la foto sale de la base (tabla product_photos simulada en
// memoria), publica, con su tipo y cache de 7 dias; 404 si no existe o el nombre no es valido.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JPEG, call, startApp } from '../test/helpers.js';
import { photoStore } from '../test/photoStore.js';

vi.mock(
  '../repositories/photo.repository.js',
  async () => (await import('../test/photoStore.js')).photoMock,
);

const NAME = '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.jpg';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

let app;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  photoStore.clear();
});

describe('GET /api/catalog/photos/:filename', () => {
  it('sirve la foto sin token, con su tipo, su contenido y cache de 7 dias inmutable', async () => {
    photoStore.set(NAME, { mimeType: 'image/jpeg', content: JPEG });
    const res = await fetch(`${app.base}/api/catalog/photos/${NAME}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it('sirve las fotos de relleno del seed (SVG)', async () => {
    photoStore.set('seed-pizza-margarita.svg', {
      mimeType: 'image/svg+xml',
      content: Buffer.from(SVG),
    });
    const res = await fetch(`${app.base}/api/catalog/photos/seed-pizza-margarita.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(await res.text()).toBe(SVG);
  });

  it('una foto que no existe -> 404 con el formato de error de la API', async () => {
    const res = await call(app.base, 'GET', `/api/catalog/photos/${NAME}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(['..%2F..%2Fetc%2Fpasswd', 'vieja.jpg', 'x.gif'])(
    'nombre invalido "%s" -> 404',
    async (name) => {
      expect((await call(app.base, 'GET', `/api/catalog/photos/${name}`)).status).toBe(404);
    },
  );

  it('no hay listado de fotos: /photos/ sin nombre -> 404', async () => {
    photoStore.set(NAME, { mimeType: 'image/jpeg', content: JPEG });
    expect((await call(app.base, 'GET', '/api/catalog/photos/')).status).toBe(404);
  });
});
