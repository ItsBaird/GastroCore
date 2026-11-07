import { mondayOf, todayKey } from '../utils/shift.js';
import { listEmployees, listShifts } from './staff.js';
import { listUsers } from './users.js';

// Meseros que pueden recibir una mesa ahora mismo. Ningun endpoint da esta lista: el turno vive en
// Staff, el nombre en el perfil de empleado y el rol en Auth. Solo sirve para el ADMIN.
export async function listActiveWaiters() {
  const [shifts, employees, users] = await Promise.all([
    listShifts({ week: mondayOf(todayKey()) }),
    listEmployees(),
    listUsers(),
  ]);
  const activeIds = new Set(shifts.filter((s) => s.status === 'activo').map((s) => s.userId));
  const names = new Map(employees.map((e) => [e.userId, e.fullName]));

  return users
    .filter((u) => u.role === 'WAITER' && u.isActive && activeIds.has(u.userId))
    .map((u) => ({ userId: u.userId, name: names.get(u.userId) ?? u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
