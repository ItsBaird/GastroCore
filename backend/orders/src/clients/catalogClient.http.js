import { AppError } from '../errors/AppError.js';

const CATALOG_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog:3003';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';
const TIMEOUT_MS = 3000;

export const catalogClientHttp = {
  async getProductsByIds(ids) {
    if (ids.length === 0) return [];

    const url = `${CATALOG_URL}/internal/products?ids=${ids.join(',')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: { 'X-Service-Token': SERVICE_TOKEN },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new AppError({
          status: 503,
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'El servicio de catálogo no respondió correctamente',
        });
      }

      return res.json();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError({
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'No se pudo conectar al servicio de catálogo',
      });
    } finally {
      clearTimeout(timer);
    }
  },
};
