import { mapItem } from '../mappers/item.mapper.js';

// GC-ORD-0006. Calculo de la cuenta en un solo lugar, sin E/S, para que GC-ORD-0007 (descuento),
// GC-ORD-0008 (pago) y el cierre de caja lo reusen sin duplicar logica.
//   - Solo items no cancelados, con el precio del snapshot (R3): nunca se consulta Catalog.
//   - lineTotal = unitPrice x quantity; subtotal = suma de lineTotal; total = subtotal - descuento.
//   - Pesos enteros (R5): un valor no entero es un dato corrupto y se rechaza, no se redondea.
//   - Los precios ya incluyen impuestos y no hay propina.
// No valida que el descuento no supere el subtotal (eso es de GC-ORD-0007): devuelve el total tal cual y
// quien lo usa decide; ver assertBillPayable.

export const BILLABLE = (item) => item.status !== 'cancelado';

function assertInt(value, field, itemId) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Monto no entero en ${field} del item ${itemId}: ${value}`);
  }
}

export function computeBill(order) {
  const items = order.rounds
    .flatMap((round) => round.items)
    .filter(BILLABLE)
    .map((item) => {
      assertInt(item.unitPriceSnapshot, 'unitPrice', item.itemId);
      assertInt(item.quantity, 'quantity', item.itemId);
      return { ...mapItem(item), lineTotal: item.unitPriceSnapshot * item.quantity };
    });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountAmount = order.discountAmount ?? 0;
  assertInt(discountAmount, 'discountAmount', order.orderId);

  return { items, subtotal, discountAmount, total: subtotal - discountAmount };
}

// Un total negativo no se "arregla" con un minimo en 0: payments exige total = subtotal - descuento.
export function assertBillPayable(bill) {
  return bill.total >= 0;
}
