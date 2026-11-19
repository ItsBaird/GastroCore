// Mapea items y rondas al JSON del contrato (camelCase, snapshots R3, dinero Int R5).
// items no tiene columna cancelled_at: el "cuando" fiable de una anulacion vive en audit_log.performed_at.
export function mapItem(item) {
  return {
    itemId: item.itemId,
    roundId: item.roundId,
    productId: item.productId,
    productName: item.productNameSnapshot,
    unitPrice: item.unitPriceSnapshot,
    quantity: item.quantity,
    note: item.note,
    status: item.status,
    preparationStartedAt: item.preparationStartedAt,
    readyAt: item.readyAt,
    deliveredAt: item.deliveredAt,
    cancelledReason: item.cancelledReason,
    cancelledBy: item.cancelledBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// KitchenRound del contrato: el mismo cuerpo en GET /kitchen y en el evento round:created.
export function mapKitchenRound(round, tableNumber) {
  return {
    roundId: round.roundId,
    orderId: round.orderId,
    tableNumber,
    source: round.source,
    createdAt: round.createdAt,
    items: round.items.map(mapItem),
  };
}

export function mapRound(round) {
  return {
    roundId: round.roundId,
    orderId: round.orderId,
    source: round.source,
    createdBy: round.createdBy,
    createdAt: round.createdAt,
    items: round.items.map(mapItem),
  };
}
