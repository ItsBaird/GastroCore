import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/paymentMethod.repository.js');

const repo = await import('../repositories/paymentMethod.repository.js');
const { createPaymentMethodService, listPaymentMethodsService, updatePaymentMethodService } =
  await import('./paymentMethod.service.js');

const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeMethod(overrides = {}) {
  return {
    paymentMethodId: ID,
    name: 'Efectivo',
    isCash: true,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function p2002() {
  const err = new Error('Unique constraint');
  err.code = 'P2002';
  err.meta = { target: ['name'] };
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.findPaymentMethodByName.mockResolvedValue(null);
});

describe('listPaymentMethodsService', () => {
  it('devuelve solo los campos del contrato y pasa el filtro active al repositorio', async () => {
    repo.findAllPaymentMethods.mockResolvedValue([makeMethod()]);
    const out = await listPaymentMethodsService({ active: true });
    expect(repo.findAllPaymentMethods).toHaveBeenCalledWith({ active: true });
    expect(out).toEqual([{ paymentMethodId: ID, name: 'Efectivo', isCash: true, isActive: true }]);
  });

  it('sin argumentos pide todos', async () => {
    repo.findAllPaymentMethods.mockResolvedValue([]);
    expect(await listPaymentMethodsService()).toEqual([]);
    expect(repo.findAllPaymentMethods).toHaveBeenCalledWith({ active: undefined });
  });
});

describe('createPaymentMethodService', () => {
  it('crea el metodo con is_cash e is_active indicados', async () => {
    repo.createPaymentMethod.mockImplementation(async (data) => makeMethod(data));
    const out = await createPaymentMethodService({ name: 'Nequi', isCash: false, isActive: false });
    expect(repo.createPaymentMethod).toHaveBeenCalledWith({
      name: 'Nequi',
      isCash: false,
      isActive: false,
    });
    expect(out).toMatchObject({ name: 'Nequi', isCash: false, isActive: false });
    expect(out).not.toHaveProperty('createdAt');
  });

  it('nombre repetido (sin distinguir mayusculas) -> 409 y no crea', async () => {
    repo.findPaymentMethodByName.mockResolvedValue(makeMethod({ name: 'Efectivo' }));
    await expect(
      createPaymentMethodService({ name: 'EFECTIVO', isCash: true, isActive: true }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { field: 'name' },
    });
    expect(repo.createPaymentMethod).not.toHaveBeenCalled();
  });

  it('carrera entre dos altas (P2002 de la base) -> 409', async () => {
    repo.createPaymentMethod.mockRejectedValue(p2002());
    await expect(
      createPaymentMethodService({ name: 'Nequi', isCash: false, isActive: true }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('un error desconocido se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    repo.createPaymentMethod.mockRejectedValue(boom);
    await expect(
      createPaymentMethodService({ name: 'X', isCash: false, isActive: true }),
    ).rejects.toBe(boom);
  });
});

describe('updatePaymentMethodService', () => {
  beforeEach(() => repo.findPaymentMethodById.mockResolvedValue(makeMethod()));

  it('desactivar solo cambia isActive: no se borra ni se toca lo demas', async () => {
    repo.updatePaymentMethod.mockImplementation(async (_id, data) => makeMethod(data));
    const out = await updatePaymentMethodService(ID, { name: 'Efectivo', isActive: false });
    expect(repo.updatePaymentMethod).toHaveBeenCalledWith(ID, {
      name: 'Efectivo',
      isActive: false,
    });
    expect(out.isActive).toBe(false);
  });

  it('no existe -> 404 y no actualiza', async () => {
    repo.findPaymentMethodById.mockResolvedValue(null);
    await expect(updatePaymentMethodService(ID, { name: 'X' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(repo.updatePaymentMethod).not.toHaveBeenCalled();
  });

  it('el nombre de otro metodo -> 409', async () => {
    repo.findPaymentMethodByName.mockResolvedValue(
      makeMethod({ paymentMethodId: OTHER, name: 'Nequi' }),
    );
    await expect(updatePaymentMethodService(ID, { name: 'nequi' })).rejects.toMatchObject({
      status: 409,
    });
    expect(repo.updatePaymentMethod).not.toHaveBeenCalled();
  });

  it('el propio nombre (aunque cambien las mayusculas) no es duplicado', async () => {
    repo.findPaymentMethodByName.mockResolvedValue(makeMethod({ name: 'efectivo' }));
    repo.updatePaymentMethod.mockImplementation(async (_id, data) => makeMethod(data));
    expect((await updatePaymentMethodService(ID, { name: 'Efectivo' })).name).toBe('Efectivo');
  });

  it('carrera con otra edicion (P2002) -> 409; un error desconocido se propaga', async () => {
    repo.updatePaymentMethod.mockRejectedValueOnce(p2002());
    await expect(updatePaymentMethodService(ID, { name: 'Nequi' })).rejects.toMatchObject({
      status: 409,
    });
    const boom = new Error('db caida');
    repo.updatePaymentMethod.mockRejectedValueOnce(boom);
    await expect(updatePaymentMethodService(ID, { name: 'Nequi' })).rejects.toBe(boom);
  });
});
