# SigNoz Enterprise — Production Setup

> **This is the only doc you need.** Follow every step in order. Each step has an exact command to run — nothing is left vague.

---

## What You Need Before Starting

| Requirement | Check |
|-------------|-------|
| A Linux server (Ubuntu 22.04 recommended) | |
| A domain name pointing to the server's IP | e.g. `signoz.yourcompany.com → 1.2.3.4` |
| Ports 80, 443, 4317, 4318 open in firewall | |
| Minimum 4 GB RAM, 2 CPU, 40 GB disk | |
| SSH access to the server | |

---

## Part 1 — First-Time Server Setup

> **Run these on your production server** (SSH in first: `ssh user@your-server-ip`)

### 1.1 Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker                   # apply group change without logout
docker --version                # should print Docker version
```

### 1.2 Install Docker Compose plugin

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version          # should print v2.x.x
```

### 1.3 Install Certbot (free TLS certs)

```bash
sudo apt-get install -y certbot
certbot --version               # should print certbot version
```

### 1.4 Create the app directory

```bash
sudo mkdir -p /opt/signoz
sudo chown $USER:$USER /opt/signoz
```

---

## Part 2 — Copy Deploy Files to Server

> **Run this on your local machine** (in the root of this repo)

```bash
scp -r deploy/* user@your-server-ip:/opt/signoz/
```

> Verify it landed on the server:
> ```bash
> ls /opt/signoz      # should show: docker-compose.yml  .env.example  config/  README.md
> ```

---

## Part 3 — Configure the Application

> **Run these on your production server**

### 3.1 Create your `.env` file

```bash
cd /opt/signoz
cp .env.example .env
```

### 3.2 Generate a JWT secret

```bash
openssl rand -hex 32
# Copy the output — you'll paste it in the next step
```

### 3.3 Edit `.env` with your values

```bash
nano .env
```

Change these two lines:

```env
# Set to your latest released tag from GitHub Actions
SIGNOZ_IMAGE=ghcr.io/unifers/signoz:vPB-1.0.0

# Paste the secret you generated in step 3.2
JWT_SECRET=your_generated_secret_here
```

Save and exit: `Ctrl+X` → `Y` → `Enter`

---

## Part 4 — Get a TLS Certificate

> **Run on your production server**
> ⚠️ Your domain DNS must already point to this server's IP. Port 80 must be open.

```bash
# Replace with your actual domain
export DOMAIN=signoz.yourcompany.com

sudo certbot certonly --standalone -d $DOMAIN
```

Expected output ends with:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/signoz.yourcompany.com/fullchain.pem
```

---

## Part 5 — Set Your Domain in Nginx

> **Run on your production server**

```bash
cd /opt/signoz

# Replace YOUR_DOMAIN in the nginx config (run with your real domain)
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" config/nginx.conf

# Verify it was replaced correctly
grep "server_name" config/nginx.conf
# Should print: server_name signoz.yourcompany.com;
```

---

## Part 6 — Make the Docker Image Public (One-Time)

> ⚠️ Do this **after** your first CI build completes on GitHub Actions.

1. Go to: `https://github.com/Unifers/signoz/pkgs/container/signoz`
2. Click **"Package settings"** (bottom right of the page)
3. Scroll down to **"Danger Zone"**
4. Click **"Change visibility"** → select **"Public"** → confirm

After this, the server can pull images without login. You only do this once.

---

## Part 7 — Start Everything

> **Run on your production server**

```bash
cd /opt/signoz

docker compose up -d
```

Watch the startup (takes 2-3 minutes):

```bash
docker compose logs -f
```

Wait until you see logs from `signoz` container starting up, then check all services are healthy:

```bash
docker compose ps
```

All services should show `running` or `healthy`. Expected output:

```
NAME                     STATUS          PORTS
signoz-zookeeper         running (healthy)
signoz-clickhouse        running (healthy)
signoz-clickhouse-migr.. exited (0)       ← normal, runs once then exits
signoz-otel-collector    running (healthy) 0.0.0.0:4317->4317, 0.0.0.0:4318->4318
signoz                   running (healthy)
signoz-nginx             running          0.0.0.0:80->80, 0.0.0.0:443->443
```

---

## Part 8 — Verify It's Live

Open in your browser:

```
https://signoz.yourcompany.com
```

You should see the SigNoz login page.

