import { findOrderStatusForQr } from '../repositories/qrOrderStatus.repository.js';
import { computeBill } from './computeBill.js';
import { resolveQrTable } from './qrTable.js';
import { deriveTableStatus } from './tableState.js';

// GET /qr/:token/order. Publico y de solo lectura: lo que el cliente lleva en su mesa.
//   - requests: solicitudes QR que aun no son ronda (pendientes o rechazadas), con productId para que el
//     frontend ponga el nombre desde el menu publico (qr_request_items no guarda nombre ni precio).
//   - items: lo que ya esta en la orden (rondas del mesero y solicitudes confirmadas), con su estado de cocina.
//     Los cancelados se muestran como cancelados pero no suman.
//   - subtotal, discountAmount y total: los de computeBill (la misma cuenta que ve el mesero).
// Solo la orden sin cerrar de la mesa: nunca la de un cliente anterior. Sin ids de mesa, orden, mesero ni items.
const EMPTY = { requests: [], items: [], subtotal: 0, discountAmount: 0, total: 0 };

export async function getQrOrderStatus(qrToken) {
  const { tableNumber, order } = await resolveQrTable(qrToken);
  if (!order) return { tableNumber, status: 'libre', ...EMPTY };

  const detail = await findOrderStatusForQr(order.orderId);
  // La orden se cerro entre las dos consultas: la mesa ya esta libre
  if (!detail || detail.status === 'CERRADA') return { tableNumber, status: 'libre', ...EMPTY };

  const bill = computeBill({ orderId: order.orderId, ...detail });

  return {
    tableNumber,
    status: deriveTableStatus([detail]),
    requests: detail.qrRequests.map((request) => ({
      status: request.status,
      createdAt: request.createdAt,
      items: request.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        note: item.note,
      })),
    })),
    items: detail.rounds
      .flatMap((round) => round.items)
      .map((item) => ({
        productName: item.productNameSnapshot,
        quantity: item.quantity,
        note: item.note,
        status: item.status,
        lineTotal: item.unitPriceSnapshot * item.quantity,
      })),
    subtotal: bill.subtotal,
    discountAmount: bill.discountAmount,
    total: bill.total,
  };
}
