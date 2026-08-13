import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import { unauthorized } from '../utils/response';
import { SUPER_ROLES, TOKEN_EXPIRATION_HOURS, TOKEN_IDLE_TIMEOUT_MINUTES } from '../config/permissions';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Extend Express Request to include user
export interface AuthUser {
  id: bigint;
  name: string;
  username: string;
  email: string;
  roles: string[];           // role names
  roleIds: bigint[];          // role IDs
  lastProperty: bigint | null;
  superUser: boolean;         // developer or anyaman
  permissions: Map<bigint, RoleMenuCrud>;  // menu_id → crud booleans (cached)
}

export interface RoleMenuCrud {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  transactionActions: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Hash token using SHA-256 (matches Laravel Sanctum hashing).
 * In Sanctum, the stored token = hash('sha256', $plainTextToken).
 * The client sends "id|plainTextToken". We split, hash, and compare.
 */
function hashToken(plainText: string): string {
  return crypto.createHash('sha256').update(plainText).digest('hex');
}

/**
 * Auth middleware — validates X-Token header against personal_access_tokens.
 * Replicates Sanctum + AuthServiceProvider idle timeout check.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let tokenHeader = req.headers['x-token'] as string | undefined;

  // Fallback to Authorization: Bearer <token>
  if (!tokenHeader) {
    const authHeader = req.headers['authorization'] as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      tokenHeader = authHeader.slice(7);
    }
  }

  if (!tokenHeader) {
    unauthorized(res, 'Token not provided');
    return;
  }

  try {
    // Sanctum token format: "id|plainTextToken"
    const parts = tokenHeader.split('|');
    if (parts.length !== 2) {
      unauthorized(res, 'Invalid token format');
      return;
    }

    const tokenId = parts[0];
    const plainTextToken = parts[1];
    const hashedToken = hashToken(plainTextToken);

    // Find token record
    const tokenRecord = await prisma.personal_access_tokens.findFirst({
      where: {
        id: BigInt(tokenId),
        token: hashedToken,
      },
    });

    if (!tokenRecord) {
      unauthorized(res, 'Invalid token');
      return;
    }

    // Check token expiration (absolute)
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
      unauthorized(res, 'Token expired');
      return;
    }

    // Check idle timeout (30 min, like Laravel has_token)
    if (tokenRecord.last_used_at) {
      const idleMs = Date.now() - new Date(tokenRecord.last_used_at).getTime();
      const idleMinutes = idleMs / 60000;
      if (idleMinutes > TOKEN_IDLE_TIMEOUT_MINUTES) {
        unauthorized(res, 'Token idle timeout');
        return;
      }
    }

    // Update last_used_at (non-blocking, fire-and-forget)
    prisma.personal_access_tokens
      .update({
        where: { id: tokenRecord.id },
        data: { last_used_at: new Date() },
      })
      .catch(() => {}); // Suppress errors, avoid blocking response

    // Find user with roles
    const user = await prisma.users.findUnique({
      where: { id: tokenRecord.tokenable_id },
      include: {
        // roles via model_has_roles
        // Prisma doesn't support polymorphic relations directly,
        // so we query model_has_roles separately
      },
    });

    if (!user || user.status === 0) {
      unauthorized(res, 'User not found or inactive');
      return;
    }

    // Get user roles via model_has_roles
    const modelRoles = await prisma.model_has_roles.findMany({
      where: {
        model_type: 'App\\Models\\User',  // Laravel morph map
        model_id: user.id,
      },
      include: {
        roles: true,
      },
    });

    const roleNames = modelRoles.map(mr => mr.roles.name);
    const roleIds = modelRoles.map(mr => mr.roles.id);

    // Super-user check
    const isSuperUser = roleNames.some(r => (SUPER_ROLES as readonly string[]).includes(r));

    // Fetch permissions from role_menu_crud (cached per role set)
    const menuCrudRecords = await prisma.role_menu_crud.findMany({
      where: {
        role_id: { in: roleIds },
      },
    });

    const permissions = new Map<bigint, RoleMenuCrud>();
    for (const record of menuCrudRecords) {
      const existing = permissions.get(record.menu_id);
      // Merge: OR across roles (any role granting = allowed)
      permissions.set(record.menu_id, {
        view: (existing?.view || record.view) as boolean,
        add: (existing?.add || record.add) as boolean,
        edit: (existing?.edit || record.edit) as boolean,
        delete: (existing?.delete || record.delete) as boolean,
        transactionActions: record.transaction_actions || existing?.transactionActions || null,
      });
    }

    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      roles: roleNames,
      roleIds,
      lastProperty: user.last_property,
      superUser: isSuperUser,
      permissions,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    unauthorized(res, 'Authentication failed');
  }
}
