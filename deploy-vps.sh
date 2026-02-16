#!/bin/bash

# Script untuk setup bot di VPS Ubuntu

echo "🚀 Starting bot deployment..."

# Update system
echo "📦 Updating system packages..."
sudo apt update

# Install Node.js (jika belum ada)
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node -v)"
fi

# Install unzip (jika belum ada)
if ! command -v unzip &> /dev/null; then
    echo "📥 Installing unzip..."
    sudo apt install -y unzip
fi

# Extract project
echo "📂 Extracting project files..."
unzip -o bot-note-buy.zip -d ~/bot-note-buy
cd ~/bot-note-buy

# Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# Install PM2 globally (jika belum ada)
if ! command -v pm2 &> /dev/null; then
    echo "📥 Installing PM2..."
    sudo npm install -g pm2
else
    echo "✅ PM2 already installed"
fi

# Start bot with PM2
echo "🤖 Starting bot with PM2..."
pm2 delete telegram-bot 2>/dev/null || true
pm2 start index.js --name telegram-bot

# Setup PM2 startup
echo "🔧 Setting up PM2 auto-start..."
pm2 startup
pm2 save

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Bot status:"
pm2 status

echo ""
echo "📝 Useful commands:"
echo "  pm2 logs telegram-bot    # View logs"
echo "  pm2 restart telegram-bot # Restart bot"
echo "  pm2 stop telegram-bot    # Stop bot"
echo "  pm2 status               # Check status"
