import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  ROLE_LABELS,
  canAssignRole,
  canManageRole,
  capabilitiesFor,
  hasCapability,
  roleRank
} from '../src/lib/permissions.js';

test('roles are ordered from member to administrator', () => {
  assert.ok(roleRank('user') < roleRank('staff'));
  assert.ok(roleRank('staff') < roleRank('manager'));
  assert.ok(roleRank('manager') < roleRank('admin'));
});

test('member accounts never receive console capabilities', () => {
  assert.deepEqual(capabilitiesFor('user'), []);
  assert.equal(hasCapability('user', 'console.access'), false);
});

test('staff can read the queue but cannot moderate or manage settings', () => {
  const caps = capabilitiesFor('staff');
  assert.ok(caps.includes('console.access'));
  assert.ok(caps.includes('users.view'));
  assert.ok(caps.includes('reports.review'));
  assert.equal(caps.includes('users.moderate'), false);
  assert.equal(caps.includes('settings.manage'), false);
  assert.equal(caps.includes('mail.view'), false);
});

test('managers add moderation, notices and mail visibility', () => {
  const caps = capabilitiesFor('manager');
  assert.ok(caps.includes('users.moderate'));
  assert.ok(caps.includes('notices.manage'));
  assert.ok(caps.includes('mail.view'));
  assert.equal(caps.includes('users.delete'), false);
  assert.equal(caps.includes('settings.manage'), false);
});

test('administrators hold every capability', () => {
  assert.deepEqual(new Set(capabilitiesFor('admin')), new Set(CAPABILITIES));
});

test('role hierarchy prevents acting on equal or higher roles', () => {
  assert.equal(canManageRole('manager', 'staff'), true);
  assert.equal(canManageRole('manager', 'manager'), false);
  assert.equal(canManageRole('staff', 'manager'), false);
  assert.equal(canManageRole('admin', 'admin'), false);
  assert.equal(canManageRole('admin', 'admin', { allowEqual: true }), true);
  assert.equal(canManageRole('user', 'user', { allowEqual: true }), false);
});

test('only administrators can assign roles', () => {
  assert.equal(canAssignRole('admin', 'manager'), true);
  assert.equal(canAssignRole('manager', 'staff'), false);
  assert.equal(canAssignRole('admin', 'superuser'), false);
});

test('every role has a human label', () => {
  for (const role of Object.keys(ROLE_LABELS)) {
    assert.equal(typeof ROLE_LABELS[role], 'string');
    assert.ok(ROLE_LABELS[role].length > 0);
  }
});
