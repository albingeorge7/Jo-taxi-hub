#!/usr/bin/env bash
# Run on the Raspberry Pi from inside the cab-rental folder:  bash deploy/setup-pi.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$USER}"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

ENV_FILE=/etc/cab-rental.env
if [ ! -f "$ENV_FILE" ]; then
  while :; do
    read -rsp "Choose the driver dashboard password (min 8 characters, no quote marks): " PW; echo
    [ ${#PW} -ge 8 ] && [[ "$PW" != *"'"* ]] && [ "$PW" != "driver123" ] && break
    echo "Too short, contains a quote mark, or is the default - try again."
  done
  sudo tee "$ENV_FILE" >/dev/null <<EOT
PORT=3100
DRIVER_PASSWORD='$PW'
DATA_DIR=$APP_DIR/data
# BASE_URL=https://your-address   (set once you know the public address; used in bill links)
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
EOT
  sudo chmod 600 "$ENV_FILE"
fi

sudo tee /etc/systemd/system/cab-rental.service >/dev/null <<EOT
[Unit]
Description=JO Taxi Cab website
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOT

sudo systemctl daemon-reload
sudo systemctl enable --now cab-rental
sleep 1
systemctl is-active cab-rental && echo "Running on http://$(hostname -I | awk '{print $1}'):$(sudo grep -h ^PORT= $ENV_FILE | cut -d= -f2)"
