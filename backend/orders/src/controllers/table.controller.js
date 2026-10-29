import {
  createTableService,
  listTablesService,
  updateTableService,
} from '../services/table.service.js';

export async function create(req, res) {
  const table = await createTableService(req.valid.body);
  res.status(201).json(table);
}

export async function update(req, res) {
  const table = await updateTableService(req.valid.params.id, req.valid.body);
  res.json(table);
}

export async function list(req, res) {
  res.json(await listTablesService());
}
