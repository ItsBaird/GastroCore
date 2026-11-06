import express, { Router } from 'express';
import { env } from '../config/env.js';
import { create as createCategory, list, update } from '../controllers/category.controller.js';
import {
  create as createProduct,
  getById as getProductById,
  list as listProducts,
  publicMenu,
  update as updateProduct,
} from '../controllers/product.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { uploadPhoto } from '../middlewares/uploadPhoto.js';
import { validate } from '../middlewares/validate.js';
import { categoryIdParamsSchema, categoryInputSchema } from '../schemas/category.schema.js';
import {
  createProductSchema,
  productIdParamsSchema,
  updateProductSchema,
} from '../schemas/product.schema.js';

export const catalogRouter = Router();

// Fotos de productos: publicas (las ve el menu de clientes por QR). Los nombres los genera el
// servidor (UUID), son inmutables y no se lista el directorio.
catalogRouter.use(
  '/photos',
  express.static(env.uploadsDir, { index: false, immutable: true, maxAge: '7d', dotfiles: 'deny' }),
);

// Menu para clientes (QR): sin login. El gateway limita las peticiones por IP
catalogRouter.get('/public/menu', publicMenu);

// Cualquier usuario autenticado puede consultar categorias; solo el ADMIN las modifica
catalogRouter.get('/categories', authenticate, list);
catalogRouter.post(
  '/categories',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: categoryInputSchema }),
  createCategory,
);
catalogRouter.put(
  '/categories/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: categoryIdParamsSchema, body: categoryInputSchema }),
  update,
);

// Lectura para cualquier rol autenticado (incluye productos no disponibles)
catalogRouter.get('/products', authenticate, listProducts);
catalogRouter.get(
  '/products/:id',
  authenticate,
  validate({ params: productIdParamsSchema }),
  getProductById,
);

// GC-CAT-0001: multipart/form-data con la foto obligatoria. El rol se comprueba antes de
// procesar el archivo para no gastar memoria en peticiones que no son de un ADMIN.
catalogRouter.post(
  '/products',
  authenticate,
  requireRole('ADMIN'),
  uploadPhoto,
  validate({ body: createProductSchema }),
  createProduct,
);

// Editar datos, cambiar la foto o solo la disponibilidad (ADMIN). Misma carga multipart que el alta;
// todos los campos son opcionales.
catalogRouter.put(
  '/products/:id',
  authenticate,
  requireRole('ADMIN'),
  uploadPhoto,
  validate({ params: productIdParamsSchema, body: updateProductSchema }),
  updateProduct,
);
