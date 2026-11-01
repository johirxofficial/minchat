import test from 'node:test';
import assert from 'node:assert/strict';
import { maskPhone, normalizePhone, PHONE_RE } from '../src/lib/phone.js';
import { validateSettingsPatch } from '../src/lib/settings.js';
import { renderTemplate, templates } from '../src/lib/mailTemplates.js';

test('phone numbers normalize to E.164 and reject junk', () => {
  assert.equal(normalizePhone('+880 1712-345678'), '+8801712345678');
  assert.equal(normalizePhone('+1 (555) 010-9999'), '+15550109999');
  assert.equal(normalizePhone('01712345678'), null);
  assert.equal(normalizePhone('+0123456789'), null);
  assert.equal(normalizePhone('not a phone'), null);
  assert.equal(normalizePhone(null), null);
});

test('phone masking keeps only the country prefix and last three digits', () => {
  assert.equal(maskPhone('+8801712345678'), '+88•••678');
  assert.equal(maskPhone(null), null);
});

test('phone regex only accepts international format', () => {
  assert.equal(PHONE_RE.test('+8801712345678'), true);
  assert.equal(PHONE_RE.test('+880171234567'), true);
  assert.equal(PHONE_RE.test('8801712345678'), false);
});

test('runtime settings patch drops unknown keys and coerces numbers', async () => {
  const clean = await validateSettingsPatch({
    registration_open: false,
    max_upload_mb: '40',
    support_email: 'help@example.com',
    not_a_setting: 'ignored'
  });
  assert.deepEqual(clean, {
    registration_open: false,
    max_upload_mb: 40,
    support_email: 'help@example.com'
  });
});

test('invalid setting values are not applied', async () => {
  const clean = await validateSettingsPatch({ max_upload_mb: 500, support_email: 'nope' });
  assert.deepEqual(clean, {});
});

test('every mail template renders subject, text and HTML', () => {
  const data = {
    username: 'maya',
    displayName: 'Maya R',
    phone: '+8801712345678',
    code: '123456',
    verifyUrl: 'https://chat.example.com/verify-email?token=abc',
    resetUrl: 'https://chat.example.com/reset-password?token=abc',
    title: 'Maintenance',
    body: 'Back at 21:00 UTC.',
    level: 'info',
    status: 'suspended',
    reason: 'Spam',
    role: 'staff',
    roleLabel: 'Staff',
    at: 'now',
    ip: '127.0.0.1',
    device: 'Firefox',
    supportEmail: 'help@example.com'
  };
  for (const name of Object.keys(templates)) {
    const rendered = renderTemplate(name, data);
    assert.ok(rendered.subject, `${name} subject`);
    assert.ok(rendered.text.includes('MinChat') || rendered.text.length > 20, `${name} text`);
    assert.ok(rendered.html.includes('<!doctype html>'), `${name} html`);
  }
});

test('verification and reset templates contain their one-time URL', () => {
  const verify = renderTemplate('verifyEmail', {
    username: 'maya',
    verifyUrl: 'https://chat.example.com/verify-email?token=secret'
  });
  assert.ok(verify.text.includes('https://chat.example.com/verify-email?token=secret'));

  const reset = renderTemplate('passwordReset', {
    username: 'maya',
    resetUrl: 'https://chat.example.com/reset-password?token=secret'
  });
  assert.ok(reset.html.includes('reset-password?token=secret'));
});

test('unknown templates fail loudly', () => {
  assert.throws(() => renderTemplate('does-not-exist', {}), /Unknown mail template/);
});
