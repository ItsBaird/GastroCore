import { Router } from 'express';
import { listOpenByWaiter } from '../controllers/table.controller.js';
import { requireServiceToken } from '../middlewares/serviceToken.js';
import { validate } from '../middlewares/validate.js';
import { openTablesQuerySchema } from '../schemas/table.schema.js';

export const internalRouter = Router();

// /internal/health (sin token) sigue en app.js: solo comprueba que el gateway bloquea /internal
internalRouter.use('/tables', requireServiceToken());

// REQ-F02-04: Staff lo consulta antes de finalizar un turno
internalRouter.get('/tables/open', validate({ query: openTablesQuerySchema }), listOpenByWaiter);
