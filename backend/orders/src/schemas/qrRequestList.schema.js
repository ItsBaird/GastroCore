import { z } from 'zod';

// El listado no acepta parametros: siempre devuelve las pendientes. Cualquier otro (por ejemplo ?status=) es 400,
// igual que la cuenta (billQuerySchema): un filtro que no existe no se ignora en silencio.
export const listQrRequestsQuerySchema = z.object({}).strict();
