#!/bin/sh
# Uninstall script for planning-with-files
set -e

echo "→ Uninstalling planning-with-files..."

if [ -f package.json ]; then
    rm -rf node_modules 2>/dev/null || true
    echo "  → Removed node_modules"
fi

echo "  ✓  planning-with-files uninstalled successfully."
