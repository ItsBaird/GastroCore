import { mapKitchenRound } from '../mappers/item.mapper.js';
import { findKitchenRounds } from '../repositories/kitchen.repository.js';

export async function listKitchenRounds() {
  const rounds = await findKitchenRounds();
  return rounds.map((round) => mapKitchenRound(round, round.order.table.tableNumber));
}
