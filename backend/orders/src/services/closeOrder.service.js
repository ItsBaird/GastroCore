import { AppError } from '../errors/AppError.js';
import { emitOrderUpdated, emitTableStatusChanged } from '../realtime/events.js';
import { findOrderForBill } from '../repositories/bill.repository.js';
import { closeOrderWithoutPayment } from '../repositories/closeOrder.repository.js';
import { getTableStatus } from './tableStatus.service.js';

// POST /:orderId/close. El mesero asignado o el ADMIN cierran sin cobro una mesa que se abrio por error y la dejan
// libre.
//   - Solo con la orden ABIERTA: en cobro se cancela el cobro primero; cerrada ya no aplica.
//   - Sin items que no esten cancelados: lo pedido se anula antes (queda en auditoria) y lo entregado se cobra.
//     Asi no sirve para dejar de cobrar algo.
// La ruta exige WAITER o ADMIN (requireRole); aqui se valida que el WAITER sea el asignado y las reglas de la orden.

function invalidTransition(message, details) {
  return new AppError({ status: 409, code: 'INVALID_TRANSITION', message, details });
}

const activeItems = (order) =>
  order.rounds.flatMap((round) =>
    round.items
      .filter((item) => item.status !== 'cancelado')
      .map((item) => ({
        itemId: item.itemId,
        productName: item.productNameSnapshot,
        status: item.status,
      })),
  );

function assertClosable(order) {
  if (order.status === 'CERRADA') throw invalidTransition('La mesa ya está cerrada');
  if (order.status === 'EN_COBRO') {
    throw invalidTransition('La mesa está en cobro: cancela el cobro antes de cerrarla');
  }
  const items = activeItems(order);
  if (items.length > 0) {
    throw invalidTransition('Anula los productos de la mesa antes de cerrarla sin cobro', {
      activeItems: items,
    });
  }
}

export async function closeOrder(orderId, user) {
  const order = await findOrderForBill(orderId);
  if (!order) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'La orden no existe' });
  if (user.role === 'WAITER' && order.waiterId !== user.userId) {
    throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'No tienes asignada esta mesa' });
  }
  assertClosable(order);

  const result = await closeOrderWithoutPayment({
    orderId,
    tableId: order.tableId,
    userId: user.userId,
    auditDetails: { tableNumber: order.table.tableNumber, waiterId: order.waiterId },
  });

  if (!result) {
    // Algo cambio entre la lectura y la escritura (otro cierre, una ronda nueva, paso a cobro): se explica con
    // el estado real
    const fresh = await findOrderForBill(orderId);
    if (fresh) assertClosable(fresh);
    throw invalidTransition('La mesa cambió mientras la cerrabas; revísala e inténtalo de nuevo');
  }

  // La orden ya esta cerrada: si falla un aviso en tiempo real no se deshace ni se responde error
  try {
    const tableStatus = await getTableStatus(order.tableId);
    if (tableStatus) emitTableStatusChanged(tableStatus);
    emitOrderUpdated(
      { orderId, tableNumber: order.table.tableNumber, status: 'CERRADA', discountAmount: 0 },
      order.waiterId,
    );
  } catch (err) {
    console.error('No se pudo emitir el aviso del cierre de la mesa', err);
  }

  return {
    orderId,
    tableNumber: order.table.tableNumber,
    status: 'CERRADA',
    closedAt: result.closedAt,
    rejectedQrRequests: result.rejectedQrRequests,
    attendedServiceCalls: result.attendedServiceCalls,
  };
}
