# MinChat

A self-hosted, privacy-aware chat and calling platform — Messenger-style conversations, friends-only messaging, voice/video calls with screen sharing, and a role-based operations console.

MinChat is a complete, runnable application: React + Vite on the front end, Node.js/Express + Socket.IO on the back end, PostgreSQL for durable data, Redis for presence, rate limits and the Socket.IO adapter, and protected local storage for media.

> **Open source, MIT licensed.** Fork it, self-host it, adapt it. No vendor lock-in and no third-party chat service.

---

## Highlights

### Messaging
- One-to-one and group conversations
- Friends-only messaging by default — strangers cannot DM or call you
- Real-time delivery over Socket.IO (Redis adapter for multi-process deployments)
- Typing indicators, presence, read receipts and unread counts
- Replies, message editing, soft deletion and emoji reactions
- Full-text message search scoped to conversations you belong to
- Attachments and image previews with MIME sniffing, size limits and per-user quotas
- Blocks that also end active calls and hide profiles
- Progressive Web App shell, installable on desktop and mobile, with a service worker that deliberately never caches API responses

### Calls
- WebRTC voice and video calls
- Screen sharing
- Ring timeout, call history and missed-call records
- Configurable STUN/TURN servers for networks behind strict NAT

### Accounts and security
- Password sign-in, optional sign-in with a verified phone number
- Password reset by email, email verification, and new-sign-in alerts
- Optional phone number with a genuinely verified code
  - **No SMS gateway is required.** The verification code is delivered to the account's email address; the code is HMAC-hashed at rest and expires after 10 minutes.
- Session management: view and revoke sessions, sign out everywhere
- HttpOnly, SameSite cookies with CSRF protection
- Server-side authorisation on every message, call, file and admin route
- Rate limiting backed by Redis
- Media stored outside the web root and streamed only through authorised routes
- Audit log for administrative actions

### Operations console
Role-based access with four levels:

| Role | Capabilities |
| --- | --- |
| **Member** (`user`) | Chat, call, media, own account settings |
| **Staff** (`staff`) | Read users, review reports, view notices and audit log |
| **Manager** (`manager`) | Staff + suspend/restore users, force logout, publish notices, view mail |
| **Administrator** (`admin`) | Everything: roles, mail, settings, reports, developer tools |

Staff and managers never lose member features: they are members with extra console access.

Console features:
- Overview dashboard with service health, storage and deployment facts
- User search, filters, detail view, role changes, suspend/restore, password reset, session revocation, deletion
- Report queue with review/resolve workflow
- Notices with drafts, scheduling, audience targeting, pinned/permanent banners, dismissals and optional email broadcast
- Transactional mail outbox with retries, cancellation, test sends and SMTP diagnostics
- Runtime settings (registration, email verification, public directory, maintenance mode, upload limits, support email)
- Audit log
- Developer tools: cache flush and data cleanup, both audited

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Client | React 18, Vite 8, React Router 7, Socket.IO client, lucide-react |
| API | Node.js 20+, Express 4 |
| Realtime | Socket.IO 4 + `@socket.io/redis-adapter` |
| Data | PostgreSQL 14+ |
| Cache / presence | Redis 6+ |
| Passwords | Argon2 (`@node-rs/argon2`) |
| Validation | Zod 4 |
| Mail | Nodemailer with a PostgreSQL outbox and retry worker |
| Web push | `web-push` + VAPID (optional) |
| Calls | WebRTC (browser-native) |
| Deployment | Docker Compose, Nginx, systemd |

---

## Architecture

```
Browser (React SPA + service worker)
   │  HTTPS / WSS
   ▼
Nginx  ──►  Node/Express API  ──►  PostgreSQL
                │  Socket.IO        (users, messages, outbox, audit)
                │
                ├──►  Redis  (sessions? no — rate limits, presence, socket adapter)
                └──►  storage/  (private media, outside the web root)
```

Sessions are opaque tokens stored in PostgreSQL and delivered in HttpOnly cookies. Redis is used for rate limiting, presence and the Socket.IO pub/sub adapter; it is not the source of truth for accounts or messages.

### Source layout

