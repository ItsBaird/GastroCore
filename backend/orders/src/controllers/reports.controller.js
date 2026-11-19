import { confirmCashClose, getCashClosePreview } from '../services/cashClose.service.js';
import { getCashClosureByDate, listCashClosures } from '../services/cashClosures.service.js';

export async function cashClosePreviewController(req, res) {
  res.json(await getCashClosePreview(req.valid.query.date));
}

export async function confirmCashCloseController(req, res) {
  res.status(201).json(await confirmCashClose(req.valid.body.date, req.user));
}

export async function listCashClosuresController(req, res) {
  res.json(await listCashClosures(req.valid.query));
}

export async function getCashClosureController(req, res) {
  res.json(await getCashClosureByDate(req.valid.params.date));
}
