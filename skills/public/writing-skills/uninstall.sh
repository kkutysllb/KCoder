#!/bin/sh
# Uninstall script for writing-skills
set -e

echo "→ Uninstalling writing-skills..."

if [ -f package.json ]; then
    rm -rf node_modules 2>/dev/null || true
    echo "  → Removed node_modules"
fi

echo "  ✓  writing-skills uninstalled successfully."
