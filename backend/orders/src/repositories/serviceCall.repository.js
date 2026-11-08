import { prisma } from '../config/prisma.js';

// Mesa por el token del QR, con el mesero de su orden abierta (si la hay). Una mesa esta "libre" cuando
// no tiene orden sin cerrar; ocupada o en cobro cuando si la tiene (uix_orders_one_open_per_table: una sola).
export async function findTableByQrToken(qrToken) {
  return prisma.diningTable.findUnique({
    where: { qrToken },
    select: {
      tableId: true,
      tableNumber: true,
      orders: {
        where: { status: { not: 'CERRADA' } },
        select: { waiterId: true },
        take: 1,
      },
    },
  });
}

// El indice unico parcial uix_service_calls_one_pending (table_id, type) WHERE status = 'pendiente'
// impide dos llamados pendientes del mismo tipo para la misma mesa: lo hace la base, sin carreras.
// Sirve para 'call_waiter' (GC-QR-0002) y 'request_bill' (GC-QR-0004).
export async function createServiceCall({ tableId, type }) {
  return prisma.serviceCall.create({ data: { tableId, type } });
}
