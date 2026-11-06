import { createCategory, listCategories, updateCategory } from '../services/category.service.js';

export async function list(req, res) {
  res.json(await listCategories());
}

export async function create(req, res) {
  res.status(201).json(await createCategory(req.valid.body));
}

export async function update(req, res) {
  res.json(await updateCategory(req.valid.params.id, req.valid.body));
}
