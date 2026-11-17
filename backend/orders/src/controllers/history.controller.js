import { getSalesHistory } from '../services/history.service.js';

export async function salesHistoryController(req, res) {
  res.json(await getSalesHistory(req.valid.query));
}
