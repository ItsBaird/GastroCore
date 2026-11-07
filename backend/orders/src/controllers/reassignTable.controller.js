import { reassignTable } from '../services/reassignTable.service.js';

export async function reassignTableController(req, res) {
  res.json(await reassignTable(req.valid.params.id, req.valid.body.waiterId, req.user));
}
