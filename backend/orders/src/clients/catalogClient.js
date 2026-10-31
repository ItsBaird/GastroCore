import { catalogClientMock } from './catalogClient.mock.js';
import { catalogClientHttp } from './catalogClient.http.js';

const useMock = process.env.CATALOG_CLIENT_MOCK === 'true';

if (!useMock && process.env.NODE_ENV === 'production') {
  if (!process.env.CATALOG_SERVICE_URL || !process.env.SERVICE_TOKEN) {
    throw new Error(
      'CATALOG_SERVICE_URL y SERVICE_TOKEN son requeridos en producción',
    );
  }
}

export const catalogClient = useMock ? catalogClientMock : catalogClientHttp;
