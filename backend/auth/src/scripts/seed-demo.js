// Usuarios de demostracion (meseros y cocinero). Uso: docker compose exec auth npm run seed:demo
// Es idempotente: si el correo ya existe no se toca. Contrasena comun: DEMO_PASSWORD del entorno. Para el conjunto
// completo (empleados, turnos, catalogo, mesas, metodos de pago y ordenes) usa `bash scripts/seed-demo.sh`.
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../config/argon2.js';
import { prisma } from '../config/prisma.js';
import { createUserSchema } from '../schemas/user.schema.js';
import { DEFAULT_DEMO_PASSWORD, DEMO_USERS } from './demo/data.js';
import { assertDemoSeedAllowed, seedUuid } from './demo/ids.js';

try {
  assertDemoSeedAllowed();
  const password = process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;

  let created = 0;
  for (const demo of DEMO_USERS) {
    const parsed = createUserSchema.safeParse({ email: demo.email, password, role: demo.role });
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Usuario de demostracion invalido (${demo.email}): ${detail}`);
    }

    const userId = seedUuid(`user:${demo.key}`);
    const existing = await prisma.user.findUnique({ where: { email: demo.email } });
    if (existing) {
      const note =
        existing.userId === userId
          ? ''
          : ' (con OTRO id: su perfil de empleado y sus ordenes de ejemplo no coincidiran)';
      console.log(`  ya existe  ${demo.email}${note}`);
      continue;
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    await prisma.user.create({
      data: { userId, email: demo.email, passwordHash, role: demo.role },
    });
    created += 1;
    console.log(`  creado     ${demo.email} (${demo.role})`);
  }

  console.log(
    `Usuarios de demostracion: ${created} creados, ${DEMO_USERS.length - created} ya existian.`,
  );
  console.log('Contrasena de todos: la de DEMO_PASSWORD del entorno (ver .env.example).');
} catch (err) {
  console.error(`No se pudo ejecutar el seed de demostracion: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
