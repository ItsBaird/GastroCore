import { cancelItem } from '../services/cancelItem.service.js';

export async function cancelItemController(req, res) {
  const item = await cancelItem(req.valid.params.id, req.valid.body.reason, req.user);
  res.json(item);
}
