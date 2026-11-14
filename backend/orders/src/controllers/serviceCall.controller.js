import { attendServiceCall } from '../services/attendServiceCall.service.js';

export async function attendServiceCallController(req, res) {
  res.json(await attendServiceCall(req.valid.params.id, req.user));
}
