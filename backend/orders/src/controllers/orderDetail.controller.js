import { getOrderDetail } from '../services/orderDetail.service.js';

export async function getOrderDetailController(req, res) {
  const order = await getOrderDetail(req.valid.params.orderId, req.user);
  res.json(order);
}
