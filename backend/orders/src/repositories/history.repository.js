import { prisma } from '../config/prisma.js';

// GC-RPT-0003 (GC-188). Consultas del historial de ventas.
//
// Una venta del historial es una orden CERRADA con su pago, cuyo cierre cae en [start, end) (dias de negocio, ver
// businessDay.js): la MISMA regla que el cierre de caja (reports.repository.js), para que los totales coincidan.
// Filtros opcionales: waiterId = quien ABRIO la mesa (orders.opened_by, como en el cierre), tableId y el metodo
// con que se pago. Una orden cerrada siempre tiene pago (el cobro la cierra), pero se exige igual.
function orderWhere({ start, end, waiterId, tableId }) {
  return {
    status: 'CERRADA',
    closedAt: { gte: start, lt: end },
    ...(waiterId && { openedBy: waiterId }),
    ...(tableId && { tableId }),
  };
}

// Una pagina de ventas: la mas reciente primero; con el mismo instante de cierre, por orderId para que el orden
// sea estable entre paginas (sin desempate una fila podria repetirse o perderse al pasar de pagina).
export async function findHistoryPage({ skip, take, paymentMethodId, ...filters }) {
  return prisma.order.findMany({
    where: {
      ...orderWhere(filters),
      payment: paymentMethodId ? { is: { paymentMethodId } } : { isNot: null },
    },
    orderBy: [{ closedAt: 'desc' }, { orderId: 'asc' }],
    skip,
    take,
    select: {
      orderId: true,
      tableId: true,
      openedBy: true,
      openedAt: true,
      closedAt: true,
      table: { select: { tableNumber: true } },
      payment: {
        select: { subtotal: true, discountAmount: true, total: true, paymentMethodId: true },
      },
      // Solo las unidades vendidas: los items cancelados no cuentan (R3)
      rounds: {
        select: {
          items: { where: { status: { not: 'cancelado' } }, select: { quantity: true } },
        },
      },
    },
  });
}

// GC-189. Una venta del historial con sus lineas: la orden CERRADA con pago, o null (no existe, o sigue abierta o
// en cobro). Las lineas son los items vendidos (sin cancelados, R3) con el nombre y el precio que tenian al
// pedirse, en el orden en que se pidieron: por ronda y, dentro de la ronda, por item.
export async function findHistoryOrder(orderId) {
  return prisma.order.findFirst({
    where: { orderId, status: 'CERRADA', payment: { isNot: null } },
    select: {
      orderId: true,
      tableId: true,
      openedBy: true,
      openedAt: true,
      closedAt: true,
      table: { select: { tableNumber: true } },
      payment: {
        select: {
          subtotal: true,
          discountAmount: true,
          total: true,
          paymentMethodId: true,
          amountReceived: true,
          changeGiven: true,
        },
      },
      rounds: {
        orderBy: { createdAt: 'asc' },
        select: {
          items: {
            where: { status: { not: 'cancelado' } },
            orderBy: [{ createdAt: 'asc' }, { itemId: 'asc' }],
            select: {
              productId: true,
              productNameSnapshot: true,
              unitPriceSnapshot: true,
              quantity: true,
            },
          },
        },
      },
    },
  });
}

// Totales de TODO el filtro (no de la pagina): cuantas ventas y cuanto se cobro. Se cuenta sobre payments (1:1 con
// la orden cerrada) para sumar `total`, que es lo cobrado despues del descuento.
export async function aggregateHistory({ paymentMethodId, ...filters }) {
  const result = await prisma.payment.aggregate({
    where: {
      ...(paymentMethodId && { paymentMethodId }),
      order: orderWhere(filters),
    },
    _sum: { total: true },
    _count: { _all: true },
  });
  return { totalSales: result._sum.total ?? 0, ordersCount: result._count._all };
}
