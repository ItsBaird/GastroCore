import rateLimit from 'express-rate-limit';

// Limite por IP (req.ip respeta 'trust proxy' y el X-Forwarded-For del gateway)
export function createRateLimiter({ windowMs = 60_000, limit = 300 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes', details: {} },
      });
    },
  });
}
