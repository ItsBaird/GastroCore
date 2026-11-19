// Crea el primer administrador. Uso: docker compose exec auth npm run seed:admin
// Lee ADMIN_EMAIL y ADMIN_PASSWORD del entorno (.env). Es idempotente.
import { prisma } from '../config/prisma.js';
import { createUserSchema } from '../schemas/user.schema.js';
import { createUser } from '../services/user.service.js';

const parsed = createUserSchema.safeParse({
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
  role: 'ADMIN',
});

if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.error(`ADMIN_EMAIL / ADMIN_PASSWORD invalidos en el entorno (${detail})`);
  process.exit(1);
}

try {
  const admin = await createUser(parsed.data);
  console.log(`Administrador creado: ${admin.email} (${admin.userId})`);
} catch (err) {
  if (err.code === 'EMAIL_ALREADY_EXISTS') {
    console.log('El administrador ya existe; no se hizo ningun cambio.');
  } else {
    console.error(`No se pudo crear el administrador: ${err.message}`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
