// Candado por dia de negocio (GC-155). Confirmar el cierre de un dia y registrar un cobro de ese mismo dia se
// serializan con el MISMO candado de transaccion de PostgreSQL: si el cobro entra primero, el cierre lo cuenta;
// si el cierre entra primero, el cobro ve el cierre y se rechaza. Sin esto, un pago concurrente podia quedar
// dentro del dia ya cerrado sin estar en el consolidado.
// El candado se suelta solo al terminar la transaccion (commit o rollback).
export async function lockBusinessDay(tx, date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-close:${date}`}))`;
}

// El dia ya tiene cierre confirmado
export async function isBusinessDayClosed(tx, date) {
  const closure = await tx.cashClosure.findUnique({
    where: { closureDate: new Date(`${date}T00:00:00Z`) },
    select: { closureId: true },
  });
  return closure !== null;
}
