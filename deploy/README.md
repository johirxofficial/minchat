# Deployment notes

These files are starting points, not a fully automated installer. Review every path, user and port before applying them to a real server.

## Components

| File | Purpose |
| --- | --- |
| `nginx/minchat.conf` | TLS termination, reverse proxy and WebSocket upgrade |
| `systemd/minchat.service` | Runs the API as an unprivileged service |
| `scripts/backup.sh` | PostgreSQL dump plus private media archive |

## Suggested layout

```
/srv/minchat            application code and client/dist
/srv/minchat/storage    private media (writable by the service user)
/etc/minchat/minchat.env  environment file (mode 0600)
/var/backups/minchat    backups
```

## Steps

1. Create the service user and directories:

   ```bash
   sudo useradd --system --home /srv/minchat --shell /usr/sbin/nologin minchat
   sudo mkdir -p /srv/minchat/storage /etc/minchat /var/backups/minchat
   sudo chown -R minchat:minchat /srv/minchat /var/backups/minchat
   sudo chmod 750 /srv/minchat/storage /var/backups/minchat
   ```

2. Copy the project to `/srv/minchat`, install production dependencies and build:

   ```bash
   cd /srv/minchat
   npm ci
   npm run build
   ```

3. Create `/etc/minchat/minchat.env` from `.env.example`, then lock it down:

   ```bash
   sudo chmod 600 /etc/minchat/minchat.env
   sudo chown root:minchat /etc/minchat/minchat.env
   ```

   At minimum set `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `APP_ORIGIN`, `SERVE_STATIC=true`, `HOST=127.0.0.1`, `COOKIE_SECURE=true` and a strong `ADMIN_PASSWORD`.

4. Apply migrations and seed the administrator:

   ```bash
   sudo -u minchat env $(grep -v '^#' /etc/minchat/minchat.env | xargs) \
     npm run migrate
   sudo -u minchat env $(grep -v '^#' /etc/minchat/minchat.env | xargs) \
     npm run seed:admin
   ```

5. Install the systemd unit and start the service:

   ```bash
   sudo cp deploy/systemd/minchat.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now minchat
   sudo journalctl -u minchat -f
   ```

6. Configure Nginx and TLS, then verify:

   ```bash
   sudo cp deploy/nginx/minchat.conf /etc/nginx/sites-available/minchat.conf
   sudo ln -s /etc/nginx/sites-available/minchat.conf /etc/nginx/sites-enabled/minchat.conf
   sudo nginx -t && sudo systemctl reload nginx
   curl -fsS https://chat.example.com/api/health
   ```

7. Schedule backups:

   ```bash
   # /etc/cron.d/minchat-backup
   15 2 * * * root ENV_FILE=/etc/minchat/minchat.env BACKUP_DIR=/var/backups/minchat /srv/minchat/deploy/scripts/backup.sh >> /var/log/minchat-backup.log 2>&1
   ```

## Restore

```bash
# Database
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname "$DATABASE_URL" /var/backups/minchat/minchat-db-YYYYMMDDTHHMMSSZ.dump

# Media
tar -xzf /var/backups/minchat/minchat-media-YYYYMMDDTHHMMSSZ.tar.gz -C /srv/minchat
```

Stop the service before restoring, then start it again and check `/api/health`.

## Notes

- Port 80 is often already in use. Change `listen` in the Nginx sample or use a dedicated `server_name` so you do not disturb an existing site.
- WebSocket support requires the `Upgrade` and `Connection` headers in the `/socket.io/` block.
- Keep `storage/` outside the web root. The sample explicitly blocks `/storage/`.
- Media and database backups must be kept together.
