#!/bin/sh
# Uninstall script for brainstorming
set -e

echo "→ Uninstalling brainstorming..."

if [ -f package.json ]; then
    rm -rf node_modules 2>/dev/null || true
    echo "  → Removed node_modules"
fi

echo "  ✓  brainstorming uninstalled successfully."
