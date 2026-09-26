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
    const mem =
      process.memoryUsage().heapUsed > 256 * 1024 * 1024
        ? ` heap=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`
        : '';
    const len = _res.getHeader('content-length') ?? _res.getHeader('x-response-length');
    const lenStr = len ? ` len=${len}` : '';
    console.log(
      `[${new Date().toISOString()}] ${icon} ${method} ${originalUrl} → ${status} (${duration}ms)${mem}${lenStr}`
    );
  });

  next();
}
