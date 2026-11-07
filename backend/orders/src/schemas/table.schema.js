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

// R4: el cliente solo envia a quien se le asigna la mesa
export const reassignTableSchema = z
  .object({
    waiterId: z.string().uuid(),
  })
  .strict();

export const openTablesQuerySchema = z.object({
  waiterId: z.string().uuid(),
});
