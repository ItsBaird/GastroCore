import rateLimit from 'express-rate-limit';

// Limite por IP (req.ip respeta 'trust proxy', ver TRUST_PROXY). Cada llamada crea su propio contador: el limite
// general del servicio y los de rutas concretas (login, canal QR, menu publico) no se mezclan.
export function createRateLimiter({
  windowMs = 60_000,
  limit = 300,
  message = 'Demasiadas solicitudes',
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message, details: {} } });
    },
  });
}
