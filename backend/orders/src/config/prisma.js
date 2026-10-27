import { PrismaClient } from '@prisma/client';

// Lee DATABASE_URL del entorno; conecta de forma perezosa en la primera consulta
export const prisma = new PrismaClient();
