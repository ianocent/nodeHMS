import { Request, Response, NextFunction } from 'express';
import { error } from '../utils/response';

// Global error handler — replicates Laravel exception handler
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(`[${new Date().toISOString()}] Error:`, err.message || err);

  // Prisma errors
  if (err.code === 'P2025') {
    error(res, 'Record not found', 404);
    return;
  }
  if (err.code && err.code.startsWith('P20')) {
    error(res, 'Database error', 500);
    return;
  }

  // JWT errors (Phase 3)
  if (err.name === 'JsonWebTokenError') {
    error(res, 'Invalid token', 401);
    return;
  }
  if (err.name === 'TokenExpiredError') {
    error(res, 'Token expired', 401);
    return;
  }

  // Validation errors (express-validator / custom)
  if (err.status === 422 || err.code === 'VALIDATION_ERROR') {
    error(res, err.message || 'Validation failed', 422, err.errors);
    return;
  }

  // Known HTTP errors
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  error(res, message, status);
}
