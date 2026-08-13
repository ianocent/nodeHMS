// Global test setup: mock auth middleware so tests don't need real JWT
import { Request, Response, NextFunction } from 'express';
import { AuthUser } from '../middleware/auth.middleware';

// Set a default test user on req.user for all tests
export const TEST_USER: AuthUser = {
  id: 1n,
  superUser: true,
  lastProperty: 1n,
  email: 'admin@test.com',
  name: 'Test Admin',
  username: 'admin',
  roles: ['administrator'],
  roleIds: [1n],
  permissions: new Map(),
};

// Mock auth middleware — attaches TEST_USER
export function mockAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.user = { ...TEST_USER };
  next();
}

// Mock requirePermission — always passes
export function mockRequirePermission(_menuId: number, _action: string) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
