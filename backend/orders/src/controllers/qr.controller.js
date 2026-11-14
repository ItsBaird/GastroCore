import { callWaiter } from '../services/callWaiter.service.js';
import { requestBill } from '../services/requestBill.service.js';
import { requestOrder } from '../services/requestOrder.service.js';

export async function callWaiterController(req, res) {
  res.status(201).json(await callWaiter(req.params.token));
}

export async function requestOrderController(req, res) {
  res.status(201).json(await requestOrder(req.params.token, req.valid.body.items));
}

export async function requestBillController(req, res) {
  res.status(201).json(await requestBill(req.params.token));
}
