import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  SERVICE_NAME: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).default('http://localhost'),
  DATABASE_URL: z.string().min(1),
  JWT_PUBLIC_KEY_PATH: z.string().min(1).default('/run/keys/public/jwt_public.pem'),
  // Proxies delante del servicio en los que se confia para leer la IP real del cliente (X-Forwarded-For). En
  // local hay uno (nginx); en produccion, Vercel y Render. Un numero de saltos o una lista de IP/subredes.
  // 'true' (confiar en cualquiera) se rechaza: dejaria falsificar la IP y saltarse los limites por IP.
  TRUST_PROXY: z
    .string()
    .trim()
    .default('1')
    .refine((v) => v !== '' && v !== 'true', {
      message: "debe ser un numero de proxies o una lista de IP/subredes (no 'true')",
    })
    .transform((v) => (/^\d+$/.test(v) ? Number(v) : v === 'false' ? false : v)),
  JWT_PRIVATE_KEY_PATH: z.string().min(1).default('/run/keys/private/jwt_private.pem'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Intentos de inicio de sesion por IP y por minuto (antes lo limitaba nginx). En una demostracion con muchas
  // personas en la misma red (misma IP publica) se puede subir.
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Variables de entorno invalidas: ${detail}`);
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  serviceName: parsed.data.SERVICE_NAME,
  corsOrigin: parsed.data.CORS_ORIGIN,
  databaseUrl: parsed.data.DATABASE_URL,
  jwtPublicKeyPath: parsed.data.JWT_PUBLIC_KEY_PATH,
  trustProxy: parsed.data.TRUST_PROXY,
  jwtPrivateKeyPath: parsed.data.JWT_PRIVATE_KEY_PATH,
  accessTokenTtlSeconds: parsed.data.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlDays: parsed.data.REFRESH_TOKEN_TTL_DAYS,
  loginMaxAttempts: parsed.data.LOGIN_MAX_ATTEMPTS,
  loginRateLimit: parsed.data.LOGIN_RATE_LIMIT,
  loginLockMinutes: parsed.data.LOGIN_LOCK_MINUTES,
};
