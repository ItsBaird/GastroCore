import { cancelItem } from '../services/cancelItem.service.js';
import { deliverItem } from '../services/deliverItem.service.js';
import { updateItemStatus } from '../services/itemStatus.service.js';

export async function cancelItemController(req, res) {
  const item = await cancelItem(req.valid.params.id, req.valid.body.reason, req.user);
  res.json(item);
}

export async function deliverItemController(req, res) {
  res.json(await deliverItem(req.valid.params.id, req.user));
}

export async function updateItemStatusController(req, res) {
  res.json(await updateItemStatus(req.valid.params.id, req.valid.body.status));
}
