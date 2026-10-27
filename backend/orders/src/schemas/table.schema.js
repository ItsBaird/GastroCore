import { z } from 'zod';

export const createTableSchema = z
  .object({
    tableNumber: z.number().int().positive(),
  })
  .strict();

export const updateTableSchema = z
  .object({
    tableNumber: z.number().int().positive(),
  })
  .strict();

export const tableIdParamsSchema = z.object({
  id: z.string().uuid(),
});
