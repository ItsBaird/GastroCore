import {
  createShift,
  endShift,
  getActiveShift,
  listShifts,
  startShift,
} from '../services/shift.service.js';

export async function list(req, res) {
  res.json(await listShifts(req.valid.query));
}

export async function create(req, res) {
  res.status(201).json(await createShift(req.valid.body));
}

export async function start(req, res) {
  res.json(await startShift(req.valid.params.id, req.user));
}

export async function end(req, res) {
  res.json(await endShift(req.valid.params.id, req.user));
}

export async function activeShift(req, res) {
  res.json(await getActiveShift(req.valid.params.userId));
}
