#!/usr/bin/env bash
set -e

# Yoseatsume Kakeibo - One-step GAS setup script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

node "$SCRIPT_DIR/setup_gas.js" "$@"

