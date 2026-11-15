import { createHash } from 'node:crypto';
import { seedUuid } from './ids.js';

// Datos de demostracion de Orders. Todo se calcula aqui, sin tocar la base ni el reloj (el `now` llega por
// parametro), para poder probar que cada fila cumple las restricciones de la base antes de escribirla.
// Los ids de usuarios y productos salen de seedUuid: son los mismos que crean los seeds de Auth y Catalog.

const MINUTE = 60 * 1000;
// Colombia no tiene horario de verano: el dia del restaurante es UTC-5 todo el ano
const OFFSET = '-05:00';
const CANCEL_REASON = 'El cliente cambió de opinión';
const NOTES = ['Sin cebolla', 'Bien cocida', 'Con poco hielo', 'Sin picante'];

export const PAYMENT_METHODS = [
  { name: 'Efectivo', isCash: true, isActive: true, weight: 40 },
  { name: 'Tarjeta débito', isCash: false, isActive: true, weight: 25 },
  { name: 'Tarjeta crédito', isCash: false, isActive: true, weight: 20 },
  { name: 'Transferencia', isCash: false, isActive: true, weight: 15 },
  // Inactivo: no se ofrece al cobrar, pero la pantalla de metodos muestra como se ve uno desactivado
  { name: 'Bono de cortesía', isCash: false, isActive: false, weight: 0 },
];

export const TABLE_NUMBERS = Array.from({ length: 10 }, (_, i) => i + 1);
export const WAITER_KEYS = ['mesero1', 'mesero2', 'mesero3'];
export const waiterId = (key) => seedUuid(`user:${key}`);

// Mismos slugs, nombres y precios que el seed de Catalog. El Tiramisu esta agotado a proposito.
export const PRODUCTS = [
  { slug: 'palitos-de-ajo', name: 'Palitos de ajo', price: 12000 },
  { slug: 'ensalada-caprese', name: 'Ensalada Caprese', price: 16000 },
  { slug: 'pizza-margarita', name: 'Pizza Margarita', price: 28000 },
  { slug: 'pizza-pepperoni', name: 'Pizza Pepperoni', price: 32000 },
  { slug: 'pizza-hawaiana', name: 'Pizza Hawaiana', price: 30000 },
  { slug: 'pizza-cuatro-quesos', name: 'Pizza Cuatro Quesos', price: 34000 },
  { slug: 'pizza-vegetariana', name: 'Pizza Vegetariana', price: 29000 },
  { slug: 'pasta-carbonara', name: 'Pasta Carbonara', price: 25000 },
  { slug: 'pasta-bolonesa', name: 'Pasta Boloñesa', price: 24000 },
  { slug: 'lasana-de-carne', name: 'Lasaña de Carne', price: 27000 },
  { slug: 'limonada-natural', name: 'Limonada Natural', price: 8000 },
  { slug: 'jugo-de-maracuya', name: 'Jugo de Maracuyá', price: 9000 },
  { slug: 'gaseosa', name: 'Gaseosa', price: 5000 },
  { slug: 'cerveza-nacional', name: 'Cerveza Nacional', price: 7000 },
  { slug: 'tiramisu', name: 'Tiramisú', price: 15000, available: false },
  { slug: 'brownie-con-helado', name: 'Brownie con Helado', price: 12000 },
].map((p) => ({ available: true, ...p, productId: seedUuid(`product:${p.slug}`) }));

const AVAILABLE = PRODUCTS.filter((p) => p.available);
const product = (slug) => PRODUCTS.find((p) => p.slug === slug);

// ---------- tiempo ----------
export const bogotaTime = (date, time) => new Date(`${date}T${time}:00${OFFSET}`);

