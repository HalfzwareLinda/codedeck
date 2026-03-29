#!/usr/bin/env bash
# bootstrap-relay.sh — Sets up a Codedeck private Nostr relay + Blossom media server
#
# Run as root on a fresh Ubuntu 24.04 VPS:
#   scp bootstrap-relay.sh root@<VPS_IP>:
#   ssh root@<VPS_IP> bash bootstrap-relay.sh
#
# After running, you need to:
#   1. Point DNS: relay.codedeck.app + blossom.codedeck.app -> VPS IP
#   2. Add pubkeys to /etc/strfry/allowed-pubkeys.txt
#   3. Add pubkeys to /etc/blossom/config.yml (upload rules)
#   4. Restart services: systemctl restart strfry blossom

set -euo pipefail

RELAY_DOMAIN="${RELAY_DOMAIN:-relay.codedeck.app}"
BLOSSOM_DOMAIN="${BLOSSOM_DOMAIN:-blossom.codedeck.app}"
STRFRY_PORT=7777
BLOSSOM_PORT=3000

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ─── 1. System packages ─────────────────────────────────────────────────────
log "Step 1: Installing system packages..."
apt-get update -qq
apt-get install -y --no-install-recommends \
  git g++ make pkg-config libtool ca-certificates \
  libssl-dev zlib1g-dev liblmdb-dev libflatbuffers-dev libsecp256k1-dev libzstd-dev \
  curl wget jq ufw \
  debian-keyring debian-archive-keyring apt-transport-https

# ─── 2. Firewall ────────────────────────────────────────────────────────────
log "Step 2: Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ─── 3. Build strfry ────────────────────────────────────────────────────────
log "Step 3: Building strfry (this takes a few minutes on 1 CPU)..."

# Create swap if needed (strfry build needs ~1GB RAM)
if [ "$(free -m | awk '/^Swap:/{print $2}')" -lt 1024 ]; then
  log "Creating 2GB swap..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cd /tmp
if [ ! -d strfry ]; then
  git clone https://github.com/hoytech/strfry.git
fi
cd strfry
git submodule update --init
make setup-golpe
make -j"$(nproc)"
cp strfry /usr/local/bin/strfry
cd /

# Create strfry user and data directory
useradd -r -M -s /usr/sbin/nologin strfry 2>/dev/null || true
mkdir -p /var/lib/strfry/strfry-db
chown -R strfry:strfry /var/lib/strfry

# ─── 4. Configure strfry ────────────────────────────────────────────────────
log "Step 4: Configuring strfry..."

mkdir -p /etc/strfry

cat > /etc/strfry.conf << 'STRFRYCONF'
##
## Codedeck private relay configuration
##

relay = "wss://relay.codedeck.app"

info {
    name = "Codedeck Relay"
    description = "Private relay for Codedeck bridge communication"
    contact = ""
}

database {
    dbDir = "/var/lib/strfry/strfry-db/"
    # 256MB is plenty — our steady-state DB is under 1MB
    maxDbSize = 268435456
}

relay {
    bind = "127.0.0.1"
    port = 7777
    noFiles = 65536
    realIpHeader = "X-Forwarded-For"

    writePolicy {
        plugin = "/etc/strfry/write-policy.sh"
    }

    compression {
        enabled = true
    }

    info {
        relay = "wss://relay.codedeck.app"
    }
}

events {
    maxEventSize = 65536
    rejectEventsNewerThanSeconds = 900
    rejectEventsOlderThanSeconds = 86400
    rejectEphemeralOlderThanSeconds = 300
}
STRFRYCONF

# Write-policy script: pubkey whitelist + kind restriction
cat > /etc/strfry/write-policy.sh << 'POLICY'
#!/usr/bin/env bash
# Codedeck write policy: only whitelisted pubkeys, only kinds 4515 and 30515
ALLOWED_FILE="/etc/strfry/allowed-pubkeys.txt"

# Create empty whitelist if it doesn't exist
[ -f "$ALLOWED_FILE" ] || touch "$ALLOWED_FILE"

while read -r line; do
  pubkey=$(echo "$line" | jq -r '.event.pubkey')
  kind=$(echo "$line" | jq -r '.event.kind')

  if ! grep -qx "$pubkey" "$ALLOWED_FILE" 2>/dev/null; then
    echo '{"action":"reject","msg":"pubkey not whitelisted"}'
  elif [[ "$kind" != "4515" && "$kind" != "30515" ]]; then
    echo '{"action":"reject","msg":"event kind not allowed"}'
  else
    echo '{"action":"accept"}'
  fi
done
POLICY
chmod +x /etc/strfry/write-policy.sh

# Empty pubkey whitelist — add your bridge + phone pubkeys after setup
touch /etc/strfry/allowed-pubkeys.txt

# ─── 5. strfry systemd service ──────────────────────────────────────────────
log "Step 5: Setting up strfry systemd service..."

cat > /etc/systemd/system/strfry.service << 'UNIT'
[Unit]
Description=strfry Nostr relay
After=network.target

[Service]
Type=simple
User=strfry
Group=strfry
ExecStart=/usr/local/bin/strfry --config=/etc/strfry.conf relay
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable strfry
systemctl start strfry

