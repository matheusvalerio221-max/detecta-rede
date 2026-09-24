#!/usr/bin/env bash
# Atualiza o Detecta Rede para a última versão do repositório
set -euo pipefail
cd /opt/detecta-rede
docker compose exec -T db pg_dump -U detecta detecta | gzip > backups/pre-update-$(date +%Y%m%d%H%M).sql.gz || true
git pull -q
docker compose up -d --build --remove-orphans
echo "Atualizado."
