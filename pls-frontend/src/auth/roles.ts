import type { SessionRole } from '../stores/authStore';

// Route access per role (parity plan WP 1.4); the server enforces the same policies.
export const ALL_ROLES: readonly SessionRole[] = ['admin', 'leitstelle', 'user', 'qr'];
export const STAFF_ROLES: readonly SessionRole[] = ['admin', 'leitstelle'];
export const ADMIN_ONLY: readonly SessionRole[] = ['admin'];
export const PASSWORD_ROLES: readonly SessionRole[] = ['admin', 'leitstelle', 'user'];
