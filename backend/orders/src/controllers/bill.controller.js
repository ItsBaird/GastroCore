import { getBill } from '../services/bill.service.js';

export async function getBillController(req, res) {
  res.json(await getBill(req.valid.params.orderId, req.user));
}