```
minchat/
├── client/                 React application (Vite)
│   ├── public/             PWA manifest, service worker, icons
│   └── src/
│       ├── components/     Layout, chat UI, call overlay, banners
│       ├── context/        Auth, chat, call, socket, toast providers
│       ├── lib/            API client and helpers
│       └── pages/          Auth, chat, friends, discover, calls, settings, admin
├── server/
│   ├── migrations/         SQL migrations (run in order)
│   ├── src/
│   │   ├── lib/            Mail, notices, permissions, phone, storage, settings…
│   │   ├── middleware/     Auth, CSRF, rate limits, security headers
│   │   ├── routes/         REST endpoints
│   │   ├── scripts/        Migrate, seed admin, cleanup
│   │   ├── services/       Conversation and message logic
│   │   └── sockets/        Realtime chat and call signalling
│   └── tests/              Node test runner + Supertest
├── deploy/                 Nginx, systemd, backup script
├── scripts/                Backend verification harness
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Quick start with Docker

The fastest path to a working instance.

```bash
git clone https://github.com/johirxofficial/minchat.git
cd minchat
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
SESSION_SECRET=<long random string>
POSTGRES_PASSWORD=<database password>
ADMIN_PASSWORD=<strong administrator password>
APP_ORIGIN=http://localhost:5050
```

Then:

```bash
docker compose up -d --build
docker compose exec app node server/src/scripts/seed-admin.js
```

Open <http://localhost:5050> and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

The container waits for PostgreSQL, applies migrations, serves the built client and the API on port 5050.

To stop:

```bash
docker compose down          # keep data
docker compose down -v      # delete database and media volumes
```

> Docker Compose is intended for evaluation and small deployments. For public production use, terminate TLS at a reverse proxy or load balancer.

---

## Manual installation

### 1. Prerequisites

- Node.js **20.19+** (or 22.12+)
- PostgreSQL 14+
- Redis 6+
- A reverse proxy for TLS (Nginx or Caddy)

### 2. Create the databases

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE minchat LOGIN PASSWORD 'change-me';
CREATE DATABASE minchat OWNER minchat;
CREATE DATABASE minchat_test OWNER minchat;
SQL
```

### 3. Install dependencies

```bash
git clone https://github.com/johirxofficial/minchat.git
cd minchat
npm ci
```

### 4. Configure

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# paste the output into SESSION_SECRET
```

Set `DATABASE_URL`, `REDIS_URL`, `APP_ORIGIN`, `ADMIN_*`, and `STORAGE_DIR`.
Create the storage directory and make it writable by the service user:

```bash
mkdir -p storage
chmod 750 storage
```

### 5. Migrate and seed

```bash
npm run migrate
npm run seed:admin
```

`seed:admin` creates the administrator if missing, or promotes an existing account. It never changes an existing password.

### 6. Build and run

```bash
npm run build
SERVE_STATIC=true npm start
```

The API listens on `HOST:PORT` (default `127.0.0.1:5050`) and serves the built client when `SERVE_STATIC=true`.

### 7. Put it behind TLS

Use [`deploy/nginx/minchat.conf`](deploy/nginx/minchat.conf) as a starting point.
When HTTPS is active, set:

```dotenv
APP_ORIGIN=https://chat.example.com
COOKIE_SECURE=true
```

and restart the service.

---

## Development

Run the API and Vite dev server together:

```bash
npm install
cp .env.example .env    # set DATABASE_URL, REDIS_URL, SESSION_SECRET
npm run migrate
npm run seed:admin
npm run seed:demo     # optional: alice + bob for the verification harness
npm run dev
```

- Client: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:5050>
- Vite proxies `/api` and `/socket.io` to the API.

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + client with reload |
| `npm run build` | Production client build |
| `npm start` | Start the API |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run seed:admin` | Create or promote the first administrator |
| `npm run seed:demo` | Create the `alice` and `bob` demo members |
| `npm run cleanup` | Remove expired sessions and orphaned data |
| `npm test` | Unit and API tests (needs PostgreSQL + Redis) |
| `node scripts/verify-backend.mjs` | End-to-end backend verification (47 checks) |

### Tests

The suite uses the Node test runner and Supertest:

```bash
npm test
```

`scripts/verify-backend.mjs` exercises authentication, friends, messaging, blocking, admin roles, notices, mail, phone verification, password reset, maintenance mode and developer tools against a running API. It expects two member accounts (`alice` and `bob`, password `correct horse battery`) plus a seeded administrator, and restores the roles and statuses it changes.

---

## Environment reference

All variables are documented in [`.env.example`](.env.example). The most important ones:

| Variable | Required | Description |
| --- | --- | --- |
| `SESSION_SECRET` | yes | 32+ random characters used to sign sessions |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | yes | Redis connection string |
| `APP_ORIGIN` | yes | Public origin, e.g. `https://chat.example.com` |
| `HOST` / `PORT` | no | Bind address, default `127.0.0.1:5050` |
| `COOKIE_SECURE` | no | `true` when served over HTTPS |
| `COOKIE_SAMESITE` | no | `lax` (default), `strict` or `none` |
| `STORAGE_DIR` | no | Private media directory, default `./storage` |
| `MAX_UPLOAD_MB` | no | Per-file limit, default 25 |
| `USER_STORAGE_QUOTA_MB` | no | Per-user quota, default 500 |
| `SERVE_STATIC` | no | Serve `client/dist` from the API |
| `SMTP_*` | no | Real email delivery. Empty = development outbox |
| `ALLOW_DEV_EMAIL` | no | Mark dev emails as sent with a development flag |
| `STUN_URLS` / `TURN_*` | no | WebRTC ICE configuration |
| `VAPID_*` | no | Web push keys |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed only | First administrator |
| `REGISTRATION_OPEN` | no | Initial registration state |

