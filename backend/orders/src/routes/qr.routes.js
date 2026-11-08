import { Router } from 'express';
import { callWaiterController, requestOrderController } from '../controllers/qr.controller.js';
import { validate } from '../middlewares/validate.js';
import { qrRequestBodySchema } from '../schemas/qrRequest.schema.js';

export const qrRouter = Router();

// Canal QR publico: SIN authenticate (el cliente no inicia sesion). El gateway limita las peticiones por IP
// (zona public_qr) y responde 429. El token del QR es la unica credencial; ver RNF de seguridad del canal QR.
qrRouter.post('/:token/call', callWaiterController);

// GC-QR-0003. Publico: el cliente envia productos, cantidades y notas; el servidor decide todo lo demas.
qrRouter.post('/:token/request', validate({ body: qrRequestBodySchema }), requestOrderController);
