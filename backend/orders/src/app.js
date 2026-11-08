import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { createRateLimiter } from './middlewares/rateLimiter.js';
import { internalRouter } from './routes/internal.routes.js';
import { itemRouter } from './routes/item.routes.js';
import { kitchenRouter } from './routes/kitchen.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { paymentMethodRouter } from './routes/paymentMethod.routes.js';
import { qrRouter } from './routes/qr.routes.js';
import { roundRouter } from './routes/round.routes.js';
import { tableRouter } from './routes/table.routes.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(createRateLimiter());
app.use(express.json({ limit: '1mb' }));

const router = express.Router();
router.get('/health', (req, res) => {
  res.json({ service: env.serviceName, status: 'ok' });
});
// Las rutas estaticas van antes de las parametricas: orderRouter responde a GET /:orderId
// y se tragaria cualquier ruta montada despues.
router.use('/tables', tableRouter);
router.use('/payment-methods', paymentMethodRouter);
router.use('/qr', qrRouter);
router.use('/items', itemRouter);
router.use('/kitchen', kitchenRouter);
router.use('/', orderRouter);
router.use('/:orderId/rounds', roundRouter);
app.use('/api/orders', router);

// Solo sirve para comprobar que el gateway bloquea /internal
app.get('/internal/health', (req, res) => {
  res.json({ service: env.serviceName, internal: true });
});
app.use('/internal', internalRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
