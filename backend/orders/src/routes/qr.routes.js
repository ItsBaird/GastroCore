import { Router } from 'express';
import {
  callWaiterController,
  requestBillController,
  requestOrderController,
} from '../controllers/qr.controller.js';
import {
  getQrOrderStatusController,
  getQrTableController,
} from '../controllers/qrTable.controller.js';
import { validate } from '../middlewares/validate.js';
import { qrRequestBodySchema } from '../schemas/qrRequest.schema.js';

export const qrRouter = Router();

// Canal QR publico: SIN authenticate (el cliente no inicia sesion). app.js limita las peticiones por IP
// (PUBLIC_RATE_LIMIT por minuto) y responde 429. El token del QR es la unica credencial; ver RNF de seguridad del canal QR.
qrRouter.post('/:token/call', callWaiterController);

// GC-QR-0001. Publico y de solo lectura: estado de la mesa y que puede hacer el cliente (QrTable).
qrRouter.get('/:token', getQrTableController);

// Publico y de solo lectura: solicitudes enviadas y estado de cada item de la orden actual de la mesa.
qrRouter.get('/:token/order', getQrOrderStatusController);

// GC-QR-0003. Publico: el cliente envia productos, cantidades y notas; el servidor decide todo lo demas.
qrRouter.post('/:token/request', validate({ body: qrRequestBodySchema }), requestOrderController);

// GC-QR-0004. Publico: el cliente con la mesa ocupada pide la cuenta; sin cuerpo (no elige mesa ni tipo).
qrRouter.post('/:token/request-bill', requestBillController);
