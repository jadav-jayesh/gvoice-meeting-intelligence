#!/usr/bin/env bash
# One-shot dependency installer for local run: ffmpeg + MongoDB 8.0 (Ubuntu 24.04 noble).
# Run with: sudo bash scripts/install-deps.sh
# Logs everything to /tmp/gvoice-install.log so failures are visible.
set -o pipefail
exec > >(tee /tmp/gvoice-install.log) 2>&1
set -x

echo "== apt update =="
apt-get update

echo "== install ffmpeg + tooling =="
apt-get install -y ffmpeg gnupg curl ca-certificates

echo "== add MongoDB 8.0 repo (noble) =="
curl -fsSL https://pgp.mongodb.com/server-8.0.asc \
  | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  > /etc/apt/sources.list.d/mongodb-org-8.0.list

echo "== apt update (with mongo repo) =="
apt-get update

echo "== install mongodb-org =="
apt-get install -y mongodb-org

set +x
echo "================ RESULT ================"
command -v ffmpeg  && ffmpeg -version | head -1 || echo "FFMPEG STILL MISSING"
command -v mongod  && mongod --version | head -1 || echo "MONGOD STILL MISSING"
echo "log saved: /tmp/gvoice-install.log"