# ─── 6. Install Node.js 22 LTS ──────────────────────────────────────────────
log "Step 6: Installing Node.js 22 LTS..."
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "Node.js $(node -v), npm $(npm -v)"

# ─── 7. Install blossom-server ───────────────────────────────────────────────
log "Step 7: Installing blossom-server..."

mkdir -p /opt/blossom
cd /opt/blossom
if [ ! -d blossom-server ]; then
  git clone https://github.com/hzrd149/blossom-server.git
fi
cd blossom-server

# Install pnpm if not present
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
fi

pnpm install
pnpm run build

# Create data directories
mkdir -p /var/lib/blossom/blobs
mkdir -p /var/lib/blossom

# Create blossom user
useradd -r -M -s /usr/sbin/nologin blossom 2>/dev/null || true
chown -R blossom:blossom /var/lib/blossom

# ─── 8. Configure blossom-server ─────────────────────────────────────────────
log "Step 8: Configuring blossom-server..."

mkdir -p /etc/blossom

cat > /etc/blossom/config.yml << 'BLOSSOMCONF'
# Codedeck Blossom media server configuration
publicDomain: blossom.codedeck.app

databasePath: /var/lib/blossom/blossom.sqlite

storage:
  backend: local
  local:
    dir: /var/lib/blossom/blobs

# Require BUD-02 auth for uploads — only whitelisted pubkeys can upload
upload:
  enabled: true
  requireAuth: true
  rules:
    # Add your phone pubkey(s) here to allow uploads
    # - type: allow
    #   pubkeys:
    #     - <phone-pubkey-hex>

# Public read access (blobs are AES-256-GCM encrypted anyway)
list:
  requireAuth: false
BLOSSOMCONF

chown -R blossom:blossom /etc/blossom

# ─── 9. blossom-server systemd service ───────────────────────────────────────
log "Step 9: Setting up blossom-server systemd service..."

cat > /etc/systemd/system/blossom.service << UNIT
[Unit]
Description=Blossom media server
After=network.target

[Service]
Type=simple
User=blossom
Group=blossom
WorkingDirectory=/opt/blossom/blossom-server
ExecStart=$(which node) /opt/blossom/blossom-server/dist/index.js
Environment=PORT=${BLOSSOM_PORT}
Environment=CONFIG_PATH=/etc/blossom/config.yml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

chown -R blossom:blossom /opt/blossom
systemctl daemon-reload
systemctl enable blossom
systemctl start blossom

# ─── 10. Install Caddy ──────────────────────────────────────────────────────
log "Step 10: Installing Caddy..."
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y caddy

# ─── 11. Configure Caddy ────────────────────────────────────────────────────
log "Step 11: Configuring Caddy reverse proxy..."

cat > /etc/caddy/Caddyfile << CADDYFILE
${RELAY_DOMAIN} {
    reverse_proxy localhost:${STRFRY_PORT}
}

${BLOSSOM_DOMAIN} {
    reverse_proxy localhost:${BLOSSOM_PORT}
}
CADDYFILE

systemctl restart caddy

# ─── 12. Cron jobs ──────────────────────────────────────────────────────────
log "Step 12: Setting up maintenance cron jobs..."

# Daily strfry compact at 3am
cat > /etc/cron.d/strfry-compact << 'CRON'
0 3 * * * strfry /usr/local/bin/strfry --config=/etc/strfry.conf compact
CRON

# Daily blossom blob purge at 4am (remove blobs older than 24h)
cat > /etc/cron.d/blossom-purge << 'CRON'
0 4 * * * root find /var/lib/blossom/blobs -type f -mmin +1440 -delete 2>/dev/null; find /var/lib/blossom/blobs -type d -empty -delete 2>/dev/null
CRON

# ─── Done ────────────────────────────────────────────────────────────────────
log "============================================"
log "Setup complete!"
log "============================================"
log ""
log "Services running:"
log "  strfry:   $(systemctl is-active strfry)  (port ${STRFRY_PORT})"
log "  blossom:  $(systemctl is-active blossom)  (port ${BLOSSOM_PORT})"
log "  caddy:    $(systemctl is-active caddy)"
log ""
log "Next steps:"
log "  1. Point DNS:"
log "     ${RELAY_DOMAIN}   -> $(curl -s4 ifconfig.me || echo '<this IP>')"
log "     ${BLOSSOM_DOMAIN} -> $(curl -s4 ifconfig.me || echo '<this IP>')"
log ""
log "  2. Add pubkeys to strfry whitelist:"
log "     echo '<bridge-pubkey-hex>' >> /etc/strfry/allowed-pubkeys.txt"
log "     echo '<phone-pubkey-hex>'  >> /etc/strfry/allowed-pubkeys.txt"
log ""
log "  3. Add phone pubkey to blossom config:"
log "     Edit /etc/blossom/config.yml — uncomment and set pubkeys in upload.rules"
log "     systemctl restart blossom"
log ""
log "  4. Wait for DNS propagation + Caddy auto-TLS, then test:"
log "     curl -s https://${RELAY_DOMAIN}/ | head"
log "     curl -s https://${BLOSSOM_DOMAIN}/ | head"
log ""
log "  5. Test with nak:"
log "     nak event -k 1 -c 'test' wss://${RELAY_DOMAIN}"
