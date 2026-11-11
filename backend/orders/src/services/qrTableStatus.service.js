import { getQrCapabilities } from './qrCapabilities.js';
import { resolveQrTable } from './qrTable.js';
import { deriveTableStatus } from './tableState.js';

// GC-QR-0001. GET /qr/:token: estado de la mesa y capacidades del cliente (contrato QrTable).
// Publico y de solo lectura. Cada campo es visible para cualquiera con el token, asi que solo sale lo minimo:
// nada de ids, mesero, orden ni montos. Un token malformado o desconocido es el mismo 404 de todo el canal QR.
export async function getQrTable(qrToken) {
  const { tableNumber, order } = await resolveQrTable(qrToken);
  const status = deriveTableStatus(order ? [order] : []);
  return { tableNumber, status, capabilities: getQrCapabilities(status) };
}
