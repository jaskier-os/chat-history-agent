#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "[chat-history] Installing dependencies..."
npm install --silent

echo "[chat-history] Starting agent..."
exec npx nodemon src/agent-entry.js
