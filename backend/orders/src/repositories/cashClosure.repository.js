import { prisma } from '../config/prisma.js';
import { findPaymentsOfDay, findSoldItemsOfDay } from './reports.repository.js';
import { isBusinessDayClosed, lockBusinessDay } from './dayLock.js';

// GC-RPT-0002 (GC-154). Confirma el cierre de `date` en UNA transaccion: o quedan el consolidado, sus tres
// desgloses y la auditoria, o no queda nada.
//   1. Candado del dia (dayLock.js): ningun cobro de ese dia entra mientras se calcula y se guarda.
//   2. Si el dia ya tiene cierre -> { alreadyClosed: true } (el servicio responde 409 DAY_CLOSED).
//   3. El consolidado se calcula AQUI, dentro de la transaccion y con las mismas consultas de la vista previa,
//      para que lo guardado sea exactamente lo vendido hasta ese instante (y no lo que se vio al abrir la pantalla).
//   4. cash_closures + payment_breakdown + top_products + waiter_breakdown + auditoria CASH_CLOSE_CONFIRMED.
// `build({ payments, items })` es la funcion pura de calculo (cashClose.js). Devuelve { closure, preview }.
// Si dos peticiones pasan el candado a la vez en bases distintas, el UNIQUE uq_closures_date (P2002) es la red
// de seguridad y se trata igual que un dia ya cerrado.
export async function confirmClosure({ date, range, userId, build }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBusinessDay(tx, date);
      if (await isBusinessDayClosed(tx, date)) return { alreadyClosed: true };

      const [payments, items] = await Promise.all([
        findPaymentsOfDay(range, tx),
        findSoldItemsOfDay(range, tx),
      ]);
      const preview = build({ payments, items });

      const closure = await tx.cashClosure.create({
        data: {
          closureDate: new Date(`${date}T00:00:00Z`),
          totalSales: preview.totalSales,
          tablesServed: preview.tablesServed,
          averageTicket: preview.averageTicket,
          confirmedBy: userId,
          paymentBreakdown: {
            create: preview.paymentBreakdown.map((p) => ({
              paymentMethodId: p.paymentMethodId,
              totalAmount: p.totalAmount,
              paymentCount: p.paymentCount,
            })),
          },
          topProducts: {
            create: preview.topProducts.map((p) => ({
              rank: p.rank,
              productId: p.productId,
              productNameSnapshot: p.productName,
              quantitySold: p.quantitySold,
            })),
          },
          waiterBreakdown: {
            create: preview.waiterBreakdown.map((w) => ({
              waiterId: w.waiterId,
              totalAmount: w.totalAmount,
            })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actionType: 'CASH_CLOSE_CONFIRMED',
          entityType: 'cash_closure',
          entityId: closure.closureId,
          performedBy: userId,
          details: {
            date,
            totalSales: preview.totalSales,
            tablesServed: preview.tablesServed,
            averageTicket: preview.averageTicket,
          },
        },
      });

      return { closure, preview };
    });
  } catch (err) {
    if (err?.code === 'P2002') return { alreadyClosed: true };
    throw err;
  }
}
