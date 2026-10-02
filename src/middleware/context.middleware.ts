import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../config/prisma';

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  requestContext.run(req, () => {
    next();
  });
}
