import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  updateUser,
} from '../services/user.service.js';

export async function register(req, res) {
  const user = await createUser(req.valid.body);
  res.status(201).json(user);
}

export async function list(req, res) {
  res.json(await listUsers());
}

export async function getById(req, res) {
  res.json(await getUser(req.valid.params.id));
}

export async function update(req, res) {
  res.json(await updateUser(req.user.userId, req.valid.params.id, req.valid.body));
}

export async function deactivate(req, res) {
  await deactivateUser(req.user.userId, req.valid.params.id);
  res.status(204).end();
}
