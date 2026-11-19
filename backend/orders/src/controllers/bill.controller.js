import { cancelBill, getBill, startBilling } from '../services/bill.service.js';
import { applyDiscount } from '../services/discount.service.js';

export async function getBillController(req, res) {
  res.json(await getBill(req.valid.params.orderId, req.user));
}

export async function startBillingController(req, res) {
  res.json(await startBilling(req.valid.params.orderId, req.user));
}

export async function cancelBillController(req, res) {
  res.json(await cancelBill(req.valid.params.orderId, req.user));
}

export async function applyDiscountController(req, res) {
  res.json(await applyDiscount(req.valid.params.orderId, req.valid.body, req.user));
}
