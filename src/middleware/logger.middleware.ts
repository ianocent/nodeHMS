import { Request, Response, NextFunction } from 'express';

// Request logger — replicates Laravel log middleware
export function requestLogger(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  // Log on response finish
  _res.on('finish', () => {
    const duration = Date.now() - start;
    const status = _res.statusCode;
    const icon = status >= 500 ? '🔴' : status >= 400 ? '🟡' : '🟢';
    console.log(
      `[${new Date().toISOString()}] ${icon} ${method} ${originalUrl} → ${status} (${duration}ms)`
    );
  });

  next();
}
