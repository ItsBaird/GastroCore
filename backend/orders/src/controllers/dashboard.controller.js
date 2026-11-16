import { getDashboard } from '../services/dashboard.service.js';

// Datos de negocio: el navegador ni un proxy deben guardarlos
export async function dashboardController(req, res) {
  res.set('Cache-Control', 'no-store').json(await getDashboard(req.valid.query));
}
