import { getQrOrderStatus } from '../services/qrOrderStatus.service.js';
import { getQrTable } from '../services/qrTableStatus.service.js';

// El estado cambia en cualquier momento (abrir, pedir la cuenta, pagar): nunca se cachea
export async function getQrTableController(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await getQrTable(req.params.token));
}

// Lo que el cliente lleva en su mesa: cambia con cada ronda y cada paso de cocina, nunca se cachea
export async function getQrOrderStatusController(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await getQrOrderStatus(req.params.token));
}
