import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  SERVICE_NAME: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).default('http://localhost'),
  DATABASE_URL: z.string().min(1),
  JWT_PUBLIC_KEY_PATH: z.string().min(1).default('/run/keys/jwt_public.pem'),
  JWT_PRIVATE_KEY_PATH: z.string().min(1).default('/run/keys/jwt_private.pem'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
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
  jwtPrivateKeyPath: parsed.data.JWT_PRIVATE_KEY_PATH,
  accessTokenTtlSeconds: parsed.data.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlDays: parsed.data.REFRESH_TOKEN_TTL_DAYS,
  loginMaxAttempts: parsed.data.LOGIN_MAX_ATTEMPTS,
  loginLockMinutes: parsed.data.LOGIN_LOCK_MINUTES,
};
