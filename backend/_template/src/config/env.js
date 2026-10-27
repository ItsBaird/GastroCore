import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  SERVICE_NAME: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).default('http://localhost'),
  DATABASE_URL: z.string().min(1),
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
};
