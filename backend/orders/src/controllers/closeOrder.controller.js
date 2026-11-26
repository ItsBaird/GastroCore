import { closeOrder } from '../services/closeOrder.service.js';

export async function closeOrderController(req, res) {
  res.json(await closeOrder(req.valid.params.orderId, req.user));
}
