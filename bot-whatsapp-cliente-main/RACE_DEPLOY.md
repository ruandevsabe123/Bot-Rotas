# Implantação do modo corrida

Use uma VPS Linux próxima dos clientes, com pelo menos 2 vCPU, 2 GB de RAM e rede estável. Evite plano que suspende a aplicação por inatividade.

1. Crie um `.env` sem versioná-lo:

   ```env
   PANEL_USERS=cliente@exemplo.com:senha-forte:client,admin@exemplo.com:senha-forte:admin
   PANEL_ADMIN_EMAILS=admin@exemplo.com
   PANEL_SESSION_SECRET=gere-um-segredo-longo-e-aleatorio
   ```

2. Suba o serviço:

   ```bash
   docker compose -f docker-compose.race.yml up -d --build
   ```

3. Abra a porta 3000 somente atrás de HTTPS/reverse proxy. O volume `bot_race_data` preserva autenticação, configurações, romaneios e telemetria nos reinícios.

4. No painel, conecte o WhatsApp, configure o grupo de teste, execute **Medir latência** e só arme o alvo quando a saúde aparecer como `excelente` ou `boa`.

O modo corrida mantém metadados e mensagens preparados. Não execute duas instâncias usando a mesma sessão: isso causa conflito de conexão, duplicidade e piora a latência.
