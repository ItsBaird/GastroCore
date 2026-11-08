import { callWaiter } from '../services/callWaiter.service.js';

export async function callWaiterController(req, res) {
  res.status(201).json(await callWaiter(req.params.token));
}
