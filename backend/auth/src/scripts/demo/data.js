// Usuarios de demostracion de La Pizzeta. El id de cada uno sale de seedUuid(`user:${key}`): Staff y Orders usan
// el mismo calculo para referenciarlos sin consultar esta base. El ADMIN no esta aqui: lo crea `seed:admin`.
export const DEMO_USERS = [
  { key: 'mesero1', email: 'mesero1@lapizzeta.com', role: 'WAITER' },
  { key: 'mesero2', email: 'mesero2@lapizzeta.com', role: 'WAITER' },
  { key: 'mesero3', email: 'mesero3@lapizzeta.com', role: 'WAITER' },
  { key: 'cocinero1', email: 'cocinero1@lapizzeta.com', role: 'COOK' },
];

// Contrasena comun de los usuarios de demostracion si no se define DEMO_PASSWORD en el entorno (minimo 10
// caracteres). Solo para desarrollo y demos: el seed se niega a correr en produccion.
export const DEFAULT_DEMO_PASSWORD = 'LaPizzeta-Demo-2026';
