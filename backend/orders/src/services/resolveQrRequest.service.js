import { catalogClient } from '../clients/catalogClient.js';
import { AppError } from '../errors/AppError.js';
import { mapKitchenRound, mapRound } from '../mappers/item.mapper.js';
import { emitRoundCreated, emitTableStatusChanged } from '../realtime/events.js';
import {
  confirmQrRequestWithRound,
  findQrRequestForResolution,
  markQrRequestRejected,
} from '../repositories/qrRequest.repository.js';
import { getTableStatus } from './tableStatus.service.js';

const notFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'La solicitud no existe' });

const alreadyResolved = () =>
  new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'La solicitud ya fue resuelta',
  });

const orderNotOpen = () =>
  new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'Solo se pueden agregar rondas a órdenes abiertas',
  });

// QrRequest del contrato (la misma forma que devuelve POST /qr/:token/request)
function toQrRequest(request) {
  return {
    qrRequestId: request.qrRequestId,
    orderId: request.orderId,
    status: request.status,
    createdAt: request.createdAt,
    resolvedAt: request.resolvedAt ?? null,
    resolvedBy: request.resolvedBy ?? null,
    items: request.items.map(({ productId, quantity, note }) => ({
      productId,
      quantity,
      ...(note ? { note } : {}),
    })),
  };
}

// Carga la solicitud y comprueba lo comun a confirmar y rechazar: que exista, que sea de una mesa del
// mesero (el ADMIN puede con cualquiera; igual que al crear rondas) y que siga pendiente.
async function loadPendingRequest(qrRequestId, user) {
  const request = await findQrRequestForResolution(qrRequestId);
  if (!request) throw notFound();

  if (user.role === 'WAITER' && request.order.waiterId !== user.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No tienes asignada esta mesa',
    });
  }
  if (request.status !== 'pendiente') throw alreadyResolved();
  return request;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// DUPLICACION CONOCIDA (opcion A): esta funcion repite la parte de `createRound` (round.service.js, de
// Orders-B) que consulta el catalogo y toma el snapshot de nombre y precio (R3). Esta aislada a proposito:
// cuando `createRound` acepte `source` y `qrRequestId`, se reemplaza por una llamada a el y se borra esto.
// ───────────────────────────────────────────────────────────────────────────────────────────────
async function snapshotItems(items) {
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

// GC-141. El mesero asignado (o el ADMIN) confirma una solicitud pendiente: se crea una ronda con origen QR
// ligada a ella y pasa a cocina como cualquier otra. Sin cuerpo se confirma tal cual; con `items` el mesero
// los ajusta. El snapshot de precios (R3) se toma AHORA, no cuando el cliente la envio.
// Un producto agotado se omite y se informa en `unavailable` (igual que al crear una ronda); si no queda
// ninguno la solicitud sigue pendiente (409 NO_AVAILABLE_ITEMS) para que el mesero la ajuste o la rechace.
export async function confirmQrRequest(qrRequestId, body, user) {
  const request = await loadPendingRequest(qrRequestId, user);
  if (request.order.status !== 'ABIERTA') throw orderNotOpen();

  const items = body?.items ?? request.items;
  const { available, unavailable } = await snapshotItems(items);
  if (available.length === 0) {
    throw new AppError({
      status: 409,
      code: 'NO_AVAILABLE_ITEMS',
      message: 'Ninguno de los productos solicitados está disponible',
      details: { unavailable },
    });
  }

  const round = await confirmQrRequestWithRound({
    qrRequestId,
    orderId: request.orderId,
    resolvedBy: user.userId,
    items: available,
  });
  if (round === null) throw alreadyResolved();
  if (round === 'ORDER_NOT_OPEN') throw orderNotOpen();

  // La ronda ya esta guardada: si falla un aviso en tiempo real no se deshace ni se responde error.
  try {
    emitRoundCreated(mapKitchenRound(round, request.order.table.tableNumber));
    const tableStatus = await getTableStatus(request.order.tableId);
    if (tableStatus) emitTableStatusChanged(tableStatus);
  } catch (err) {
    console.error('No se pudo emitir el aviso de la ronda QR', err);
  }

  const response = { round: { ...mapRound(round), qrRequestId: round.qrRequestId } };
  if (unavailable.length > 0) response.unavailable = unavailable;
  return response;
}

// GC-142. El mesero asignado (o el ADMIN) rechaza una solicitud pendiente: no se crea ronda ni se cobra nada.
// Se permite aunque la mesa ya este en cobro: es la forma de limpiar lo que el cliente pidio y ya no se atiende.
export async function rejectQrRequest(qrRequestId, user) {
  await loadPendingRequest(qrRequestId, user);

  const rejected = await markQrRequestRejected({ qrRequestId, resolvedBy: user.userId });
  if (rejected === null) throw alreadyResolved();
  return toQrRequest(rejected);
}
