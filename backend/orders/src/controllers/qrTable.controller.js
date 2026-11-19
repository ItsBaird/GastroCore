import { getQrTable } from '../services/qrTableStatus.service.js';

// El estado cambia en cualquier momento (abrir, pedir la cuenta, pagar): nunca se cachea
export async function getQrTableController(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await getQrTable(req.params.token));
}
