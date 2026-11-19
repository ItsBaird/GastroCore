import { Router } from 'express';
import { listForOrders } from '../controllers/product.controller.js';
import { requireServiceToken } from '../middlewares/serviceToken.js';
import { validate } from '../middlewares/validate.js';
import { internalProductsQuerySchema } from '../schemas/product.schema.js';

export const internalRouter = Router();

// /internal/health (sin token) sigue en app.js: solo comprueba que el gateway bloquea /internal
internalRouter.use('/products', requireServiceToken());

// REQ-F03-05: Orders lo consulta al crear una ronda para copiar nombre y precio (snapshot R3)
internalRouter.get('/products', validate({ query: internalProductsQuerySchema }), listForOrders);
