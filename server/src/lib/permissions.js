/**
 * Role model
 * ----------
 * user    — normal member. Can chat, call, share media, manage their own account.
 * staff   — read-only operations help: sees users and can triage the report queue.
 * manager — staff plus user moderation (suspend/restore, force logout) and notices.
 * admin   — full control, including roles, mail, settings and developer tools.
 *
 * Nobody is restricted from messaging or calling: staff and managers are just
 * members with extra console access.
 */
export const ROLES = ['user', 'staff', 'manager', 'admin'];

export const ROLE_RANK = { user: 0, staff: 1, manager: 2, admin: 3 };

export const ROLE_LABELS = {
  user: 'Member',
  staff: 'Staff',
  manager: 'Manager',
  admin: 'Administrator'
};

export const CAPABILITIES = [
  'console.access',
  'users.view',
  'users.moderate',
  'users.manage',
  'users.delete',
  'reports.view',
  'reports.review',
  'notices.view',
  'notices.manage',
  'mail.view',
  'mail.manage',
  'audit.view',
  'settings.manage',
  'developer.access'
];

const BY_ROLE = {
  user: [],
  staff: ['console.access', 'users.view', 'reports.view', 'reports.review', 'notices.view', 'audit.view'],
  manager: [
    'console.access',
    'users.view',
    'users.moderate',
    'reports.view',
    'reports.review',
    'notices.view',
    'notices.manage',
    'mail.view',
    'audit.view'
  ],
  admin: CAPABILITIES
};

export function capabilitiesFor(role) {
  return [...(BY_ROLE[role] ?? [])];
}

export function roleRank(role) {
  return ROLE_RANK[role] ?? 0;
}

export function hasCapability(role, capability) {
  return capabilitiesFor(role).includes(capability);
}

export function isStaff(role) {
  return roleRank(role) >= ROLE_RANK.staff;
}

/** Can `actorRole` act on a target with `targetRole` without escalating? */
export function canManageRole(actorRole, targetRole, { allowEqual = false } = {}) {
  if (!isStaff(actorRole)) return false;
  const diff = roleRank(actorRole) - roleRank(targetRole);
  return allowEqual ? diff >= 0 : diff > 0;
}

export function canAssignRole(actorRole, nextRole) {
  if (actorRole !== 'admin') return false;
  return ROLES.includes(nextRole);
}
