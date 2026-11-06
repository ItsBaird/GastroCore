import { catalogClient } from '../clients/catalogClient.js';
import { AppError } from '../errors/AppError.js';
import { emitRoundCreated } from '../realtime/events.js';
import {
  createRoundWithItems,
  findOrderById,
} from '../repositories/round.repository.js';

function mapItem(item) {
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
    cancelledAt: item.cancelledAt,
    cancelledReason: item.cancelledReason,
    cancelledBy: item.cancelledBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function mapRound(round) {
  return {
    roundId: round.roundId,
    orderId: round.orderId,
    source: round.source,
    createdBy: round.createdBy,
    createdAt: round.createdAt,
    items: round.items.map(mapItem),
  };
}

export async function createRound(orderId, items, user) {
  const order = await findOrderById(orderId);
  if (!order) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'La orden no existe',
    });
  }

  if (order.status !== 'ABIERTA') {
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'Solo se pueden agregar rondas a órdenes abiertas',
    });
  }

  if (user.role === 'WAITER' && order.waiterId !== user.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No tienes asignada esta mesa',
    });
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await catalogClient.getProductsByIds(productIds);
  const productMap = new Map(products.map((p) => [p.productId, p]));

  const available = [];
  const unavailable = [];

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || !product.isAvailable) {
      unavailable.push({
        productId: item.productId,
        name: product?.name || 'Producto desconocido',
      });
    } else {
      available.push({
        productId: item.productId,
        productName: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        note: item.note,
      });
    }
  }

  if (available.length === 0) {
    throw new AppError({
      status: 409,
      code: 'NO_AVAILABLE_ITEMS',
      message: 'Ninguno de los productos solicitados está disponible',
      details: { unavailable },
    });
  }

  const round = await createRoundWithItems({
    orderId,
    source: 'WAITER',
    createdBy: user.userId,
    items: available,
  });

  const mappedRound = mapRound(round);

  emitRoundCreated({
    roundId: round.roundId,
    orderId: round.orderId,
    tableNumber: order.table.tableNumber,
    createdAt: round.createdAt,
    items: mappedRound.items,
  });

  const response = { round: mappedRound };
  if (unavailable.length > 0) {
    response.unavailable = unavailable;
  }
  return response;
}
