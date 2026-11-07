import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitItemStatusChanged, emitRoundCreated, setIo } from './events.js';
import { joinRooms } from './rooms.js';

describe('salas por rol', () => {
  const roomsOf = (role) => {
    const socket = { data: { user: { role, userId: 'u1' } }, join: vi.fn() };
    joinRooms(socket);
    return socket.join.mock.calls.map(([room]) => room);
  };

  it('COOK entra solo a kitchen', () => {
    expect(roomsOf('COOK')).toEqual(['kitchen']);
  });

  it('ADMIN entra a waiters, a su sala propia y a kitchen', () => {
    expect(roomsOf('ADMIN')).toEqual(['waiters', 'waiter:u1', 'kitchen']);
  });

  it('WAITER no entra a kitchen', () => {
    expect(roomsOf('WAITER')).toEqual(['waiters', 'waiter:u1']);
  });
});

describe('eventos de cocina', () => {
  let emit;
  let to;

  beforeEach(() => {
    emit = vi.fn();
    to = vi.fn(() => ({ emit }));
    setIo({ to });
  });

  it('item:status_changed sale una sola vez a kitchen y al mesero, con mesa y orden', () => {
    emitItemStatusChanged({
      item: { itemId: 'i1', status: 'listo' },
      orderId: 'o1',
      tableNumber: 7,
      waiterId: 'w1',
    });

    expect(to).toHaveBeenCalledOnce();
    expect(to).toHaveBeenCalledWith(['kitchen', 'waiter:w1']);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith('item:status_changed', {
      itemId: 'i1',
      status: 'listo',
      orderId: 'o1',
      tableNumber: 7,
    });
  });

  it('round:created sale a kitchen', () => {
    const round = { roundId: 'r1', source: 'WAITER' };

    emitRoundCreated(round);

    expect(to).toHaveBeenCalledWith('kitchen');
    expect(emit).toHaveBeenCalledWith('round:created', round);
  });
});
