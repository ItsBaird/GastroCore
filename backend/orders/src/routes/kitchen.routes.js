import { Router } from 'express';
import { listKitchenRoundsController } from '../controllers/kitchen.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';

export const kitchenRouter = Router();

// Sin turno activo a proposito: el cocinero ve la cocina al entrar (decision K3 de GC-ORD-0004).
// Si el negocio decide exigirlo, este es el unico punto a cambiar.
kitchenRouter.get('/', authenticate, requireRole('COOK', 'ADMIN'), listKitchenRoundsController);
