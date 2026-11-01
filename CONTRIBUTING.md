# Contributing to MinChat

Thanks for taking the time to contribute. This project is self-hosted software with real security boundaries, so changes are reviewed with care.

## Before you start

- Search existing issues and pull requests first.
- For anything larger than a bug fix, open an issue describing the problem and your proposed approach.
- Never include secrets, personal data, production database dumps or screenshots of real conversations in an issue or pull request.

## Development setup

```bash
git clone https://github.com/johirxofficial/minchat.git
cd minchat
npm ci
cp .env.example .env
# configure DATABASE_URL, REDIS_URL and SESSION_SECRET
npm run migrate
npm run seed:admin
npm run dev
```

Requirements: Node.js 20.19+ (or 22.12+), PostgreSQL 14+ and Redis 6+.

## Making a change

1. Fork the repository and create a topic branch:

   ```bash
   git checkout -b fix/short-description
   ```

2. Keep commits focused. Write commit messages in the imperative mood, e.g. `Fix unread count after leaving a group`.

3. Follow the existing style:
   - ES modules, no CommonJS in application code.
   - Server code lives in `server/src`; routes stay thin and logic belongs in `lib/` or `services/`.
   - Validate every external input with Zod.
   - Enforce authorisation on the server, never only in the UI.
   - Use the existing design tokens and components before adding new CSS.

4. Add or update tests. Security-sensitive changes need a regression test.

5. Run the checks:

   ```bash
   npm test
   npm run build
   node scripts/verify-backend.mjs   # requires a running API
   npm audit --omit=dev
   ```

6. Open a pull request with:
   - what changed and why,
   - how you tested it,
   - any migration or configuration impact,
   - screenshots for UI changes (with fake data only).

## Database migrations

- Add a new file to `server/migrations/` using the next number, e.g. `004_feature_name.sql`.
- Migrations must be idempotent where practical and safe to run on an existing deployment.
- Never edit an already-released migration.
- Update the README if the change affects operations.

## Security expectations

- Do not weaken cookie, CSRF, rate-limit or authorisation checks.
- Do not log tokens, passwords, phone numbers or message bodies.
- Do not add fake success states. If an integration is not configured, report that honestly.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Code of conduct

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contributions are licensed under the MIT License.
