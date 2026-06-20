# Deploy no Render

Este projeto agora pode rodar como painel web mobile-first no Render.

## Variáveis obrigatórias/recomendadas

- `PANEL_EMAIL`: email de login do cliente. Obrigatório em produção quando usar apenas um cliente.
- `PANEL_PASSWORD`: senha de login do cliente. Obrigatório porque o link do Render é público.
- `PANEL_USERS`: opcional para multiusuário, no formato `email1:senha1,email2:senha2`. Cada email recebe sessão e configuração separadas.
- `DATA_DIR`: no `render.yaml` já está como `/opt/render/project/src/data`.
- `BOT_PHONE_NUMBER`: opcional. Use somente se quiser gerar código de pareamento pelo número em vez de QR Code. Formato: `55DDDNUMERO`, sem `+`.
- `KEEP_ALIVE_URL`: opcional, mas recomendado no plano Free para manter o bot acordado quando estiver armado. Use a URL pública do Render, por exemplo `https://seu-servico.onrender.com`.

## Comandos

Build:

```bash
npm install && npm run build
```

Start:

```bash
npm start
```

## Persistência

O `render.yaml` cria um disco em `/opt/render/project/src/data`. É nele que ficam:

- `auth_info`: sessão do WhatsApp.
- `config.json`: grupos, nome e mensagens salvas.

Sem disco persistente, o WhatsApp pode pedir novo QR Code após deploy/restart.

Para entregar para outro cliente, apague o disco antigo no Render ou use `Ajustes > Resetar tudo` no painel do usuário. Isso remove sessão do WhatsApp, grupos, nome e mensagens salvas daquele login, e força uma nova conexão por QR Code.

## Render Free

No plano Free, o Render dorme após inatividade. Se você configurar `KEEP_ALIVE_URL`, o servidor faz um ping a cada 10 minutos somente quando o WhatsApp estiver conectado e o monitoramento estiver ativo. Isso ajuda o bot a continuar acordado durante o período em que precisa disparar rápido.

## Uso

1. Abra o link do Render pelo celular.
2. Faça login com o email de `PANEL_EMAIL` e a senha de `PANEL_PASSWORD`.
3. Toque em `Conectar WhatsApp`.
4. Escaneie o QR Code pelo WhatsApp.
5. Atualize grupos, salve grupo alvo/teste e mensagens.
6. Use `Iniciar bot` ou `Iniciar teste`.
