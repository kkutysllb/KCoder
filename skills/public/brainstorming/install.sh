#!/bin/sh
# Install script for brainstorming
set -e

echo "→ Installing brainstorming..."

# Check Node.js
if ! command -v node > /dev/null 2>&1; then
    echo "  ⚠  Node.js is required but not found."
    echo "     Install from: https://nodejs.org/"
    exit 1
fi

# Install npm dependencies
if [ -f package.json ]; then
    npm install
    echo "  → npm dependencies installed"
fi

echo "  ✓  brainstorming installed successfully."
echo ""
echo "  Usage:"
echo "    node scripts/..." 
