import { getIo } from './events.js';
import { waiterRoom } from './rooms.js';

// GC-QR-0003: un cliente envio una solicitud de pedido desde el QR. Va SOLO al mesero asignado a la mesa
// (sala `waiter:{waiterId}`), no a toda la sala `waiters`: es su cliente y es el quien la revisa y confirma.
// El contrato nombra el evento y la sala pero no esquematiza el payload: enviamos la QrRequest del contrato
// mas el numero de mesa, para que el mesero vea "Mesa 4 pidio..." sin otra consulta
// (propuesta de contrato: QrRequestCreatedEvent).
export function emitQrRequestCreated({ qrRequest, tableNumber, waiterId }) {
  const io = getIo();
  io.to(waiterRoom(waiterId)).emit('qr_request:created', { ...qrRequest, tableNumber });
}
