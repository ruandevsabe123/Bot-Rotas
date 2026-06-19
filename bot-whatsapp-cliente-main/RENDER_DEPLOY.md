# Deploy no Render

Este projeto agora pode rodar como painel web mobile-first no Render.

## Variáveis obrigatórias/recomendadas

- `PANEL_PASSWORD`: senha para abrir/controlar o painel. Recomendado porque o link do Render é público.
- `DATA_DIR`: no `render.yaml` já está como `/opt/render/project/src/data`.
- `BOT_PHONE_NUMBER`: opcional. Use somente se quiser gerar código de pareamento pelo número em vez de QR Code. Formato: `55DDDNUMERO`, sem `+`.

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

## Uso

1. Abra o link do Render pelo celular.
2. Digite a senha configurada em `PANEL_PASSWORD`.
3. Toque em `Conectar WhatsApp`.
4. Escaneie o QR Code pelo WhatsApp.
5. Atualize grupos, salve grupo alvo/teste e mensagens.
6. Use `Iniciar bot` ou `Iniciar teste`.
