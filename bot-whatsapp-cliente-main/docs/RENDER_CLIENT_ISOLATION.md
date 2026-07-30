# Isolamento de cliente no Render

Use esta configuração somente para clientes que disputam rotas críticas. Cada
serviço isolado executa um único bot e um único processo do WhatsApp, sem dividir
CPU, memória ou disco com os demais clientes.

## Criar um serviço isolado

1. No Render, crie um novo **Web Service** a partir do mesmo repositório e da
   branch `main`.
2. Configure o diretório raiz como `bot-whatsapp-cliente-main`, se o Render não
   detectar automaticamente.
3. Adicione um disco persistente exclusivo, montado em `/data`.
4. Copie as variáveis necessárias do serviço principal: `PANEL_USERS`,
   `PANEL_SESSION_SECRET`, `PANEL_ADMIN_EMAILS`, `LEADER_CONTACTS` e as demais
   variáveis usadas pelo painel.
5. Adicione `ISOLATED_CLIENT_EMAIL` com o e-mail exato do cliente, por exemplo
   `alanrobot@gmail.com`.
6. Faça o deploy, entre usando a conta desse cliente e leia o QR Code novamente.

## Importante

- Não mantenha o mesmo WhatsApp conectado no serviço principal e no serviço
  isolado. Depois de ler o QR no serviço isolado, a sessão anterior será
  desconectada pelo WhatsApp.
- O serviço principal continua atendendo os demais clientes. Para não iniciar o
  bot antigo do cliente migrado, desarme-o no painel principal antes da migração.
- Os dados do cliente isolado passam a ficar no disco próprio desse novo serviço.
