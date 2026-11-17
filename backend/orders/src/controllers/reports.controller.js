import { confirmCashClose, getCashClosePreview } from '../services/cashClose.service.js';

export async function cashClosePreviewController(req, res) {
  res.json(await getCashClosePreview(req.valid.query.date));
}

export async function confirmCashCloseController(req, res) {
  res.status(201).json(await confirmCashClose(req.valid.body.date, req.user));
}
