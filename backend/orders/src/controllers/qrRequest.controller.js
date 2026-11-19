import { listPendingQrRequests } from '../services/listQrRequests.service.js';
import { confirmQrRequest, rejectQrRequest } from '../services/resolveQrRequest.service.js';

export async function listQrRequestsController(req, res) {
  res.json(await listPendingQrRequests(req.user));
}

export async function confirmQrRequestController(req, res) {
  res.json(await confirmQrRequest(req.valid.params.id, req.valid.body, req.user));
}

export async function rejectQrRequestController(req, res) {
  res.json(await rejectQrRequest(req.valid.params.id, req.user));
}
