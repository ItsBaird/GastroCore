import { listTableStatuses } from '../services/tableStatus.service.js';

export async function getTableStatuses(req, res) {
  res.json(await listTableStatuses());
}
