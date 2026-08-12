#!/bin/sh
# Install script for writing-skills
set -e

echo "→ Installing writing-skills..."

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

echo "  ✓  writing-skills installed successfully."
echo ""
echo "  Usage:"
echo "    node scripts/..." 
