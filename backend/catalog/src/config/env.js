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
  // Volumen donde se guardan las fotos de productos (SAD: volumen uploads)
  UPLOADS_DIR: z.string().min(1).default('/app/uploads'),
  // Autenticacion entre servicios en /internal/* (cabecera X-Service-Token)
  SERVICE_TOKEN: z.string().default(''),
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
  uploadsDir: parsed.data.UPLOADS_DIR,
  serviceToken: parsed.data.SERVICE_TOKEN,
};
