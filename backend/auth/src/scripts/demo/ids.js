import { createHash } from 'node:crypto';

// Seed de demostracion. Id determinista a partir de un nombre: el mismo texto da el MISMO UUID en los cuatro
// servicios, asi que cada seed referencia a los usuarios y productos de los demas sin consultarlos (las bases estan
// separadas y las claves entre servicios son logicas, R2). Tambien hace que ejecutar el seed dos veces no duplique
// nada. Esta copia es identica en auth, staff, catalog y orders; ids.test.js fija los valores en cada una.
export function seedUuid(name) {
  const hash = createHash('sha1').update(`gastrocore-demo:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// Los seeds de demostracion dejan contrasenas conocidas y datos falsos: nunca en produccion, salvo que se pida
// de forma explicita (por ejemplo, una demo publica en la nube).
export function assertDemoSeedAllowed(env = process.env) {
  if (env.NODE_ENV === 'production' && env.SEED_DEMO_FORCE !== 'true') {
    throw new Error(
      'El seed de demostracion no se ejecuta con NODE_ENV=production (deja contrasenas conocidas). ' +
        'Si es una demo a proposito, define SEED_DEMO_FORCE=true.',
    );
  }
}
