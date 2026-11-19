import { catalogClientMock } from './catalogClient.mock.js';
import { catalogClientHttp } from './catalogClient.http.js';

const useMock = process.env.CATALOG_CLIENT_MOCK === 'true';

if (process.env.NODE_ENV === 'production') {
  // docker-compose activa el mock por defecto: en produccion venderia con precios de prueba
  if (useMock) {
    throw new Error('CATALOG_CLIENT_MOCK no se puede usar en producción');
  }
  if (!process.env.CATALOG_SERVICE_URL || !process.env.SERVICE_TOKEN) {
    throw new Error('CATALOG_SERVICE_URL y SERVICE_TOKEN son requeridos en producción');
  }
}

export const catalogClient = useMock ? catalogClientMock : catalogClientHttp;
