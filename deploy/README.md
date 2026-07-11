# SigNoz Enterprise — Production Deployment Guide

Complete step-by-step guide to deploy SigNoz on your production server using Docker Compose.

---

## Architecture

```
Internet
   │
   ▼
[Nginx :443]  ←── TLS termination (Let's Encrypt)
   │
   ▼
[SigNoz :8080]  ←── Go backend + React frontend (single container)
   │
   ├──► [ClickHouse :9000]  ←── telemetry storage (traces, metrics, logs)
   │         │
   │    [Zookeeper :2181]   ←── ClickHouse cluster coordination
   │
   └──► [OTel Collector :4317/:4318]  ←── receives telemetry from your apps
```

---

## Prerequisites

On your production server, install:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # logout and back in after this

# Docker Compose (v2 plugin)
sudo apt-get install docker-compose-plugin   # Ubuntu/Debian

# Certbot (for free TLS certs)
sudo apt-get install certbot   # Ubuntu/Debian
```

Minimum server specs:
- **CPU**: 2 cores
- **RAM**: 4 GB (8 GB recommended)
- **Disk**: 40 GB SSD
- **Ports open in firewall**: 80, 443, 4317, 4318

---

## Step 1 — Copy deploy files to server

From your **local machine**:

```bash
scp -r deploy/ user@your-server-ip:/opt/signoz
```

---

## Step 2 — Configure environment variables

```bash
cd /opt/signoz

cp .env.example .env
nano .env
```

**Required changes:**

```env
# Which image tag to run
SIGNOZ_IMAGE=ghcr.io/unifers/signoz:vPB-1.0.0

# Generate with: openssl rand -hex 32
JWT_SECRET=paste_your_secret_here
```

---

## Step 3 — Get a TLS certificate

```bash
export DOMAIN=signoz.yourcompany.com

# Port 80 must be open and pointing to this server
sudo certbot certonly --standalone -d $DOMAIN
```

---

## Step 4 — Configure Nginx

```bash
# Replace YOUR_DOMAIN in all 3 places in the config
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" /opt/signoz/config/nginx.conf
```

---

## Step 5 — Start all services

```bash
cd /opt/signoz

docker compose up -d

# Check status (wait ~2-3 minutes for all to be healthy)
docker compose ps
```

Services start in order automatically:
1. `zookeeper` → 2. `clickhouse` → 3. `clickhouse-migrator` → 4. `otel-collector` + `signoz` → 5. `nginx`

---

## Step 6 — Open in browser

```
https://signoz.yourcompany.com
```

Create your admin account on first login.

---

## Step 7 — Make Docker image public (one-time)

Go to: `https://github.com/Unifers/signoz/pkgs/container/signoz`

**Package settings → Danger Zone → Change visibility → Public**

---

## Updating to a New Version

On your **dev machine**, create and push a new tag:

```bash
git tag vPB-2.0.0
git push origin vPB-2.0.0
# GitHub Actions builds the image automatically (~10-15 min)
```

On your **production server**:

```bash
cd /opt/signoz

# Update the image tag
sed -i 's|SIGNOZ_IMAGE=.*|SIGNOZ_IMAGE=ghcr.io/unifers/signoz:vPB-2.0.0|' .env

# Pull new image and restart only signoz
docker compose pull signoz
docker compose up -d --no-deps signoz

# Verify
docker compose logs signoz --tail=50
```

---

## Sending Telemetry from Your Apps

Point your apps to the OTel Collector:

```bash
# gRPC
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-server-ip:4317

# HTTP
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-server-ip:4318
```

---

## Backup

```bash
cd /opt/signoz

# Backup SQLite (user accounts, dashboards, alerts)
docker run --rm \
  -v signoz_signoz_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/signoz-db-$(date +%Y%m%d).tar.gz /data

# Backup ClickHouse (all telemetry data)
docker run --rm \
  -v signoz_clickhouse_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/clickhouse-$(date +%Y%m%d).tar.gz /data
```

Add to crontab for daily backups:

```bash
crontab -e
# Add:
0 2 * * * cd /opt/signoz && docker run --rm -v signoz_signoz_data:/data -v $(pwd)/backups:/backup alpine tar czf /backup/signoz-db-$(date +\%Y\%m\%d).tar.gz /data
```

---

## TLS Certificate Auto-Renewal

```bash
sudo crontab -e
# Add:
0 3 * * * certbot renew --quiet && cd /opt/signoz && docker compose exec nginx nginx -s reload
```

---

## Useful Commands

```bash
docker compose ps                        # status of all services
docker compose logs -f                   # all logs
docker compose logs -f signoz            # SigNoz logs only
docker compose logs -f clickhouse        # ClickHouse logs
docker compose restart signoz            # restart SigNoz only
docker compose down                      # stop everything (data preserved)
docker compose down -v                   # DANGER: stop + delete all data
docker stats                             # resource usage
```

---

## File Structure

```
deploy/
├── docker-compose.yml              ← all services defined here
├── .env.example                    ← copy this to .env
├── .env                            ← your actual config (never commit this)
└── config/
    ├── clickhouse/
    │   ├── config.xml              ← ClickHouse server settings
    │   ├── users.xml               ← ClickHouse permissions
    │   └── custom-function.xml     ← ClickHouse custom functions
    ├── otel-collector-config.yaml  ← traces/metrics/logs pipelines
    └── nginx.conf                  ← HTTPS reverse proxy
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| ClickHouse won't start | `docker compose logs clickhouse` — usually zookeeper timing. `docker compose restart clickhouse` |
| SigNoz shows blank page | `docker compose logs signoz` — wait for ClickHouse migrations to finish |
| Nginx 502 Bad Gateway | SigNoz still starting. Wait 60s, then `docker compose logs signoz` |
| TLS cert issues | `sudo certbot certificates` then `sudo certbot renew --dry-run` |
| Out of disk space | ClickHouse data growing — add more disk or set retention policies |
