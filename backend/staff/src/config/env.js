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
  // Red interna de Docker: Staff consulta a Auth directamente, sin pasar por el gateway
  AUTH_URL: z.string().url().default('http://auth:3001'),
  ORDERS_URL: z.string().url().default('http://orders:3004'),
  // Autenticacion entre servicios en /internal/* (cabecera X-Service-Token)
  SERVICE_TOKEN: z.string().default(''),
  // Espera maxima de las llamadas entre servicios. El contrato fija 3 s; en Render gratis un servicio dormido tarda
  // ~50 s en despertar, asi que alli se sube con esta variable.
  INTERNAL_TIMEOUT_MS: z.coerce.number().int().min(500).max(120000).default(3000),
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
  authUrl: parsed.data.AUTH_URL,
  ordersUrl: parsed.data.ORDERS_URL,
  serviceToken: parsed.data.SERVICE_TOKEN,
  internalTimeoutMs: parsed.data.INTERNAL_TIMEOUT_MS,
};
