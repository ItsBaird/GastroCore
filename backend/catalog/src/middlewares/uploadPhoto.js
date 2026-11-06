import multer from 'multer';
import { MAX_PHOTO_BYTES } from '../services/photo.service.js';
import { fieldError } from '../services/product.service.js';

// Recibe un unico archivo en el campo "photo". Queda en memoria (maximo 2 MB) para poder
// comprobar su firma real antes de escribir nada en disco.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 10, parts: 12 },
}).single('photo');

const MESSAGES = {
  LIMIT_FILE_SIZE: ['photo', 'La foto no puede superar 2 MB'],
  LIMIT_UNEXPECTED_FILE: ['photo', 'Envia un solo archivo en el campo "photo"'],
  LIMIT_FILE_COUNT: ['photo', 'Envia un solo archivo en el campo "photo"'],
};

export function uploadPhoto(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const [path, message] = MESSAGES[err.code] ?? ['body', 'Formulario multipart invalido'];
      return next(fieldError(path, message));
    }
    // Multipart mal formado (corte de conexion, limites del parser, etc.)
    return next(fieldError('body', 'Formulario multipart invalido'));
  });
}
