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

echo "2. Setting up Systemd daemon..."
SERVICE_FILE="/etc/systemd/system/vllm-dashboard.service"
REAL_USER=$(whoami)
NODE_PATH=$(which node)
NPM_PATH=$(which npm)
WORK_DIR=$(pwd)

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
Environment=PATH=$(dirname $NODE_PATH):/usr/bin:/bin
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
