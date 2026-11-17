import { getSalesHistory, getSalesHistoryOrder } from '../services/history.service.js';

export async function salesHistoryController(req, res) {
  res.json(await getSalesHistory(req.valid.query));
}

export async function salesHistoryOrderController(req, res) {
  res.json(await getSalesHistoryOrder(req.valid.params.orderId));
}
