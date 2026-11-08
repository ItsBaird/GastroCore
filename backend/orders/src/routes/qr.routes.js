import { Router } from 'express';
import { callWaiterController } from '../controllers/qr.controller.js';

export const qrRouter = Router();

// Canal QR publico: SIN authenticate (el cliente no inicia sesion). El gateway limita las peticiones por IP
// (zona public_qr) y responde 429. El token del QR es la unica credencial; ver RNF de seguridad del canal QR.
qrRouter.post('/:token/call', callWaiterController);
