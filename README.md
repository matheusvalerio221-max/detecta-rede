# Detecta Rede

Sistema de gestão da rede de franquias Detecta (inspirado no modelo SULTS).

**Fase 1 (esta versão):** login, unidades, usuários e perfis com permissões, Chamados (SAF) com SLA, Comunicados com confirmação de leitura, Tarefas, painel.

**Próximas fases:** Checklist de campo, Universidade Corporativa, Disco Virtual, Agenda, Expansão (COF), Implantação (Gantt), Compras, Brand Center, NPS/NES, Enquetes, LGPD, Power-Ups, API.

## Instalação (VPS Rocky Linux 9 / Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/detecta-rede/main/install.sh | bash -s -- https://github.com/SEU_USUARIO/detecta-rede.git rede.detecta.com.br
```

O domínio é opcional; sem ele o sistema responde pelo IP em HTTP.

## Atualizar

```bash
bash /opt/detecta-rede/update.sh
```

## Stack

Node 22 + Express · PostgreSQL 16 · Caddy (HTTPS automático) · Docker Compose · backup diário em `/opt/detecta-rede/backups`.
