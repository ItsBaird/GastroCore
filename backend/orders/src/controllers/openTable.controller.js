import { openTable } from '../services/openTable.service.js';

export async function openTableController(req, res) {
  const order = await openTable(req.valid.params.id, req.user.userId);
  res.status(201).json(order);
}
