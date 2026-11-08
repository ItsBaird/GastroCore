import { listPendingQrRequests } from '../services/listQrRequests.service.js';

export async function listQrRequestsController(req, res) {
  res.json(await listPendingQrRequests(req.user));
}
