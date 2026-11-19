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
        select: { orderId: true, waiterId: true, status: true },
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

// Llamado con la mesa y el mesero de su orden abierta (si la hay), para decidir quien puede atenderlo.
export async function findServiceCallForAttend(serviceCallId) {
  return prisma.serviceCall.findUnique({
    where: { serviceCallId },
    include: {
      table: {
        select: {
          tableId: true,
          orders: {
            where: { status: { not: 'CERRADA' } },
            select: { waiterId: true },
            take: 1,
          },
        },
      },
    },
  });
}

// Atencion atomica: solo cambia si el llamado sigue 'pendiente' (CHECK chk_service_calls_resolution exige
// attended_by y attended_at al atender). Dos meseros, o un mesero y la apertura/pago de la mesa, no se
// pisan: el segundo recibe null. Al dejar de estar pendiente, el indice uix_service_calls_one_pending
// libera el cupo y el cliente puede volver a llamar.
export async function markServiceCallAttended({ serviceCallId, attendedBy }) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.serviceCall.updateMany({
      where: { serviceCallId, status: 'pendiente' },
      data: { status: 'atendido', attendedBy, attendedAt: new Date() },
    });
    if (updated.count === 0) return null;
    return tx.serviceCall.findUnique({ where: { serviceCallId } });
  });
}
