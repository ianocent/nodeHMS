// Permission codes matching Laravel config/cms.php
export const PERMISSION_CODES = {
  view: { code: 'view', status: 1 },
  add: { code: 'add', status: 1 },
  edit: { code: 'edit', status: 1 },
  delete: { code: 'delete', status: 1 },
  active: { code: 'active', status: 1 },
  approve: { code: 'approve', status: 1 },
  reject: { code: 'reject', status: 1 },
  change_password: { code: 'change_password', status: 1 },
} as const;

export type PermissionAction = keyof typeof PERMISSION_CODES;

// Super-user role names (bypass all permission checks)
export const SUPER_ROLES = ['developer', 'anyaman'] as const;

// Token settings (matching Laravel Sanctum config)
export const TOKEN_EXPIRATION_HOURS = 24;
export const TOKEN_IDLE_TIMEOUT_MINUTES = 30;
