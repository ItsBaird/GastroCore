import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  loginSchema,
  updateUserSchema,
  userIdParamsSchema,
} from './user.schema.js';

// Copia del objeto sin uno de sus campos
const sin = (obj, campo) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== campo));

const valid = { email: 'mesero@lapizzeta.com', password: 'ClaveSegura123', role: 'WAITER' };

// Rutas de los campos inválidos y sus mensajes (lo que viaja en details.fields del 400)
function issues(schema, input) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('createUserSchema (GC-AUTH-0001, criterios 1 y 3)', () => {
  it('acepta email válido, contraseña de 10+ caracteres y un rol permitido', () => {
    expect(createUserSchema.parse(valid)).toEqual(valid);
  });

  it.each(['ADMIN', 'WAITER', 'COOK'])('acepta el rol %s', (role) => {
    expect(createUserSchema.parse({ ...valid, role }).role).toBe(role);
  });

  it('normaliza el email: sin espacios y en minúsculas', () => {
    const out = createUserSchema.parse({ ...valid, email: '  Mesero@LaPizzeta.COM ' });
    expect(out.email).toBe('mesero@lapizzeta.com');
  });

  describe('contraseña', () => {
    it('acepta exactamente 10 caracteres', () => {
      expect(createUserSchema.safeParse({ ...valid, password: '1234567890' }).success).toBe(true);
    });

    it('rechaza 9 caracteres e indica el campo password', () => {
      expect(issues(createUserSchema, { ...valid, password: '123456789' })).toEqual([
        { path: 'password', message: 'La contrasena debe tener al menos 10 caracteres' },
      ]);
    });

    it('acepta 128 y rechaza 129 caracteres (evita gastar CPU en argon2)', () => {
      expect(createUserSchema.safeParse({ ...valid, password: 'a'.repeat(128) }).success).toBe(
        true,
      );
      expect(issues(createUserSchema, { ...valid, password: 'a'.repeat(129) })).toEqual([
        { path: 'password', message: 'La contrasena admite hasta 128 caracteres' },
      ]);
    });

    it('es obligatoria', () => {
      const sinPassword = sin(valid, 'password');
      expect(issues(createUserSchema, sinPassword)).toEqual([
        { path: 'password', message: 'La contrasena es obligatoria' },
      ]);
    });
  });

  describe('rol', () => {
    it('rechaza un rol que no existe e indica el campo role', () => {
      expect(issues(createUserSchema, { ...valid, role: 'JEFE' })).toEqual([
        { path: 'role', message: 'El rol debe ser ADMIN, WAITER o COOK' },
      ]);
    });

    it('distingue mayúsculas: "waiter" no es un rol válido', () => {
      expect(issues(createUserSchema, { ...valid, role: 'waiter' })[0].path).toBe('role');
    });

    it('es obligatorio', () => {
      const sinRol = sin(valid, 'role');
      expect(issues(createUserSchema, sinRol)[0].path).toBe('role');
    });
  });

  describe('email', () => {
    it.each(['no-es-un-email', 'sin-arroba.com', 'a@', '@dominio.com', ''])(
      'rechaza "%s"',
      (email) => {
        expect(issues(createUserSchema, { ...valid, email })[0].path).toBe('email');
      },
    );

    it('rechaza más de 255 caracteres', () => {
      const largo = `${'a'.repeat(250)}@lapizzeta.com`;
      expect(issues(createUserSchema, { ...valid, email: largo })).toEqual([
        { path: 'email', message: 'El email admite hasta 255 caracteres' },
      ]);
    });

    it('es obligatorio', () => {
      const sinEmail = sin(valid, 'email');
      expect(issues(createUserSchema, sinEmail)).toEqual([
        { path: 'email', message: 'El email es obligatorio' },
      ]);
    });
  });

  it('reporta TODOS los campos inválidos a la vez (criterio 3)', () => {
    const found = issues(createUserSchema, { email: 'x', password: 'corta', role: 'JEFE' });
    expect(found.map((f) => f.path).sort()).toEqual(['email', 'password', 'role']);
  });

  it('un cuerpo vacío marca los tres campos como obligatorios', () => {
    expect(
      issues(createUserSchema, {})
        .map((f) => f.path)
        .sort(),
    ).toEqual(['email', 'password', 'role']);
  });

  it('descarta campos desconocidos (no se puede crear un usuario ya activo/bloqueado a mano)', () => {
    const out = createUserSchema.parse({
      ...valid,
      isActive: false,
      userId: 'x',
      passwordHash: 'y',
    });
    expect(Object.keys(out).sort()).toEqual(['email', 'password', 'role']);
  });
});

describe('updateUserSchema (REQ-F01-07: solo rol y estado)', () => {
  it('acepta solo el rol', () => {
    expect(updateUserSchema.parse({ role: 'COOK' })).toEqual({ role: 'COOK' });
  });

  it('acepta solo isActive (true o false)', () => {
    expect(updateUserSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateUserSchema.parse({ isActive: true })).toEqual({ isActive: true });
  });

  it('acepta rol e isActive juntos', () => {
    expect(updateUserSchema.parse({ role: 'ADMIN', isActive: true })).toEqual({
      role: 'ADMIN',
      isActive: true,
    });
  });

  it('rechaza un cuerpo vacío: hay que enviar role o isActive', () => {
    expect(issues(updateUserSchema, {})[0].message).toBe('Debes enviar al menos role o isActive');
  });

  it('rechaza un rol inexistente', () => {
    expect(issues(updateUserSchema, { role: 'JEFE' })[0].path).toBe('role');
  });

  it('isActive debe ser booleano: "false" como texto no vale', () => {
    expect(issues(updateUserSchema, { isActive: 'false' })[0]).toEqual({
      path: 'isActive',
      message: 'isActive debe ser verdadero o falso',
    });
  });

  it('descarta email y contraseña: no se editan en este endpoint', () => {
    const out = updateUserSchema.parse({
      role: 'COOK',
      email: 'otro@x.com',
      password: 'otra-clave-123',
      passwordHash: 'hack',
    });
    expect(out).toEqual({ role: 'COOK' });
  });
});

describe('userIdParamsSchema', () => {
  it('acepta un UUID', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(userIdParamsSchema.parse({ id })).toEqual({ id });
  });

  it.each(['abc', '123', '', '22222222-2222-4222-8222-22222222222'])('rechaza "%s"', (id) => {
    expect(issues(userIdParamsSchema, { id })).toEqual([
      { path: 'id', message: 'El id debe ser un UUID valido' },
    ]);
  });
});

describe('loginSchema', () => {
  it('no exige el mínimo de 10 caracteres (no revela la política de contraseñas)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('normaliza el email como el alta', () => {
    expect(loginSchema.parse({ email: '  A@B.CO ', password: 'x' }).email).toBe('a@b.co');
  });

  it('exige email válido y contraseña no vacía', () => {
    expect(
      issues(loginSchema, { email: 'no-es-email', password: '' })
        .map((f) => f.path)
        .sort(),
    ).toEqual(['email', 'password']);
  });

  it('acepta contraseñas con espacios y las conserva tal cual', () => {
    expect(loginSchema.parse({ email: 'a@b.co', password: ' con espacios ' }).password).toBe(
      ' con espacios ',
    );
  });
});
