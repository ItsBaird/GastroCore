import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const router = express.Router();
router.get('/health', (req, res) => {
  res.json({ service: env.serviceName, status: 'ok' });
});
app.use('/api/staff', router);

// Solo sirve para comprobar que el gateway bloquea /internal
app.get('/internal/health', (req, res) => {
  res.json({ service: env.serviceName, internal: true });
});

app.use(notFound);
app.use(errorHandler);

export default app;