**First login:**
1. Click **"Create an account"**
2. Fill in your name, email, password
3. You're in ✅

---

## Part 9 — Set Up Automatic TLS Renewal

TLS certificates expire every 90 days. Set up auto-renewal:

```bash
# Test renewal works (dry run — no actual renewal)
sudo certbot renew --dry-run
# Should print: Simulating renewal of an existing certificate

# Add cron to auto-renew and reload nginx
sudo crontab -e
```

Add this line at the bottom:

```
0 3 * * * certbot renew --quiet && cd /opt/signoz && docker compose exec nginx nginx -s reload
```

Save and exit.

---

## Part 10 — Set Up Daily Backups

```bash
mkdir -p /opt/signoz/backups

crontab -e
```

Add this line:

```
0 2 * * * cd /opt/signoz && docker run --rm -v signoz_signoz_data:/data -v /opt/signoz/backups:/backup alpine tar czf /backup/signoz-db-$(date +\%Y\%m\%d).tar.gz /data 2>/dev/null
```

Save and exit.

Test it manually now:

```bash
cd /opt/signoz
docker run --rm \
  -v signoz_signoz_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/signoz-db-manual-test.tar.gz /data

ls -lh backups/     # should show the backup file
```

---

## Deploying a New Version

### On your local/dev machine:

```bash
# Tag the new version and push — GitHub Actions builds it automatically
git tag vPB-2.0.0
git push origin vPB-2.0.0

# Wait ~10-15 min for the build to finish
# Check progress at: https://github.com/Unifers/signoz/actions
```

### On your production server (after the build finishes):

```bash
cd /opt/signoz

# 1. Update the image tag in .env
sed -i 's|SIGNOZ_IMAGE=.*|SIGNOZ_IMAGE=ghcr.io/unifers/signoz:vPB-2.0.0|' .env

# 2. Pull the new image
docker compose pull signoz

# 3. Restart only SigNoz (ClickHouse keeps running — no data loss)
docker compose up -d --no-deps signoz

# 4. Verify it's running the new version
docker compose ps
docker compose logs signoz --tail=20
```

---

## Sending Telemetry From Your Apps

Configure your applications to send telemetry to the OTel Collector:

```bash
# gRPC (recommended, more efficient)
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-server-ip:4317

# HTTP (use if gRPC is blocked)
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-server-ip:4318
```

**Node.js example:**

```js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://your-server-ip:4317',
  }),
});
sdk.start();
```

---

## Quick Reference Commands

```bash
# Check all service status
docker compose ps

# View live logs (all services)
docker compose logs -f

# View logs for one service
docker compose logs -f signoz
docker compose logs -f clickhouse
docker compose logs -f otel-collector
docker compose logs -f nginx

# Restart one service
docker compose restart signoz

# Stop everything (data is preserved)
docker compose down

# ⚠️  DANGER: Stop and delete ALL data permanently
docker compose down -v

# Check CPU / memory usage
docker stats

# Manual backup now
docker run --rm \
  -v signoz_signoz_data:/data \
  -v /opt/signoz/backups:/backup \
  alpine tar czf /backup/signoz-db-manual.tar.gz /data
```

---

## Troubleshooting

**ClickHouse won't start:**
```bash
docker compose logs clickhouse | tail -30
# Usually a timing issue with zookeeper — wait 30s then:
docker compose restart clickhouse
```

**`clickhouse-migrator` shows errors:**
```bash
docker compose logs clickhouse-migrator
# If it fails, restart it:
docker compose up -d clickhouse-migrator
```

**SigNoz shows blank page or 502:**
```bash
docker compose logs signoz | tail -30
# Wait 60s for startup, then refresh
```

**Nginx 502 Bad Gateway:**
```bash
# SigNoz not ready yet — check its health
docker compose ps signoz
# If unhealthy, check logs:
docker compose logs signoz
```

**TLS certificate expired or error:**
```bash
sudo certbot certificates                  # check expiry dates
sudo certbot renew --dry-run               # test renewal
sudo certbot renew --force-renewal -d your-domain.com   # force renew now
cd /opt/signoz && docker compose exec nginx nginx -s reload
```

**Out of disk space:**
```bash
df -h                          # check disk usage
docker system prune -f         # remove unused Docker images/containers
# If ClickHouse is using too much, set data retention in SigNoz settings
```
