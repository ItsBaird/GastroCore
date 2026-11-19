// Metodos de pago, mesas y ordenes de demostracion. Uso: docker compose exec orders npm run seed:demo
// Idempotente: los ids salen de seedUuid, asi que repetirlo no duplica nada y lo que ya existe no se toca. Una mesa
// que ya tiene una orden abierta no recibe una orden de ejemplo. Los meseros y productos se referencian por los ids
// que calculan los seeds de Auth y Catalog (no hace falta que esos servicios esten arriba).
// Para el conjunto completo usa `bash scripts/seed-demo.sh`.
import { randomBytes } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import {
  PAYMENT_METHODS,
  TABLE_NUMBERS,
  buildHistoricalOrders,
  buildOpenScenarios,
} from './demo/data.js';
import { assertDemoSeedAllowed } from './demo/ids.js';

async function seedPaymentMethods() {
  const ids = new Map();
  let created = 0;
  for (const demo of PAYMENT_METHODS) {
    const existing = await prisma.paymentMethod.findUnique({ where: { name: demo.name } });
    if (existing) {
      ids.set(demo.name, existing.paymentMethodId);
      continue;
    }
    const method = await prisma.paymentMethod.create({
      data: { name: demo.name, isCash: demo.isCash, isActive: demo.isActive },
    });
    ids.set(demo.name, method.paymentMethodId);
    created += 1;
  }
  console.log(
    `Metodos de pago: ${created} creados, ${PAYMENT_METHODS.length - created} ya existian.`,
  );
  return ids;
}

async function seedTables() {
  const ids = new Map();
  let created = 0;
  for (const tableNumber of TABLE_NUMBERS) {
    const existing = await prisma.diningTable.findUnique({ where: { tableNumber } });
    if (existing) {
      ids.set(tableNumber, existing.tableId);
      continue;
    }
    // Token aleatorio de 256 bits (43 caracteres en base64url), como el que genera la API al crear una mesa
    const table = await prisma.diningTable.create({
      data: { tableNumber, qrToken: randomBytes(32).toString('base64url') },
    });
    ids.set(tableNumber, table.tableId);
    created += 1;
  }
  console.log(`Mesas: ${created} creadas, ${TABLE_NUMBERS.length - created} ya existian.`);
  return ids;
}

const roundsData = (spec) => ({
  create: spec.rounds.map((round) => ({
    roundId: round.roundId,
    source: round.source,
    createdBy: round.createdBy,
    createdAt: round.createdAt,
    items: { create: round.items },
  })),
});

const orderData = (spec, tableId) => ({
  orderId: spec.orderId,
  tableId,
  openedBy: spec.openedBy,
  waiterId: spec.waiterId,
  status: spec.status,
  openedAt: spec.openedAt,
  closedAt: spec.closedAt,
  discountAmount: spec.discountAmount,
  discountAppliedBy: spec.discountAppliedBy,
  discountAppliedAt: spec.discountAppliedAt,
  rounds: roundsData(spec),
});

async function seedHistory(tableIds, methodIds) {
  const specs = buildHistoricalOrders();
  const existing = new Set(
    (
      await prisma.order.findMany({
        where: { orderId: { in: specs.map((s) => s.orderId) } },
        select: { orderId: true },
      })
    ).map((o) => o.orderId),
  );

  let created = 0;
  for (const spec of specs) {
    if (existing.has(spec.orderId)) continue;
    const { payment } = spec;
    await prisma.order.create({
      data: {
        ...orderData(spec, tableIds.get(spec.tableNumber)),
        payment: {
          create: {
            paymentId: payment.paymentId,
            paymentMethodId: methodIds.get(payment.methodName),
            subtotal: payment.subtotal,
            discountAmount: payment.discountAmount,
            total: payment.total,
            amountReceived: payment.amountReceived,
            changeGiven: payment.changeGiven,
            discountAppliedBy: payment.discountAppliedBy,
            registeredBy: payment.registeredBy,
            paidAt: payment.paidAt,
          },
        },
      },
    });
    created += 1;
  }
  console.log(
    `Ordenes cerradas (ultimos 7 dias y hoy): ${created} creadas, ${specs.length - created} ya existian.`,
  );
}

async function seedOpen(tableIds) {
  const { orders, qrRequests, serviceCalls } = buildOpenScenarios();

  let created = 0;
  for (const spec of orders) {
    const tableId = tableIds.get(spec.tableNumber);
    if (await prisma.order.findUnique({ where: { orderId: spec.orderId } })) continue;
    if (await prisma.order.findFirst({ where: { tableId, status: { not: 'CERRADA' } } })) {
      console.log(
        `  mesa ${spec.tableNumber}: ya tiene una orden abierta, no se agrega la de ejemplo`,
      );
      continue;
    }
    await prisma.order.create({ data: orderData(spec, tableId) });
    created += 1;
  }
  console.log(`Ordenes abiertas: ${created} creadas.`);

  let requests = 0;
  for (const request of qrRequests) {
    if (!(await prisma.order.findUnique({ where: { orderId: request.orderId } }))) continue;
    if (await prisma.qrRequest.findUnique({ where: { qrRequestId: request.qrRequestId } }))
      continue;
    await prisma.qrRequest.create({
      data: {
        qrRequestId: request.qrRequestId,
        orderId: request.orderId,
        createdAt: request.createdAt,
        items: { create: request.items },
      },
    });
    requests += 1;
  }
  console.log(`Solicitudes de pedido por QR pendientes: ${requests} creadas.`);

  let calls = 0;
  for (const call of serviceCalls) {
    const tableId = tableIds.get(call.tableNumber);
    if (await prisma.serviceCall.findUnique({ where: { serviceCallId: call.serviceCallId } }))
      continue;
    // Un solo llamado pendiente por tipo y mesa: si ya hay uno (de uso real) no se agrega otro
    if (
      await prisma.serviceCall.findFirst({
        where: { tableId, type: call.type, status: 'pendiente' },
      })
    )
      continue;
    await prisma.serviceCall.create({
      data: {
        serviceCallId: call.serviceCallId,
        tableId,
        type: call.type,
        createdAt: call.createdAt,
      },
    });
    calls += 1;
  }
  console.log(`Llamados pendientes (mesero y cuenta): ${calls} creados.`);
}

try {
  assertDemoSeedAllowed();
  const methodIds = await seedPaymentMethods();
  const tableIds = await seedTables();
  await seedHistory(tableIds, methodIds);
  await seedOpen(tableIds);
} catch (err) {
  console.error(`No se pudo ejecutar el seed de demostracion: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
