import { Router } from 'express';
import { listKitchenRoundsController } from '../controllers/kitchen.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { requireCookShift } from '../middlewares/requireCookShift.js';

export const kitchenRouter = Router();

// El COOK necesita turno activo (contrato aprobado, reemplaza la decision K3); el ADMIN no.
kitchenRouter.get(
  '/',
  authenticate,
  requireRole('COOK', 'ADMIN'),
  requireCookShift,
  listKitchenRoundsController,
);
