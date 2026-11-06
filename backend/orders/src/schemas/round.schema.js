import { z } from 'zod';

export const createRoundParamsSchema = z.object({
  orderId: z.string().uuid(),
});

const roundItemSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
    note: z.string().max(255).optional(),
  })
  .strict();

export const createRoundBodySchema = z
  .object({
    items: z.array(roundItemSchema).min(1),
  })
  .strict();

export const orderIdParamsSchema = z.object({
  orderId: z.string().uuid(),
});
