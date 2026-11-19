import { correctOrderPaymentMethod } from '../services/paymentCorrection.service.js';

export async function correctPaymentMethodController(req, res) {
  res.json(await correctOrderPaymentMethod(req.valid.params.orderId, req.valid.body, req.user));
}
