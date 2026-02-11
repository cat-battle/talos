#!/bin/bash
#
# Talos Installation Script for Ubuntu
#
# Usage: ./scripts/install.sh
#

set -e

echo "=================================="
echo "  Talos Installation"
echo "=================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js $NODE_VERSION"

# Check GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI not found. Installing..."
    sudo apt-get install -y gh
fi

GH_VERSION=$(gh --version | head -1)
echo "✓ $GH_VERSION"

# Check GitHub CLI auth
if ! gh auth status &> /dev/null; then
    echo ""
    echo "GitHub CLI not authenticated. Please run:"
    echo "  gh auth login"
    exit 1
fi

echo "✓ GitHub CLI authenticated"

# Check Copilot CLI
if ! command -v copilot &> /dev/null; then
    echo ""
    echo "Copilot CLI not found. Installing..."
    echo "Run: npm install -g @githubnext/github-copilot-cli"
    echo "Or:  gh extension install github/gh-copilot"
    exit 1
fi

echo "✓ Copilot CLI installed"

# Create tasks directories
mkdir -p tasks/{queue,running,done,failed}
echo "✓ Task directories created"

# Make CLI executable
chmod +x cli/index.js
echo "✓ CLI executable"

# Optional: Create symlink
read -p "Create symlink /usr/local/bin/talos? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo ln -sf "$(pwd)/cli/index.js" /usr/local/bin/talos
    echo "✓ Symlink created"
fi

# Optional: Install systemd service
read -p "Install systemd service? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo tee /etc/systemd/system/talos.service > /dev/null << EOF
[Unit]
Description=Talos Task Queue
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node $(pwd)/server/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable talos
    echo "✓ Systemd service installed"
    echo "  Start with: sudo systemctl start talos"
fi

echo ""
echo "=================================="
echo "  Installation Complete!"
echo "=================================="
echo ""
echo "Quick start:"
echo "  npm start           # Start server on port 3000"
echo "  talos add 'prompt'  # Add a task"
echo "  talos list          # List tasks"
echo ""
echo "Open http://localhost:3000 for the web UI"
echo ""
