import { registerPayment } from '../services/payment.service.js';

export async function registerPaymentController(req, res) {
  res.status(201).json(await registerPayment(req.valid.params.orderId, req.valid.body, req.user));
}
