import argon2 from 'argon2';

// Parametros minimos recomendados por OWASP para argon2id
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
