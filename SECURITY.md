# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include:
   - affected version or commit,
   - a description of the issue and its impact,
   - reproduction steps or a proof of concept,
   - any suggested fix.

If private reporting is unavailable, contact the maintainer through the address on their GitHub profile and mention "MinChat security" in the subject.

You can expect an acknowledgement within a few days. Please allow time for a fix and coordinated disclosure before publishing details.

## Supported versions

Security fixes are applied to the current `main` branch. There is no long-term support branch at this time.

## Scope

In scope:

- authentication, session and CSRF flaws
- authorisation bypasses (reading conversations, files or admin data)
- injection, SSRF, path traversal or unsafe file handling
- rate-limit bypasses with meaningful impact
- leaking secrets, tokens or private media
- cross-site scripting in the client

Out of scope:

- denial of service from a single unauthenticated request without a practical mitigation
- missing features listed in the README's known limitations
- findings that require a compromised device, browser extension or email account
- social engineering
- reports produced only by an automated scanner without a demonstrated impact

## Deployment hardening

Operators should:

- serve MinChat over HTTPS and set `COOKIE_SECURE=true`
- use a long, random `SESSION_SECRET`
- keep PostgreSQL and Redis on private interfaces
- run the service as an unprivileged user
- place `storage/` outside the web root
- configure SMTP with a dedicated account and TLS
- rotate credentials after any suspected exposure
- keep dependencies updated (`npm audit --omit=dev`)

## Known limitations

MinChat does not provide end-to-end encryption. The server can read message content. Do not describe a deployment as E2EE unless you add client-side encryption yourself.
