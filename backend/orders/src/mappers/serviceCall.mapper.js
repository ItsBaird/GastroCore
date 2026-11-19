// ServiceCall del contrato (sin campos internos de la base). Lo usan el evento waiter:called y pendingCalls.
export function toServiceCall(call) {
  return {
    serviceCallId: call.serviceCallId,
    tableId: call.tableId,
    type: call.type,
    status: call.status,
    createdAt: call.createdAt,
    attendedAt: call.attendedAt ?? null,
    attendedBy: call.attendedBy ?? null,
  };
}

// PublicServiceCall del contrato: la respuesta de los endpoints PUBLICOS del canal QR. Sin tableId (id interno
// que el cliente no necesita) ni datos de atencion (en un llamado recien creado siempre son null).
export function toPublicServiceCall(call) {
  return {
    serviceCallId: call.serviceCallId,
    type: call.type,
    status: call.status,
    createdAt: call.createdAt,
  };
}
