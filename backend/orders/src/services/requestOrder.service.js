import { catalogClient } from '../clients/catalogClient.js';
import { AppError } from '../errors/AppError.js';
import { emitQrRequestCreated } from '../realtime/qrRequestEvents.js';
import {
  countPendingQrRequests,
  createQrRequestWithItems,
} from '../repositories/qrRequest.repository.js';
import { resolveQrTable, tableNotFound } from './qrTable.js';

// Tope de solicitudes por revisar en una misma orden. El canal es publico y el token de la mesa esta impreso
// en el QR: sin un tope, cualquiera con la mesa a la vista podria llenar la pantalla del mesero. Es un limite
// suave (dos envios simultaneos podrian pasar el tope por una); el gateway ya limita las peticiones por IP.
export const MAX_PENDING_PER_ORDER = 3;

// QrRequest del contrato. Los items se devuelven como se enviaron (ya normalizados), sin campos internos.
function toQrRequest(created, items) {
  return {
    qrRequestId: created.qrRequestId,
    orderId: created.orderId,
    status: created.status,
    createdAt: created.createdAt,
    resolvedAt: created.resolvedAt ?? null,
    resolvedBy: created.resolvedBy ?? null,
    items: items.map(({ productId, quantity, note }) => ({
      productId,
      quantity,
      ...(note ? { note } : {}),
    })),
  };
}

// GC-QR-0003. Endpoint publico: la unica credencial es el token de la mesa. Reglas, en este orden:
//   - Mesa libre -> 409 TABLE_NOT_OPEN (alguien debe abrirla primero).
//   - Mesa en cobro -> 409 INVALID_TRANSITION (ya no se aceptan pedidos; igual que agregar rondas).
//   - Demasiadas solicitudes pendientes -> 409 CONFLICT.
//   - Producto que no existe -> 400; producto agotado -> 409 con la lista. Se rechaza la solicitud completa:
//     recortar en silencio lo que el cliente pidio seria peor. El mesero sigue pudiendo ajustar al confirmar.
// El precio NO se guarda aqui: el snapshot (R3) se toma cuando el mesero confirma y se crea la ronda.
export async function requestOrder(qrToken, items) {
  const { tableNumber, order } = await resolveQrTable(qrToken);

  if (!order) {
    throw new AppError({
      status: 409,
      code: 'TABLE_NOT_OPEN',
      message: 'La mesa todavia no esta abierta: pide a un mesero que la abra',
    });
  }
  if (order.status !== 'ABIERTA') {
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'La mesa esta en cobro: ya no se aceptan solicitudes de pedido',
    });
  }

  if ((await countPendingQrRequests(order.orderId)) >= MAX_PENDING_PER_ORDER) {
    throw new AppError({
      status: 409,
      code: 'CONFLICT',
      message: 'Ya hay solicitudes pendientes de revision: espera a que el mesero las atienda',
      details: { pending: MAX_PENDING_PER_ORDER },
    });
  }

  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await catalogClient.getProductsByIds(productIds);
  const byId = new Map(products.map((product) => [product.productId, product]));

  const unknown = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !byId.has(item.productId));
  if (unknown.length > 0) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Datos de entrada invalidos',
      details: {
        fields: unknown.map(({ index }) => ({
          path: `items.${index}.productId`,
          message: 'El producto no existe',
        })),
      },
    });
  }

  const unavailable = productIds
    .map((id) => byId.get(id))
    .filter((product) => !product.isAvailable)
    .map(({ productId, name }) => ({ productId, name }));
  if (unavailable.length > 0) {
    throw new AppError({
      status: 409,
      code: 'CONFLICT',
      message: 'Algunos productos ya no estan disponibles',
      details: { unavailable },
    });
  }

  let created;
  try {
    created = await createQrRequestWithItems({ orderId: order.orderId, items });
  } catch (err) {
    // La orden se cerro entre la consulta y el alta (FK): la mesa ya no esta abierta
    if (err?.code === 'P2003') throw tableNotFound();
    throw err;
  }

  const qrRequest = toQrRequest(created, items);
  // La solicitud ya esta guardada: si falla el aviso en tiempo real no se deshace ni se responde error.
  try {
    emitQrRequestCreated({ qrRequest, tableNumber, waiterId: order.waiterId });
  } catch (err) {
    console.error('No se pudo emitir qr_request:created', err);
  }

  return qrRequest;
}
