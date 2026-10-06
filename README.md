# Detecta Rede

Sistema de gestão da rede de franquias Detecta (inspirado no modelo SULTS).

**Fase 1:** login, unidades, usuários e perfis com permissões (franqueado solicita usuário, franqueadora aprova), Chamados (SAF) com SLA duplo por categoria e anexos, Comunicados com confirmação de leitura, Tarefas, painel.

**Fase 2:** Checklist (modelos, aplicações com foto, nota e plano de ação automático), Universidade Corporativa (pastas, aulas em vídeo/texto/arquivo, prova, relatório de progresso por usuário e pasta), notificações por e-mail (SMTP configurável no painel).

**Próximas fases:** Disco Virtual, Agenda, Expansão (COF), Implantação (Gantt), Compras, Brand Center, NPS/NES, Enquetes, LGPD, API.

## Instalação (VPS Rocky Linux 9 / Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/matheusvalerio221-max/detecta-rede/main/install.sh | bash -s -- https://github.com/matheusvalerio221-max/detecta-rede.git sistema.detecta.eco.br
```

O domínio é opcional; sem ele o sistema responde pelo IP em HTTP.

## Atualizar

```bash
bash /opt/detecta-rede/update.sh
```

## Stack

Node 22 (sem dependências externas) · SQLite embutido · Caddy (HTTPS automático) · Docker Compose · dados em `/opt/detecta-rede/data`, backup diário em `/opt/detecta-rede/backups`.
