#!/usr/bin/env bash
set -e

if [ "$EUID" -eq 0 ]; then
  echo "Error: Do not run this script as root/sudo!"
  echo "Please run it as a normal user: ./deploy.sh"
  echo "(It will prompt for your sudo password only during the systemd installation)"
  exit 1
fi

echo "==========================================="
echo " VLLM / Llama.cpp Dashboard Deploy Script"
echo "==========================================="

echo "1. Building the Next.js production bundle..."
npm install
npm run build


# 2. Synchronizing user configuration to ~/.config/kanban...
echo "2. Synchronizing user configuration to ~/.config/kanban..."
REAL_USER=$(whoami)
NODE_PATH=$(which node)
NPM_PATH=$(which npm)
WORK_DIR=$(pwd)
USER_CONFIG_DIR="$HOME/.config/kanban"
mkdir -p "$USER_CONFIG_DIR"
# Copy model config
cp "$WORK_DIR/model-config.json" "$USER_CONFIG_DIR/model-config.json"
# Copy app config if config.json doesn't exist
if [ ! -f "$USER_CONFIG_DIR/config.json" ]; then
  cp "$WORK_DIR/config.default.json" "$USER_CONFIG_DIR/config.json"
fi

echo "3. Setting up Systemd daemon..."
SERVICE_FILE="/etc/systemd/system/vllm-dashboard.service"

echo "Requesting sudo privileges to install $SERVICE_FILE..."

# Create a temporary service file with dynamically resolved paths
cat <<EOF > /tmp/vllm-dashboard.service
[Unit]
Description=VLLM/Llama.cpp Monitor Dashboard
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$WORK_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=modern
Environment=MONITOR_QUEUE_SAMPLING_INTERVAL_MS=10000
Environment=MONITOR_QUEUE_RING_BUFFER_SIZE=8192
Environment=PATH=$(dirname $NODE_PATH):/usr/local/bin:/usr/bin:/bin:/opt/rocm/bin
ExecStart=$NPM_PATH run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/vllm-dashboard.service $SERVICE_FILE
sudo systemctl daemon-reload
sudo systemctl enable vllm-dashboard
sudo systemctl restart vllm-dashboard

echo "==========================================="
echo " Deployment Complete!"
echo " Dashboard running at: http://localhost:3000"
echo " You can view logs using: journalctl -fu vllm-dashboard"
echo " Note: Please configure your models in 'model-config.json'."
echo "==========================================="
