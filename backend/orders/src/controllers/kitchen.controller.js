import { listKitchenRounds } from '../services/kitchen.service.js';

export async function listKitchenRoundsController(req, res) {
  res.json(await listKitchenRounds());
}
