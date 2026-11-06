import { createRound } from '../services/round.service.js';

export async function createRoundController(req, res) {
  const result = await createRound(
    req.valid.params.orderId,
    req.valid.body.items,
    req.user,
  );
  res.status(201).json(result);
}
