import { createProduct } from '../services/product.service.js';

export async function create(req, res) {
  res.status(201).json(await createProduct(req.valid.body, req.file));
}
