// ServiceCall del contrato (sin campos internos de la base)
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
