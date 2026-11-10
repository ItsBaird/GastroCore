import { catalogClient } from '../clients/catalogClient.js';
import { AppError } from '../errors/AppError.js';
import { mapKitchenRound, mapRound } from '../mappers/item.mapper.js';
import { emitRoundCreated, emitTableStatusChanged } from '../realtime/events.js';
import { createRoundInOpenOrder, findOrderById } from '../repositories/round.repository.js';
import { getTableStatus } from './tableStatus.service.js';

const orderNotOpen = () =>
  new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'Solo se pueden agregar rondas a órdenes abiertas',
  });

// Consulta el catalogo y toma el snapshot de nombre y precio (R3) de cada item. Un producto inexistente o
// agotado no se pide: va en `unavailable` con su nombre (o "Producto desconocido"). Se exporta para que la
// confirmacion de una solicitud QR (resolveQrRequest.service.js) aplique exactamente las mismas reglas.
export async function snapshotItems(items) {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await catalogClient.getProductsByIds(productIds);
  const byId = new Map(products.map((product) => [product.productId, product]));

  const available = [];
  const unavailable = [];
  for (const item of items) {
    const product = byId.get(item.productId);
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
  return { available, unavailable };
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

  if (order.status !== 'ABIERTA') throw orderNotOpen();

  if (user.role === 'WAITER' && order.waiterId !== user.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No tienes asignada esta mesa',
    });
  }

  const { available, unavailable } = await snapshotItems(items);

  if (available.length === 0) {
    throw new AppError({
      status: 409,
      code: 'NO_AVAILABLE_ITEMS',
      message: 'Ninguno de los productos solicitados está disponible',
      details: { unavailable },
    });
  }

  // La orden se vuelve a comprobar con candado: si paso a cobro mientras se consultaba el catalogo, no se crea
  const round = await createRoundInOpenOrder({
    orderId,
    source: 'WAITER',
    createdBy: user.userId,
    items: available,
  });
  if (round === null) throw orderNotOpen();

  const mappedRound = mapRound(round);

  emitRoundCreated(mapKitchenRound(round, order.table.tableNumber));

  // El panel cambia de "Tomar Pedido" a "Ver Detalle" segun itemsCount
  const tableStatus = await getTableStatus(order.tableId);
  if (tableStatus) emitTableStatusChanged(tableStatus);

  const response = { round: mappedRound };
  if (unavailable.length > 0) {
    response.unavailable = unavailable;
  }
  return response;
}
