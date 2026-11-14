// Vista previa del cierre de caja (GC-RPT-0001) con la app real (rutas, JWT, validacion, errores).
// Solo el repositorio va simulado: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPaymentsOfDay, findSoldItemsOfDay } from '../repositories/reports.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/reports.repository.js', () => ({
  findPaymentsOfDay: vi.fn(),
  findSoldItemsOfDay: vi.fn(),
}));

const URL = '/api/orders/reports/cash-close';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const W1 = '33333333-3333-4333-8333-333333333333';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let app;
// Sin token: pasar null (un undefined activaria el valor por defecto, un token de ADMIN)
const get = (query, token = tokenFor('ADMIN')) =>
  call(app.base, 'GET', `${URL}${query}`, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findPaymentsOfDay.mockResolvedValue([]);
  findSoldItemsOfDay.mockResolvedValue([]);
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    const res = await get('?date=2026-11-14', null);
    expect(res.status).toBe(401);
    expect(findPaymentsOfDay).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403', async (role) => {
    const res = await get('?date=2026-11-14', tokenFor(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(findPaymentsOfDay).not.toHaveBeenCalled();
  });

  it('el ADMIN -> 200', async () => {
    expect((await get('?date=2026-11-14')).status).toBe(200);
  });
});

describe('GET /api/orders/reports/cash-close', () => {
  it('criterio 1: consolida ventas, desglose por metodo, mesas, ticket promedio, top y mesero', async () => {
    findPaymentsOfDay.mockResolvedValue([
      { total: 56000, paymentMethodId: M1, order: { openedBy: W1 } },
      { total: 24000, paymentMethodId: M2, order: { openedBy: W1 } },
    ]);
    findSoldItemsOfDay.mockResolvedValue([
      {
        productId: P1,
        productNameSnapshot: 'Pizza Margarita',
        quantity: 3,
        unitPriceSnapshot: 28000,
        createdAt: new Date('2026-11-14T15:00:00Z'),
      },
    ]);
    const res = await get('?date=2026-11-14');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: '2026-11-14',
      totalSales: 80000,
      tablesServed: 2,
      averageTicket: 40000,
      paymentBreakdown: [
        { paymentMethodId: M1, totalAmount: 56000, paymentCount: 1 },
        { paymentMethodId: M2, totalAmount: 24000, paymentCount: 1 },
      ],
      topProducts: [{ rank: 1, productId: P1, productName: 'Pizza Margarita', quantitySold: 3 }],
      waiterBreakdown: [{ waiterId: W1, totalAmount: 80000 }],
    });
  });

  it('criterio 2: sin ordenes cerradas responde 200 con ceros y listas vacias (la pantalla avisa que no hay nada)', async () => {
    const res = await get('?date=2026-11-14');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: '2026-11-14',
      totalSales: 0,
      tablesServed: 0,
      averageTicket: 0,
      paymentBreakdown: [],
      topProducts: [],
      waiterBreakdown: [],
    });
  });

  it('consulta el dia de negocio en hora de Colombia (UTC-5), no el dia UTC del servidor', async () => {
    await get('?date=2026-11-14');
    const expected = {
      start: new Date('2026-11-14T05:00:00.000Z'),
      end: new Date('2026-11-15T05:00:00.000Z'),
    };
    expect(findPaymentsOfDay).toHaveBeenCalledWith(expected);
    expect(findSoldItemsOfDay).toHaveBeenCalledWith(expected);
  });

  it('el top 5 trae como mucho 5 platos', async () => {
    findSoldItemsOfDay.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({
        productId: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`,
        productNameSnapshot: `Plato ${i}`,
        quantity: i + 1,
        unitPriceSnapshot: 1000,
        createdAt: new Date('2026-11-14T15:00:00Z'),
      })),
    );
    const res = await get('?date=2026-11-14');
    expect(res.body.topProducts).toHaveLength(5);
    expect(res.body.topProducts[0]).toMatchObject({ rank: 1, productName: 'Plato 6' });
  });

  it('no la captura GET /api/orders/:orderId: responde el reporte, no un 400 por UUID invalido', async () => {
    const res = await get('?date=2026-11-14');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalSales');
  });

  it('un dia futuro o ya cerrado tambien se puede ver (solo lectura)', async () => {
    expect((await get('?date=2030-01-01')).status).toBe(200);
  });
});

describe('validacion de la fecha (400)', () => {
  it.each([
    ['sin fecha', ''],
    ['fecha vacia', '?date='],
    ['no es una fecha', '?date=ayer'],
    ['sin ceros', '?date=2026-1-5'],
    ['formato dia/mes/ano', '?date=14-11-2026'],
    ['con hora', '?date=2026-11-14T10:00:00Z'],
    ['dia que no existe', '?date=2026-02-30'],
    ['mes 13', '?date=2026-13-01'],
    ['29-feb de un ano que no es bisiesto', '?date=2026-02-29'],
    ['parametro extra', '?date=2026-11-14&status=CERRADA'],
    ['fecha repetida', '?date=2026-11-14&date=2026-11-15'],
  ])('%s -> 400 sin consultar la base', async (_name, query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(findPaymentsOfDay).not.toHaveBeenCalled();
  });

  it('el 29 de febrero de un ano bisiesto si es valido', async () => {
    expect((await get('?date=2028-02-29')).status).toBe(200);
  });
});

describe('robustez', () => {
  it('un error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    findPaymentsOfDay.mockRejectedValue(new Error('password=secreto'));
    const res = await get('?date=2026-11-14');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    spy.mockRestore();
  });
});
