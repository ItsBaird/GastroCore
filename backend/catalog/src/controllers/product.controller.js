import {
  createProduct,
  getProduct,
  getPublicMenu,
  listProducts,
  listProductsForOrders,
  updateProduct,
} from '../services/product.service.js';

export async function listForOrders(req, res) {
  res.json(await listProductsForOrders(req.valid.query.ids));
}

export async function list(req, res) {
  res.json(await listProducts());
}

export async function getById(req, res) {
  res.json(await getProduct(req.valid.params.id));
}

export async function create(req, res) {
  res.status(201).json(await createProduct(req.valid.body, req.file));
}

export async function update(req, res) {
  res.json(await updateProduct(req.valid.params.id, req.valid.body, req.file));
}

// Publico y cambia con la disponibilidad: que ningun cache lo conserve sin revalidar
export async function publicMenu(req, res) {
  res.set('Cache-Control', 'no-cache');
  res.json(await getPublicMenu());
}
