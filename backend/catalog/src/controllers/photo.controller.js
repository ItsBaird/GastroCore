import { AppError } from '../errors/AppError.js';
import { getPhoto } from '../services/photo.service.js';

// 7 dias, como servia express.static: el nombre es unico e inmutable (una foto nueva siempre tiene otro nombre)
const CACHE = 'public, max-age=604800, immutable';

// GET /api/catalog/photos/:filename. Publica: la ve el menu de clientes por QR. Se lee de la base (product_photos).
export async function servePhoto(req, res) {
  const photo = await getPhoto(req.params.filename);
  if (!photo) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Foto no encontrada' });
  }
  res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': CACHE });
  res.send(photo.content);
}
