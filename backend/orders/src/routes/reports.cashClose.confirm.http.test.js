// Confirmar el cierre de caja (GC-RPT-0002) con la app real (rutas, JWT, validacion, errores). Solo el
// repositorio va simulado: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmClosure } from '../repositories/cashClosure.repository.js';
import { ADMIN_ID, call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/reports.repository.js', () => ({
  findPaymentsOfDay: vi.fn(),
  findSoldItemsOfDay: vi.fn(),
}));
vi.mock('../repositories/cashClosure.repository.js', () => ({ confirmClosure: vi.fn() }));

const URL = '/api/orders/reports/cash-close';
const M1 = '11111111-1111-4111-8111-111111111111';
const W1 = '33333333-3333-4333-8333-333333333333';
const CLOSURE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONFIRMED_AT = new Date('2026-11-14T23:30:00Z');

let app;
// Sin token: pasar null (un undefined activaria el valor por defecto, un token de ADMIN)
const post = (body, token = tokenFor('ADMIN')) => call(app.base, 'POST', URL, { token, body });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  confirmClosure.mockImplementation(async ({ build, userId }) => ({
    preview: build({
      payments: [
        { total: 56000, paymentMethodId: M1, order: { openedBy: W1 } },
        { total: 24000, paymentMethodId: M1, order: { openedBy: W1 } },
      ],
      items: [],
    }),
    closure: { closureId: CLOSURE, confirmedBy: userId, confirmedAt: CONFIRMED_AT },
  }));
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    expect((await post({ date: '2026-11-14' }, null)).status).toBe(401);
    expect(confirmClosure).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403', async (role) => {
    const res = await post({ date: '2026-11-14' }, tokenFor(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(confirmClosure).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/reports/cash-close', () => {
  it('criterio 1: confirma y responde 201 con el consolidado, closureId, confirmedBy y confirmedAt', async () => {
    const res = await post({ date: '2026-11-14' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      date: '2026-11-14',
      totalSales: 80000,
      tablesServed: 2,
      averageTicket: 40000,
      paymentBreakdown: [{ paymentMethodId: M1, totalAmount: 80000, paymentCount: 2 }],
      topProducts: [],
      waiterBreakdown: [{ waiterId: W1, totalAmount: 80000 }],
      closureId: CLOSURE,
      confirmedBy: ADMIN_ID,
      confirmedAt: CONFIRMED_AT.toISOString(),
    });
  });

  it('quien confirma sale del token, no del cuerpo', async () => {
    await post({ date: '2026-11-14' });
    expect(confirmClosure.mock.calls[0][0].userId).toBe(ADMIN_ID);
  });

  it('criterio 2: un dia ya cerrado -> 409 DAY_CLOSED', async () => {
    confirmClosure.mockResolvedValue({ alreadyClosed: true });
    const res = await post({ date: '2026-11-14' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DAY_CLOSED', details: { date: '2026-11-14' } });
  });

  it('un dia futuro -> 400 y no se guarda nada', async () => {
    const res = await post({ date: '2999-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(confirmClosure).not.toHaveBeenCalled();
  });

  it('un error de la base -> 500 sin filtrar el detalle', async () => {
    confirmClosure.mockRejectedValue(new Error('connection refused'));
    const res = await post({ date: '2026-11-14' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});

describe('validacion del cuerpo (400)', () => {
  it.each([
    ['sin cuerpo', undefined],
    ['cuerpo vacio', {}],
    ['fecha vacia', { date: '' }],
    ['no es una fecha', { date: 'ayer' }],
    ['sin ceros', { date: '2026-1-5' }],
    ['dia inexistente', { date: '2026-02-30' }],
    ['mes inexistente', { date: '2026-13-01' }],
    ['numero en vez de texto', { date: 20261114 }],
  ])('%s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(confirmClosure).not.toHaveBeenCalled();
  });

  it('R4: el cliente no puede mandar totales ni nada mas que la fecha', async () => {
    const res = await post({ date: '2026-11-14', totalSales: 999999 });
    expect(res.status).toBe(400);
    expect(confirmClosure).not.toHaveBeenCalled();
  });
});
