import { catalogClient } from '../clients/catalogClient.js';
import {
  preparationByProduct,
  salesByDay,
  salesByHour,
  salesByPaymentMethod,
  salesByWaiter,
  salesTotals,
  soldProducts,
} from '../repositories/dashboard.repository.js';
import { buildDashboard } from './dashboard.js';
import { periodRange, resolvePeriods } from './dashboardPeriod.js';

// Catalog admite hasta 100 ids por consulta interna
const CATALOG_BATCH = 100;

// Categoria ACTUAL de cada producto segun Catalog (los items no guardan la categoria; R2: se pide por REST, no se
// cruza de base). Si Catalog no responde o todavia no devuelve la categoria, el desglose no se inventa: null, y
// el promedio global de preparacion sigue valiendo.
export async function resolveCategories(productIds) {
  if (productIds.length === 0) return new Map();
  try {
    const batches = [];
    for (let i = 0; i < productIds.length; i += CATALOG_BATCH) {
      batches.push(catalogClient.getProductsByIds(productIds.slice(i, i + CATALOG_BATCH)));
    }
    const products = (await Promise.all(batches)).flat();
    if (products.some((p) => !p.categoryId || !p.categoryName)) {
      console.warn(
        'Dashboard: Catalog no devolvio la categoria de los productos; se omite el desglose',
      );
      return null;
    }
    return new Map(
      products.map((p) => [
        p.productId,
        { categoryId: p.categoryId, categoryName: p.categoryName },
      ]),
    );
  } catch (err) {
    console.warn(
      'Dashboard: no se pudo consultar Catalog para las categorias',
      err?.code ?? err?.message,
    );
    return null;
  }
}

// GC-RPT-0004 (GC-197 a GC-200). Solo lectura: sin escrituras, sin eventos, sin auditoria. Las consultas de los
// dos periodos van en paralelo; el anterior solo necesita los totales y la preparacion.
export async function getDashboard(query = {}, now = new Date()) {
  const { period, previousPeriod } = resolvePeriods(query, now);
  const current = periodRange(period);
  const previous = periodRange(previousPeriod);

  const [
    totals,
    previousTotals,
    byDay,
    byHour,
    waiters,
    methods,
    products,
    preparation,
    previousPreparation,
  ] = await Promise.all([
    salesTotals(current),
    salesTotals(previous),
    salesByDay(current),
    salesByHour(current),
    salesByWaiter(current),
    salesByPaymentMethod(current),
    soldProducts(current),
    preparationByProduct(current),
    preparationByProduct(previous),
  ]);

  const discarded = [...preparation, ...previousPreparation].reduce(
    (sum, r) => sum + r.discarded,
    0,
  );
  if (discarded > 0) {
    console.warn(`Dashboard: ${discarded} items con ready_at anterior a su ronda no se midieron`);
  }

  const measured = preparation.filter((r) => r.items > 0);
  const categories = await resolveCategories(measured.map((r) => r.productId));

  return buildDashboard({
    period,
    previousPeriod,
    totals,
    previousTotals,
    byDay,
    byHour,
    waiters,
    methods,
    products,
    preparation: measured,
    previousPreparation: previousPreparation.filter((r) => r.items > 0),
    categories,
  });
}
