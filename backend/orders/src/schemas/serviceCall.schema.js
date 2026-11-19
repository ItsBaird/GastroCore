import { z } from 'zod';

export const serviceCallIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Atender no recibe cuerpo
export const attendServiceCallBodySchema = z.object({}).strict().optional();
