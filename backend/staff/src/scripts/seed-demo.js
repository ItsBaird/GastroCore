// Empleados y turnos de demostracion. Uso: docker compose exec staff npm run seed:demo
// Idempotente: los ids salen de seedUuid, asi que repetirlo no duplica. Los empleados usan los userId que calcula el
// seed de Auth (no hace falta que Auth este arriba). Para el conjunto completo usa `bash scripts/seed-demo.sh`.
import { prisma } from '../config/prisma.js';
import { buildShifts, DEMO_EMPLOYEES } from './demo/data.js';
import { assertDemoSeedAllowed, seedUuid } from './demo/ids.js';

async function seedEmployees() {
  let created = 0;
  for (const demo of DEMO_EMPLOYEES) {
    const userId = seedUuid(`user:${demo.key}`);
    if (await prisma.employee.findUnique({ where: { userId } })) continue;
    try {
      await prisma.employee.create({
        data: {
          userId,
          fullName: demo.fullName,
          phone: demo.phone,
          documentNumber: demo.documentNumber,
          position: demo.position,
          hireDate: new Date(`${demo.hireDate}T00:00:00Z`),
        },
      });
      created += 1;
    } catch (err) {
      // Documento ya usado por otro empleado (P2002): se avisa y se sigue con los demas
      if (err.code !== 'P2002') throw err;
      console.log(`  omitido    ${demo.fullName}: el documento ${demo.documentNumber} ya existe`);
    }
  }
  console.log(
    `Empleados de demostracion: ${created} creados, ${DEMO_EMPLOYEES.length - created} ya existian u omitidos.`,
  );
}

async function seedShifts() {
  let created = 0;
  let closed = 0;
  for (const shift of buildShifts()) {
    const userId = seedUuid(`user:${shift.key}`);
    if (!(await prisma.employee.findUnique({ where: { userId } }))) continue; // su empleado se omitio

    const existing = await prisma.shift.findUnique({ where: { shiftId: shift.shiftId } });
    if (!existing) {
      await prisma.shift.create({
        data: {
          shiftId: shift.shiftId,
          userId,
          scheduledStart: shift.scheduledStart,
          scheduledEnd: shift.scheduledEnd,
          status: shift.status,
          actualStart: shift.actualStart,
          actualEnd: shift.actualEnd,
        },
      });
      created += 1;
    } else if (shift.status === 'finalizado' && existing.status !== 'finalizado') {
      // El turno "de hoy" de una ejecucion anterior ya es del pasado: se cierra para no dejar turnos activos viejos
      await prisma.shift.update({
        where: { shiftId: shift.shiftId },
        data: {
          status: 'finalizado',
          actualStart: existing.actualStart ?? shift.actualStart,
          actualEnd: shift.actualEnd,
        },
      });
      closed += 1;
    }
  }
  console.log(`Turnos de demostracion: ${created} creados, ${closed} de dias pasados cerrados.`);
}

try {
  assertDemoSeedAllowed();
  await seedEmployees();
  await seedShifts();
} catch (err) {
  console.error(`No se pudo ejecutar el seed de demostracion: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
