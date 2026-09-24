#!/usr/bin/env bash
# Detecta Rede — instalador para Rocky/Alma/CentOS 9 e Ubuntu 22/24
# Uso: curl -fsSL https://raw.githubusercontent.com/<usuario>/detecta-rede/main/install.sh | bash -s -- <url-do-repositorio> [dominio]
set -euo pipefail
REPO="${1:-}"; DOMAIN="${2:-}"
DIR=/opt/detecta-rede
[ -z "$REPO" ] && { echo "Uso: install.sh <url-do-repositorio> [dominio]"; exit 1; }

echo "==> 1/6 Pacotes base"
if command -v dnf >/dev/null; then
  dnf -y install -q git curl dnf-plugins-core >/dev/null
  if ! command -v docker >/dev/null; then
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >/dev/null
    dnf -y install -q docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
  fi
  systemctl enable --now docker >/dev/null
  if systemctl is-active --quiet firewalld; then firewall-cmd -q --permanent --add-service=http; firewall-cmd -q --permanent --add-service=https; firewall-cmd -q --reload; fi
else
  apt-get update -qq && apt-get install -y -qq git curl ca-certificates >/dev/null
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker >/dev/null
  command -v ufw >/dev/null && ufw allow 80,443/tcp >/dev/null || true
fi

echo "==> 2/6 Código"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q "$REPO" "$DIR"; fi
cd "$DIR"; mkdir -p backups

echo "==> 3/6 Configuração"
if [ ! -f .env ]; then
  rnd(){ tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
  ADMIN_PASSWORD="Detecta$(rnd 6)!"
  cat > .env <<EOF
DB_PASSWORD=$(rnd 32)
JWT_SECRET=$(rnd 48)
ADMIN_EMAIL=admin@detecta.com.br
ADMIN_PASSWORD=$ADMIN_PASSWORD
SITE_ADDRESS=${DOMAIN:-:80}
SECURE_COOKIES=$([ -n "$DOMAIN" ] && echo 1 || echo 0)
EOF
  chmod 600 .env
fi
[ -n "$DOMAIN" ] && sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$DOMAIN|; s|^SECURE_COOKIES=.*|SECURE_COOKIES=1|" .env

echo "==> 4/6 Build e subida dos containers (pode levar alguns minutos)"
docker compose up -d --build --remove-orphans

echo "==> 5/6 Backup diário do banco (03:00)"
cat > /etc/cron.d/detecta-rede <<'EOF'
0 3 * * * root cd /opt/detecta-rede && docker compose exec -T db pg_dump -U detecta detecta | gzip > backups/detecta-$(date +\%Y\%m\%d).sql.gz && find backups -name '*.sql.gz' -mtime +30 -delete
EOF
chmod 644 /etc/cron.d/detecta-rede

echo "==> 6/6 Verificação"
for i in $(seq 1 30); do curl -fs http://127.0.0.1/api/health >/dev/null 2>&1 && break; sleep 3; done
IP=$(curl -fs -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "=================================================="
echo " Detecta Rede instalado."
echo " Acesse: ${DOMAIN:+https://$DOMAIN  ou  }http://$IP"
echo " Login:  $(grep ADMIN_EMAIL .env | cut -d= -f2)"
echo " Senha:  $(grep ADMIN_PASSWORD .env | cut -d= -f2)"
echo " (troque a senha em 'Minha conta' após o primeiro acesso)"
echo "=================================================="
