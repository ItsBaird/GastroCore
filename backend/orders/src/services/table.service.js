import crypto from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import {
  createTable,
  findAllTablesOrderedByNumber,
  findTableById,
  updateTable,
} from '../repositories/table.repository.js';

const MAX_QR_RETRIES = 3;

function generateQrToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function isPrismaUniqueViolation(err, field) {
  return err?.code === 'P2002' && err.meta?.target?.includes(field);
}

function toResponse(table) {
  return {
    tableId: table.tableId,
    tableNumber: table.tableNumber,
    qrToken: table.qrToken,
  };
}

export async function createTableService({ tableNumber }) {
  for (let attempt = 0; attempt < MAX_QR_RETRIES; attempt++) {
    try {
      const table = await createTable({
        tableNumber,
        qrToken: generateQrToken(),
      });
      return toResponse(table);
    } catch (err) {
      if (isPrismaUniqueViolation(err, 'table_number')) {
        throw new AppError({
          status: 409,
          code: 'CONFLICT',
          message: 'El numero de mesa ya existe',
        });
      }
      if (isPrismaUniqueViolation(err, 'qr_token') && attempt < MAX_QR_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}

export async function updateTableService(id, { tableNumber }) {
  const existing = await findTableById(id);
  if (!existing) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Mesa no encontrada' });
  }

  try {
    const updated = await updateTable(id, { tableNumber });
    return toResponse(updated);
  } catch (err) {
    if (isPrismaUniqueViolation(err, 'table_number')) {
      throw new AppError({
        status: 409,
        code: 'CONFLICT',
        message: 'El numero de mesa ya existe',
      });
    }
    throw err;
  }
}

export async function listTablesService() {
  const tables = await findAllTablesOrderedByNumber();
  return tables.map(toResponse);
}
