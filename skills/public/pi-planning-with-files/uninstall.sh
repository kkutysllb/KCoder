#!/bin/sh
# Uninstall script for pi-planning-with-files
set -e

echo "→ Uninstalling pi-planning-with-files..."

if [ -f package.json ]; then
    rm -rf node_modules 2>/dev/null || true
    echo "  → Removed node_modules"
fi

echo "  ✓  pi-planning-with-files uninstalled successfully."
