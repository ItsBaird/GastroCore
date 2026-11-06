import {
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from '../services/employee.service.js';

export async function list(req, res) {
  res.json(await listEmployees());
}

export async function getById(req, res) {
  res.json(await getEmployee(req.valid.params.userId));
}

export async function create(req, res) {
  res.status(201).json(await createEmployee(req.valid.body, req.headers.authorization));
}

export async function update(req, res) {
  res.json(await updateEmployee(req.valid.params.userId, req.valid.body));
}