Runtime settings in the admin console override several environment values: registration, email verification, public directory, maintenance mode, support email and upload limit.

---

## Email

MinChat always writes transactional mail to the `mail_outbox` table first. A background worker retries failed deliveries (up to five attempts, every 20 seconds).

- **SMTP configured:** real mail is delivered.
- **SMTP not configured:** messages stay in the outbox and are logged. With `ALLOW_DEV_EMAIL=true` they are marked `sent` with a development flag so registration, password reset and phone verification can be tested locally.

Templates include welcome, email verification, password reset, password changed, new sign-in, phone code, phone added/removed, account status, notice broadcast and test mail.

To enable real delivery, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM`.

---

## Phone verification without SMS

A phone number is optional. When a member adds one:

1. The number is normalised to E.164.
2. A six-digit code is generated and delivered **to the account email address**.
3. Only an HMAC digest of the code is stored, bound to the user and phone number.
4. The code expires after 10 minutes.
5. On success the number is marked verified and can be used as a sign-in identifier.

This keeps the feature honest and usable without buying an SMS provider. If you add an SMS gateway later, replace the delivery call in `server/src/lib/phone.js`.

---

## Roles and permissions

Capabilities are defined in `server/src/lib/permissions.js` and enforced on the server:

```
user    → (member features only)
staff   → console.access, users.view, reports.view, reports.review,
          notices.view, audit.view
manager → staff + users.moderate, notices.manage, mail.view
admin   → every capability, including users.manage/delete, mail.manage,
          settings.manage, developer.access
```

Rules enforced by the API:

- Only administrators can assign roles.
- Nobody can act on an account with an equal or higher role.
- Staff and managers keep all chat and call features.
- Suspending or deleting an account revokes its sessions immediately.
- Every privileged mutation is recorded in the audit log.

---

## Deployment

### Nginx

Copy [`deploy/nginx/minchat.conf`](deploy/nginx/minchat.conf), adjust `server_name`, certificate paths and upstream port, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The sample proxies both HTTP and WebSocket traffic and sets forwarded headers. If another site already owns port 80 on your server, change `listen` or use a distinct `server_name`.

### systemd

[`deploy/systemd/minchat.service`](deploy/systemd/minchat.service) runs the API as a dedicated user:

```bash
sudo useradd --system --home /srv/minchat --shell /usr/sbin/nologin minchat
sudo mkdir -p /srv/minchat /etc/minchat
# copy the project to /srv/minchat, config to /etc/minchat/minchat.env
sudo systemctl daemon-reload
sudo systemctl enable --now minchat
```

### Backups

[`deploy/scripts/backup.sh`](deploy/scripts/backup.sh) dumps PostgreSQL and archives private media:

```bash
sudo BACKUP_DIR=/var/backups/minchat deploy/scripts/backup.sh
```

Schedule it with cron or a systemd timer, and test restores regularly. Media and database backups must be stored together; a database without its media is incomplete.

### Health check

```
GET /api/health
```

Returns `200` when PostgreSQL and Redis are reachable, plus maintenance and registration state. Returns `503` when degraded.

---

## Security model

- All authorisation is enforced server-side; the client only hides controls.
- Conversations require an accepted friendship unless they are group conversations created by a member.
- Blocking is bidirectional for visibility and prevents new messages, friend requests and calls.
- Media lives outside the web root. Access requires an authenticated session and membership in the conversation.
- Uploads are sniffed by content, not trusted by extension, and constrained by per-file and per-user quotas.
- Session tokens are opaque, stored hashed, and delivered in HttpOnly cookies.
- State-changing requests require a CSRF token.
- Security headers are applied to API responses and the static shell.
- Rate limits cover authentication, search, uploads and general API traffic.
- Secrets are read from the environment and never logged.
- The service worker never caches API responses, so private conversations are not written to a shared cache.

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

---

## Known limitations

MinChat is honest about what it does not ship out of the box:

- **No SMS provider.** Phone codes are delivered by email.
- **No real mail until SMTP is configured.** Development mode records messages in the outbox.
- **No TURN server included.** Calls work on many networks with STUN; strict NAT or corporate networks need TURN.
- **No built-in object storage.** Media is stored on the local filesystem. Use a shared volume or adapt `server/src/lib/storage.js` for S3-compatible storage.
- **No end-to-end encryption.** Transport is protected by TLS, and media is access-controlled, but the server can read message content. Do not describe this deployment as E2EE.
- **No federation.** Each deployment is independent.
- **Single-region by default.** Redis enables multiple API processes, but the database and media must be shared.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Good first issues:
- Add an S3-compatible storage adapter.
- Add message forwarding or scheduled messages.
- Add an SMS provider adapter.
- Improve accessibility and keyboard navigation.
- Add more end-to-end tests.

---

## License

MIT — see [LICENSE](LICENSE).

MinChat is an independent project by [johirxofficial](https://github.com/johirxofficial). It is not affiliated with Meta or Messenger.
