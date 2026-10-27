import { createUser } from '../services/user.service.js';

export async function register(req, res) {
  const user = await createUser(req.valid.body);
  res.status(201).json(user);
}
