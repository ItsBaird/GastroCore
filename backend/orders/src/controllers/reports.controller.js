import { getCashClosePreview } from '../services/cashClose.service.js';

export async function cashClosePreviewController(req, res) {
  res.json(await getCashClosePreview(req.valid.query.date));
}
