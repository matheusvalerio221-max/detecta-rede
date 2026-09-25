#!/usr/bin/env bash
# Atualiza o Detecta Rede para a última versão do repositório
set -euo pipefail
cd /opt/detecta-rede
cp data/detecta.sqlite backups/pre-update-$(date +%Y%m%d%H%M).sqlite 2>/dev/null || true
git pull -q
docker compose up -d --build --remove-orphans
echo "Atualizado."