export function todayBogota(now = new Date()) {
  return new Date(now.getTime() - 5 * 60 * MINUTE).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- azar determinista: el mismo dia genera siempre las mismas ordenes ----------
function rngFor(seed) {
  let a = createHash('sha1').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function weightedPick(rng, list) {
  let roll = rng() * list.reduce((sum, item) => sum + item.weight, 0);
  for (const item of list) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return list[list.length - 1];
}

function pickDistinct(rng, list, count) {
  const pool = [...list];
  const chosen = [];
  while (chosen.length < count && pool.length > 0)
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return chosen;
}

// Casi siempre una unidad por plato; dos de vez en cuando y tres muy rara vez
function quantityFor(rng) {
  const roll = rng();
  return roll < 0.65 ? 1 : roll < 0.92 ? 2 : 3;
}

// ---------- items ----------
// Marcas de tiempo segun el estado (chk_items_lifecycle): cada estado exige las de los anteriores
function lifecycle(status, createdAt) {
  const at = (minutes) => new Date(createdAt.getTime() + minutes * MINUTE);
  const prep = status === 'pendiente' || status === 'cancelado' ? null : at(3);
  const ready = status === 'listo' || status === 'entregado' ? at(10) : null;
  const delivered = status === 'entregado' ? at(15) : null;
  return { preparationStartedAt: prep, readyAt: ready, deliveredAt: delivered };
}

function itemSpec({
  id,
  product: p,
  quantity,
  status,
  createdAt,
  note = null,
  cancelledBy = null,
}) {
  return {
    itemId: id,
    productId: p.productId,
    productNameSnapshot: p.name,
    unitPriceSnapshot: p.price,
    quantity,
    note,
    status,
    ...lifecycle(status, createdAt),
    cancelledReason: status === 'cancelado' ? CANCEL_REASON : null,
    cancelledBy: status === 'cancelado' ? cancelledBy : null,
    createdAt,
  };
}

const lineTotal = (item) =>
  item.status === 'cancelado' ? 0 : item.unitPriceSnapshot * item.quantity;

// ---------- ordenes cerradas (historial para el cierre de caja) ----------
function buildHistoricalOrder(date, index) {
  const rng = rngFor(`order:${date}:${index}`);
  const key = `${date}:${index}`;
  const waiter = waiterId(pick(rng, WAITER_KEYS));

  const lunch = rng() < 0.6;
  const closedMinutes = lunch
    ? between(rng, 13 * 60, 15 * 60)
    : between(rng, 19 * 60 + 30, 22 * 60 + 30);
  const closedAt = new Date(bogotaTime(date, '00:00').getTime() + closedMinutes * MINUTE);
  const openedAt = new Date(closedAt.getTime() - between(rng, 60, 100) * MINUTE);

  const roundCount = rng() < 0.5 ? 2 : 1;
  const rounds = [];
  for (let r = 0; r < roundCount; r += 1) {
    const createdAt = new Date(openedAt.getTime() + (r === 0 ? 2 : 28) * MINUTE);
    // La primera ronda es la comida (2 o 3 lineas); la segunda, un complemento (1 o 2). Tickets de unos 80.000.
    const chosen = pickDistinct(rng, AVAILABLE, r === 0 ? between(rng, 2, 3) : between(rng, 1, 2));
    const items = chosen.map((p, j) =>
      itemSpec({
        id: seedUuid(`item:${key}:${r}:${j}`),
        product: p,
        quantity: quantityFor(rng),
        status: 'entregado',
        createdAt,
        note: rng() < 1 / 6 ? pick(rng, NOTES) : null,
      }),
    );
    // De vez en cuando una linea anulada: no cuenta en la cuenta ni en el top de platos
    if (r === 0 && rng() < 1 / 9) {
      const extra = pick(
        rng,
        AVAILABLE.filter((p) => !chosen.includes(p)),
      );
      items.push(
        itemSpec({
          id: seedUuid(`item:${key}:${r}:${items.length}`),
          product: extra,
          quantity: 1,
          status: 'cancelado',
          createdAt,
          cancelledBy: waiter,
        }),
      );
    }
    rounds.push({
      roundId: seedUuid(`round:${key}:${r}`),
      source: 'WAITER',
      createdBy: waiter,
      createdAt,
      items,
    });
  }

  const subtotal = rounds
    .flatMap((round) => round.items)
    .reduce((sum, item) => sum + lineTotal(item), 0);
  const hasDiscount = rng() < 1 / 7;
  const discountAmount = hasDiscount ? Math.max(100, Math.round((subtotal * 0.1) / 100) * 100) : 0;
  const total = subtotal - discountAmount;
  const method = weightedPick(
    rng,
    PAYMENT_METHODS.filter((m) => m.isActive),
  );
  const received = method.isCash ? Math.ceil(total / 5000) * 5000 : null;

  return {
    orderId: seedUuid(`order:${key}`),
    tableNumber: pick(rng, TABLE_NUMBERS),
    openedBy: waiter,
    waiterId: waiter,
    status: 'CERRADA',
    openedAt,
    closedAt,
    discountAmount,
    discountAppliedBy: hasDiscount ? waiter : null,
    discountAppliedAt: hasDiscount ? new Date(closedAt.getTime() - 5 * MINUTE) : null,
    rounds,
    payment: {
      paymentId: seedUuid(`payment:${key}`),
      methodName: method.name,
      subtotal,
      discountAmount,
      total,
      amountReceived: received,
      changeGiven: method.isCash ? received - total : null,
      discountAppliedBy: hasDiscount ? waiter : null,
      registeredBy: waiter,
      paidAt: closedAt,
    },
  };
}

// Ordenes cerradas de los ultimos `days` dias y de hoy (solo las que ya cerraron hace al menos 5 minutos).
// Entre 5 y 9 por dia. Mismos ids para el mismo dia: repetir el seed no duplica.
export function buildHistoricalOrders({ now = new Date(), days = 7 } = {}) {
  const today = todayBogota(now);
  const specs = [];
  for (let back = days; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const count = between(rngFor(`day:${date}`), 5, 9);
    for (let index = 0; index < count; index += 1) {
      const spec = buildHistoricalOrder(date, index);
      if (spec.closedAt.getTime() <= now.getTime() - 5 * MINUTE) specs.push({ ...spec, date });
    }
  }
  return specs;
}

// ---------- ordenes abiertas: para ver la cocina, el panel del mesero, la cuenta y el canal QR ----------
// Cada linea: [slug, cantidad, estado, nota]. Los tiempos son relativos a `now`.
export function buildOpenScenarios({ now = new Date() } = {}) {
  const ago = (minutes) => new Date(now.getTime() - minutes * MINUTE);

  function order({ n, waiterKey, openedMinutesAgo, status = 'ABIERTA', rounds }) {
    const waiter = waiterId(waiterKey);
    return {
      orderId: seedUuid(`open-order:${n}`),
      tableNumber: n,
      openedBy: waiter,
      waiterId: waiter,
      status,
      openedAt: ago(openedMinutesAgo),
      closedAt: null,
      discountAmount: 0,
      discountAppliedBy: null,
      discountAppliedAt: null,
      rounds: rounds.map((round, r) => ({
        roundId: seedUuid(`open-round:${n}:${r}`),
        source: 'WAITER',
        createdBy: waiter,
        createdAt: ago(round.minutesAgo),
        items: round.lines.map(([slug, quantity, itemStatus, note], j) =>
          itemSpec({
            id: seedUuid(`open-item:${n}:${r}:${j}`),
            product: product(slug),
            quantity,
            status: itemStatus,
            createdAt: ago(round.minutesAgo),
            note,
          }),
        ),
      })),
    };
  }

  const orders = [
    // Mesa 2: una ronda ya servida y otra a medio camino en cocina (pendiente, en preparacion y lista)
    order({
      n: 2,
      waiterKey: 'mesero1',
      openedMinutesAgo: 50,
      rounds: [
        {
          minutesAgo: 45,
          lines: [
            ['pizza-margarita', 1, 'entregado'],
            ['limonada-natural', 2, 'entregado'],
          ],
        },
        {
          minutesAgo: 14,
          lines: [
            ['pasta-carbonara', 1, 'listo'],
            ['pizza-pepperoni', 1, 'en_preparacion', 'Bien cocida'],
            ['gaseosa', 1, 'pendiente'],
          ],
        },
      ],
    }),
    // Mesa 3: recien pedida, todo en cocina
    order({
      n: 3,
      waiterKey: 'mesero2',
      openedMinutesAgo: 25,
      rounds: [
        {
          minutesAgo: 20,
          lines: [
            ['pizza-hawaiana', 1, 'en_preparacion'],
            ['jugo-de-maracuya', 2, 'pendiente'],
          ],
        },
      ],
    }),
    // Mesa 4: todo entregado y el cliente pidio la cuenta (llamado request_bill)
    order({
      n: 4,
      waiterKey: 'mesero1',
      openedMinutesAgo: 75,
      rounds: [
        {
          minutesAgo: 70,
          lines: [
            ['lasana-de-carne', 1, 'entregado'],
            ['pizza-cuatro-quesos', 1, 'entregado'],
            ['cerveza-nacional', 2, 'entregado'],
          ],
        },
      ],
    }),
    // Mesa 5: ya en cobro
    order({
      n: 5,
      waiterKey: 'mesero3',
      openedMinutesAgo: 95,
      status: 'EN_COBRO',
      rounds: [
        {
          minutesAgo: 90,
          lines: [
            ['pizza-vegetariana', 1, 'entregado'],
            ['ensalada-caprese', 1, 'entregado'],
            ['limonada-natural', 2, 'entregado'],
          ],
        },
      ],
    }),
    // Mesa 6: ocupada, con una solicitud de pedido por QR pendiente y un llamado al mesero
    order({
      n: 6,
      waiterKey: 'mesero2',
      openedMinutesAgo: 40,
      rounds: [
        {
          minutesAgo: 35,
          lines: [
            ['pasta-bolonesa', 1, 'entregado'],
            ['gaseosa', 1, 'entregado'],
          ],
        },
      ],
    }),
  ];

  const qrRequests = [
    {
      qrRequestId: seedUuid('open-qrrequest:6'),
      orderId: seedUuid('open-order:6'),
      createdAt: ago(3),
      // Solo productos que crea el seed de Catalog (existen con ese id): asi el mesero puede confirmarla
      items: [
        { productId: product('limonada-natural').productId, quantity: 2, note: 'Con poco hielo' },
        { productId: product('palitos-de-ajo').productId, quantity: 1, note: null },
      ],
    },
  ];

  const serviceCalls = [
    {
      serviceCallId: seedUuid('open-call:4:request_bill'),
      tableNumber: 4,
      type: 'request_bill',
      createdAt: ago(3),
    },
    {
      serviceCallId: seedUuid('open-call:6:call_waiter'),
      tableNumber: 6,
      type: 'call_waiter',
      createdAt: ago(1),
    },
    // Mesa 7 libre: el cliente llama a un mesero para que la abra
    {
      serviceCallId: seedUuid('open-call:7:call_waiter'),
      tableNumber: 7,
      type: 'call_waiter',
      createdAt: ago(2),
    },
  ];

  return { orders, qrRequests, serviceCalls };
}
