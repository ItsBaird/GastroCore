import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { createRateLimiter } from './middlewares/rateLimiter.js';

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
app.use('/api/__SERVICE__', router);

// Solo sirve para comprobar que el gateway bloquea /internal
app.get('/internal/health', (req, res) => {
  res.json({ service: env.serviceName, internal: true });
});

app.use(notFound);
app.use(errorHandler);

export default app;
