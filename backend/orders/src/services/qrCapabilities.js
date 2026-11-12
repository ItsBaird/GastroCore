// GC-QR-0001. Que puede hacer el cliente desde el QR segun el estado de la mesa (contrato QrTable.capabilities).
// Tabla unica de verdad: el frontend solo la muestra; cada escritura del canal QR (llamar, pedir, pedir la
// cuenta) debe volver a validar el estado en el backend con esta misma funcion.
//   libre    -> ver el menu y llamar a un mesero
//   ocupada  -> ademas enviar solicitudes de pedido y pedir la cuenta
//   en_cobro -> ver el menu y llamar al mesero (ya no se piden cosas nuevas)
const CAPABILITIES = {
  libre: { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false },
  ocupada: { viewMenu: true, callWaiter: true, sendRequest: true, requestBill: true },
  en_cobro: { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false },
};

// Un estado desconocido cierra por defecto: solo ver el menu, ninguna escritura
const READ_ONLY = { viewMenu: true, callWaiter: false, sendRequest: false, requestBill: false };

export function getQrCapabilities(status) {
  return { ...(Object.hasOwn(CAPABILITIES, status) ? CAPABILITIES[status] : READ_ONLY) };
}
