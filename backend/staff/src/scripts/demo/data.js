import { seedUuid } from './ids.js';

// Empleados de demostracion: el userId es el MISMO que calcula el seed de Auth (seedUuid(`user:${key}`)).
// `today` y `tomorrow` dicen que turno se deja a cada uno: 'activo' (ya iniciado: el mesero puede abrir mesas),
// 'programado' (para practicar el inicio de turno) o null.
export const DEMO_EMPLOYEES = [
  {
    key: 'mesero1',
    fullName: 'Laura Gómez Pérez',
    phone: '3001112233',
    documentNumber: '1000000001',
    position: 'Mesero',
    hireDate: '2025-02-03',
    today: 'activo',
  },
  {
    key: 'mesero2',
    fullName: 'Carlos Ruiz Torres',
    phone: '3002223344',
    documentNumber: '1000000002',
    position: 'Mesero',
    hireDate: '2025-04-14',
    today: 'programado',
  },
  {
    key: 'mesero3',
    fullName: 'Valentina Rojas Díaz',
    phone: '3003334455',
    documentNumber: '1000000003',
    position: 'Mesero',
    hireDate: '2025-08-01',
    tomorrow: 'programado',
  },
  {
    key: 'cocinero1',
    fullName: 'Andrés Mejía Castro',
    phone: '3004445566',
    documentNumber: '1000000004',
    position: 'Cocinero',
    hireDate: '2024-11-20',
    today: 'activo',
  },
];

const MINUTE = 60 * 1000;
// Colombia no tiene horario de verano: el dia del restaurante es UTC-5 todo el ano
const OFFSET = '-05:00';

export const bogotaTime = (date, time) => new Date(`${date}T${time}:00${OFFSET}`);

// Dia (AAAA-MM-DD) del restaurante en el instante `now`
export function todayBogota(now = new Date()) {
  return new Date(now.getTime() - 5 * 60 * MINUTE).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Turnos de ejemplo, deterministas por (empleado, dia) para que repetir el seed no duplique:
//   - los ultimos `pastDays` dias: finalizados, de 10:00 a 22:00 (con unos minutos de diferencia real);
//   - hoy y manana: segun el perfil del empleado, de 06:00 a 23:00 (un turno activo ya empezo).
export function buildShifts({ now = new Date(), employees = DEMO_EMPLOYEES, pastDays = 7 } = {}) {
  const today = todayBogota(now);
  const shifts = [];

  for (const employee of employees) {
    for (let back = pastDays; back >= 1; back -= 1) {
      const date = addDays(today, -back);
      const scheduledStart = bogotaTime(date, '10:00');
      const scheduledEnd = bogotaTime(date, '22:00');
      shifts.push({
        shiftId: seedUuid(`shift:${employee.key}:${date}`),
        key: employee.key,
        date,
        scheduledStart,
        scheduledEnd,
        status: 'finalizado',
        actualStart: new Date(scheduledStart.getTime() + 5 * MINUTE),
        actualEnd: new Date(scheduledEnd.getTime() + 2 * MINUTE),
      });
    }

    for (const [when, status] of [
      [today, employee.today],
      [addDays(today, 1), employee.tomorrow],
    ]) {
      if (!status) continue;
      const scheduledStart = bogotaTime(when, '06:00');
      shifts.push({
        shiftId: seedUuid(`shift:${employee.key}:${when}`),
        key: employee.key,
        date: when,
        scheduledStart,
        scheduledEnd: bogotaTime(when, '23:00'),
        status,
        // Un turno activo ya empezo: nunca en el futuro aunque el seed corra de madrugada
        actualStart:
          status === 'activo'
            ? new Date(Math.min(scheduledStart.getTime(), now.getTime() - MINUTE))
            : null,
        actualEnd: null,
      });
    }
  }
  return shifts;
}
