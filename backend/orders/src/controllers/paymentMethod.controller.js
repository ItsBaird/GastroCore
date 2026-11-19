import {
  createPaymentMethodService,
  listPaymentMethodsService,
  updatePaymentMethodService,
} from '../services/paymentMethod.service.js';

export async function list(req, res) {
  res.json(await listPaymentMethodsService(req.valid.query));
}

export async function create(req, res) {
  res.status(201).json(await createPaymentMethodService(req.valid.body));
}

export async function update(req, res) {
  res.json(await updatePaymentMethodService(req.valid.params.id, req.valid.body));
}
