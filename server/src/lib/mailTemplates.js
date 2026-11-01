/**
 * Transactional email templates. Plain text is always sent alongside HTML so
 * the messages remain usable in text-only clients and accessible readers.
 */

const BRAND = 'MinChat';
const ACCENT = '#6f4cf5';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);

function layout({ title, preheader, body, footerNote }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#211c33;">
    <span style="display:none;font-size:1px;color:#f5f3ee;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader || '')}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;border:1px solid #e6e1d8;overflow:hidden;">
            <tr>
              <td style="padding:22px 28px;background:linear-gradient(135deg,${ACCENT},#36bfae);color:#fff;">
                <strong style="font-size:18px;letter-spacing:-0.02em;">${BRAND}</strong>
                <span style="float:right;font-size:11px;opacity:0.85;letter-spacing:0.08em;text-transform:uppercase;">by johirxofficial</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #eee9e0;font-size:12px;color:#7a7387;line-height:1.6;">
                ${footerNote ? `<p style="margin:0 0 8px;">${escapeHtml(footerNote)}</p>` : ''}
                <p style="margin:0;">You are receiving this because you have a MinChat account. Replies to this address are not monitored.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const paragraph = (text) =>
  `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#4a4363;">${text}</p>`;

const button = (href, label) =>
  `<p style="margin:22px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:999px;">${escapeHtml(label)}</a></p>`;

const codeBox = (code) =>
  `<p style="margin:18px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;letter-spacing:0.28em;font-weight:700;background:#f5f3ee;border:1px solid #e6e1d8;border-radius:12px;padding:14px 16px;text-align:center;color:#211c33;">${escapeHtml(code)}</p>`;

const quote = (text) =>
  `<blockquote style="margin:0 0 14px;padding:12px 14px;border-left:3px solid ${ACCENT};background:#f8f6ff;border-radius:0 10px 10px 0;font-size:14px;line-height:1.6;color:#4a4363;">${escapeHtml(text)}</blockquote>`;

function build(title, preheader, bodyHtml, bodyText, footerNote) {
  return {
    subject: title,
    html: layout({ title, preheader, body: bodyHtml, footerNote }),
    text: bodyText
  };
}

export const templates = {
  welcome: ({ username, displayName, verifyUrl, supportEmail }) =>
    build(
      'Welcome to MinChat',
      'Your account is ready.',
      `${paragraph(`Hi ${escapeHtml(displayName || username)},`)}
       ${paragraph('Your MinChat account is ready. Only friends can message or call you, and your media stays behind authenticated access.')}
       ${verifyUrl ? `${paragraph('Confirm your email address so you can recover your account later:')}${button(verifyUrl, 'Verify email address')}` : ''}
       ${paragraph(`Need a hand? Write to ${escapeHtml(supportEmail || 'support@minchat.local')}.`)}`,
      `Hi ${displayName || username},\n\nYour MinChat account is ready. Only friends can message or call you.\n\n${
        verifyUrl ? `Verify your email address: ${verifyUrl}\n\n` : ''
      }Need a hand? Write to ${supportEmail || 'support@minchat.local'}.\n`,
      'You created this account recently.'
    ),

  verifyEmail: ({ username, verifyUrl }) =>
    build(
      'Confirm your email address',
      'One click keeps your account recoverable.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph('Confirm this email address to finish setting up your MinChat account. The link expires in 24 hours.')}
       ${button(verifyUrl, 'Verify email address')}
       ${paragraph('If you did not create an account, you can ignore this message.')}`,
      `Hi ${username},\n\nConfirm your email address to finish setting up your MinChat account. This link expires in 24 hours:\n\n${verifyUrl}\n\nIf you did not create an account, you can ignore this message.\n`,
      'This link can only be used once.'
    ),

  passwordReset: ({ username, resetUrl }) =>
    build(
      'Reset your MinChat password',
      'This link expires in 30 minutes.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph('Someone requested a password reset for your MinChat account. This link expires in 30 minutes and can only be used once.')}
       ${button(resetUrl, 'Choose a new password')}
       ${paragraph('If you did not request this, you can ignore this email. Your password will not change.')}`,
      `Hi ${username},\n\nSomeone requested a password reset for your MinChat account. Use this link within 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.\n`,
      'For your security, every other session is signed out once the password changes.'
    ),

  passwordChanged: ({ username, at, ip }) =>
    build(
      'Your password was changed',
      'Security notification for your MinChat account.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(`The password on your MinChat account was changed on ${escapeHtml(at)}${ip ? ` from ${escapeHtml(ip)}` : ''}.`)}
       ${paragraph('All other sessions were signed out. If this was not you, reset your password immediately and contact an administrator.')}`,
      `Hi ${username},\n\nThe password on your MinChat account was changed on ${at}${ip ? ` from ${ip}` : ''}. All other sessions were signed out.\n\nIf this was not you, reset your password immediately.\n`,
      'You are receiving this because password changes always notify the account owner.'
    ),

  phoneCode: ({ username, phone, code, expiresMinutes = 10 }) =>
    build(
      'Confirm your phone number',
      'Your MinChat verification code.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(`Use this code to confirm ${escapeHtml(phone)} on your MinChat account. It expires in ${Number(expiresMinutes)} minutes.`)}
       ${codeBox(code)}
       ${paragraph('If you did not ask for this, ignore the message and consider changing your password.')}`,
      `Hi ${username},\n\nUse this code to confirm ${phone} on your MinChat account. It expires in ${expiresMinutes} minutes.\n\n${code}\n\nIf you did not ask for this, ignore the message.\n`,
      'For your security, never share this code with anyone.'
    ),

  phoneVerified: ({ username, phone }) =>
    build(
      'Phone number added',
      'A security phone number was confirmed.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(`The phone number ${escapeHtml(phone)} is now linked to your MinChat account and can be used to sign in.`)}
       ${paragraph('If you did not make this change, remove the number in Settings → Security and change your password.')}`,
      `Hi ${username},\n\n${phone} is now linked to your MinChat account and can be used to sign in.\n\nIf you did not make this change, remove the number and change your password.\n`,
      'Security notifications cannot be turned off.'
    ),

  phoneRemoved: ({ username, phone }) =>
    build(
      'Phone number removed',
      'A security phone number was removed.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(`The phone number ${escapeHtml(phone)} was removed from your MinChat account. It can no longer be used to sign in.`)}
       ${paragraph('If you did not make this change, change your password and contact an administrator.')}`,
      `Hi ${username},\n\n${phone} was removed from your MinChat account.\n\nIf you did not make this change, change your password and contact an administrator.\n`,
      'Security notifications cannot be turned off.'
    ),

  accountStatus: ({ username, status, reason, supportEmail }) =>
    build(
      status === 'suspended' ? 'Your account has been suspended' : 'Your account has been restored',
      status === 'suspended'
        ? 'Access to your MinChat account is paused.'
        : 'Welcome back to MinChat.',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(
         status === 'suspended'
           ? 'An administrator has suspended your MinChat account. You have been signed out and cannot sign in until the account is restored.'
           : 'Your MinChat account has been restored. You can sign in again with your usual credentials.'
       )}
       ${reason ? quote(reason) : ''}
       ${paragraph(`Questions? Contact ${escapeHtml(supportEmail || 'support@minchat.local')}.`)}`,
      `Hi ${username},\n\n${
        status === 'suspended'
          ? 'An administrator has suspended your MinChat account.'
          : 'Your MinChat account has been restored.'
      }${reason ? `\n\nReason: ${reason}` : ''}\n\nContact ${supportEmail || 'support@minchat.local'} with questions.\n`,
      'This message was sent by the MinChat administration team.'
    ),

  roleChanged: ({ username, role, roleLabel }) =>
    build(
      'Your MinChat access level changed',
      `You are now ${roleLabel}.`,
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(`An administrator changed your MinChat role to ${escapeHtml(roleLabel)} (${escapeHtml(role)}).`)}
       ${paragraph('You can keep chatting and calling as usual. If you have console access, it is available from the navigation rail.')}`,
      `Hi ${username},\n\nYour MinChat role is now ${roleLabel} (${role}).\n\nChat and calls are unchanged.\n`,
      'Contact an administrator if you believe this is a mistake.'
    ),

  notice: ({ username, title, body, level, url }) =>
    build(
      `Announcement: ${title}`,
      body.slice(0, 120),
      `${paragraph(`Hi ${escapeHtml(username || 'there')},`)}
       ${paragraph(`<strong>${escapeHtml(title)}</strong>`)}
       ${quote(body)}
       ${url ? button(url, 'Open MinChat') : ''}`,
      `Hi ${username || 'there'},\n\n${title}\n\n${body}${url ? `\n\n${url}` : ''}\n`,
      'You received this announcement because it was sent to your role.'
    ),

  loginAlert: ({ username, at, ip, device }) =>
    build(
      'New sign-in to MinChat',
      'Was this you?',
      `${paragraph(`Hi ${escapeHtml(username)},`)}
       ${paragraph(`Your MinChat account was just signed in to on ${escapeHtml(at)}.`)}
       ${paragraph(`<strong>IP address:</strong> ${escapeHtml(ip || 'unknown')}<br /><strong>Device:</strong> ${escapeHtml(device || 'unknown')}`)}
       ${paragraph('If this was not you, change your password immediately and review your active sessions in Settings → Security.')}`,
      `Hi ${username},\n\nYour MinChat account was signed in to on ${at}.\nIP: ${ip || 'unknown'}\nDevice: ${device || 'unknown'}\n\nIf this was not you, change your password and review your sessions.\n`,
      'We send this alert when a sign-in comes from a new address.'
    ),

  test: ({ username, supportEmail }) =>
    build(
      'MinChat mail delivery test',
      'Your SMTP settings are working.',
      `${paragraph(`Hi ${escapeHtml(username || 'administrator')},`)}
       ${paragraph('This is a test message from the MinChat mail system. If you can read it, outbound email is configured correctly.')}
       ${paragraph(`Support address: ${escapeHtml(supportEmail || 'support@minchat.local')}`)}`,
      `Hi ${username || 'administrator'},\n\nThis is a test message from the MinChat mail system. Outbound email is working.\n`,
      'Sent from the administration console.'
    )
};

export function renderTemplate(template, data = {}) {
  const fn = templates[template];
  if (!fn) throw new Error(`Unknown mail template: ${template}`);
  return fn(data);
}
