import { createShift, listShifts } from '../services/shift.service.js';

export async function list(req, res) {
  res.json(await listShifts(req.valid.query));
}

export async function create(req, res) {
  res.status(201).json(await createShift(req.valid.body));
}
