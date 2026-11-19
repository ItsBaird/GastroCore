// Espera maxima de las llamadas de Orders a otros servicios (Staff y Catalog). El contrato fija 3 s; en Render
// gratis un servicio dormido tarda ~50 s en despertar, asi que alli se sube con INTERNAL_TIMEOUT_MS.
// Va aparte de env.js porque los clientes leen su configuracion directo del entorno (como CATALOG_SERVICE_URL)
// y sus pruebas se cargan sin las variables obligatorias del servicio. Se valida al importar: un valor invalido
// detiene el arranque en vez de quedarse con un tiempo de espera inesperado.
export const DEFAULT_INTERNAL_TIMEOUT_MS = 3000;
const MIN_MS = 500;
const MAX_MS = 120000;

export function parseInternalTimeout(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_INTERNAL_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_MS || value > MAX_MS) {
    throw new Error(
      `Variables de entorno invalidas: INTERNAL_TIMEOUT_MS debe ser un entero entre ${MIN_MS} y ${MAX_MS} (ms)`,
    );
  }
  return value;
}

export const INTERNAL_TIMEOUT_MS = parseInternalTimeout(process.env.INTERNAL_TIMEOUT_MS);
