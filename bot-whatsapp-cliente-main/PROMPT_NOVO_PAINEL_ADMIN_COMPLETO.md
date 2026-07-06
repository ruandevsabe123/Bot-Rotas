# Prompt para criar um novo painel admin completo

Voce vai trabalhar em um projeto existente de bot WhatsApp chamado `Bot-whatsapp-ParaPc-rotas`. Antes de codar, leia o codigo real. Nao suponha pelo nome dos arquivos. O painel admin atual existe, mas esta feio, confuso e nao mostra tudo que o dono precisa. Seu trabalho sera criar um painel admin novo, mais completo, moderno, operacional e fiel a todas as funcionalidades do bot.

## Stack e arquitetura

- Projeto em TypeScript.
- Backend HTTP proprio em `src/server.ts`, sem Express.
- Bot WhatsApp em `src/bot/connection.ts`, usando `@whiskeysockets/baileys`.
- OCR em `src/bot/ocr.ts`, usando `tesseract` binario quando disponivel, fallback para `tesseract.js`, e `sharp` para preprocessar imagem.
- Frontend em React 19 + Vite em `src/desktop/renderer`.
- Desktop Electron em `src/desktop/main.ts` e `src/desktop/preload.ts`.
- Web/Render serve o build estatico de `dist/desktop/renderer`.
- Persistencia em arquivos JSON, nao banco:
  - `panel_users.json`
  - `support_messages.json`
  - por usuario em `users/<email_normalizado>/config.json`
  - por usuario em `users/<email_normalizado>/auth_info`
  - por usuario em `users/<email_normalizado>/route_history.json`
  - por usuario em `users/<email_normalizado>/bot_logs.json`

## Objetivo do painel admin novo

Criar um admin que seja uma central de comando real, nao uma pagina decorativa. O admin precisa enxergar, filtrar, validar, auditar, manter e gerenciar todos os clientes e bots.

O painel novo deve ser:

- Denso, limpo e operacional, estilo ferramenta SaaS/monitoramento.
- Responsivo em desktop e mobile.
- Com sidebar ou tabs claras.
- Com dashboard inicial de visao geral.
- Com paginas separadas para clientes, validacoes, historico, logs, suporte, relatorios e manutencao.
- Com estados vazios, loading, erro, online/offline e badges claros.
- Com icones `lucide-react` nos botoes.
- Sem landing page.
- Sem cards dentro de cards.
- Sem textos enormes explicando como usar dentro da interface.
- Sem esconder funcionalidades importantes somente em modais.
- Sem quebrar o painel cliente existente.

## Direcao visual

O painel atual usa muito tema escuro preto/amarelo/verde/azul, muitos cards e gradientes. Pode manter uma identidade escura, mas melhore a legibilidade e reduza o visual pesado.

Sugestao:

- Fundo: `#07090c` ou `#0b0f14`.
- Superficies: `#11161d`, `#151b23`.
- Bordas: `rgba(148, 163, 184, 0.18)`.
- Texto principal: `#f8fafc`.
- Texto secundario: `#94a3b8`.
- Primaria admin: azul ciano `#38bdf8` ou verde operacional `#22c55e`.
- Alerta: amarelo `#f59e0b`.
- Perigo: vermelho `#ef4444`.
- Sucesso: verde `#22c55e`.
- Cliente: usar a cor individual de cada usuario (`clientColor` / `user.color`) como detalhe visual, nao como fundo inteiro.

Layout sugerido:

- Sidebar fixa no desktop com itens:
  - Dashboard
  - Validacoes
  - Historico
  - Logs
  - Clientes
  - Suporte
  - Relatorios
  - Manutencao/Ajustes
- Topbar com filtro global de cliente, periodo e notificacoes.
- Conteudo em tabelas densas, listas com filtros e paineis de detalhe.
- Mobile com bottom navigation ou menu compacto.

## Usuarios, login e sessoes

O login fica em `src/server.ts`:

- `PANEL_USERS` define usuarios no formato `email:senha:role:color`.
- `PANEL_ADMIN_EMAILS` tambem pode marcar admins.
- Usuario pode ter role `admin` ou `client`.
- `createSessionToken(email)` cria token assinado por HMAC com TTL de 180 dias.
- `verifySessionToken(token)` valida assinatura, expiracao e existencia do usuario.
- `requireAuth()` protege APIs.
- `requireAdmin()` bloqueia endpoints admin para clientes.
- `touchPanelUser(email)` atualiza `lastSeenAt` e soma `totalUsageMs`.

O admin deve mostrar:

- Email.
- Role.
- Bloqueado ou liberado.
- Cor do cliente.
- Online agora, ativo recente ou offline.
- Se o painel/bot esta aberto.
- Status do bot.
- Monitoramento ligado/desligado.
- Criado em, atualizado em, ultimo login, ultimo visto.
- Tempo total de uso.
- Quantidade de logins.
- Historico de login com IP e user-agent.

Funcoes de usuarios em `src/panelUserStore.ts`:

- `all()`: carrega todos os usuarios persistidos.
- `upsert(input)`: cria ou edita usuario; exige email e senha para novo usuario; normaliza role, bloqueio e cor.
- `remove(email)`: remove usuario persistido.
- `recordLogin(email, ip, userAgent)`: salva evento de login e limita historico a 100.
- `touch(email)`: atualiza ultimo visto e acumula uso se a diferenca for menor que 5 minutos.
- `defaultUserColor(email)`: gera cor padrao deterministica.
- `normalizeUserColor(value, email)`: aceita apenas hex `#rrggbb`, senao usa cor padrao.

## Multiusuario e isolamento por cliente

Em `src/server.ts`:

- `bots` e um `Map<string, BotService>`, um bot por email.
- `getUserStorageKey(email)` normaliza email para nome de pasta.
- `getBotForEmail(email)` cria ou reaproveita o bot daquele usuario.
- Cada cliente tem auth, config, logs e historico proprios.
- `renameUserStorage(oldEmail, nextEmail)` para bot antigo, renomeia pasta e atualiza `clientEmail` no historico.
- O primeiro usuario pode migrar dados legados de `auth_info` e `config.json`.

O admin deve permitir:

- Listar clientes.
- Criar cliente.
- Editar email, senha, role, bloqueio e cor.
- Bloquear/desbloquear cliente.
- Abrir detalhe do cliente.
- Filtrar todos os dados por cliente.
- Ver se o cliente esta online e se o bot dele esta conectado/monitorando.

## BotService: funcoes e comportamento do bot

Arquivo principal: `src/bot/connection.ts`.

Estados principais:

- `status`: `disconnected`, `connecting`, `connected`, `waiting_qr`, `reconnecting`, `error`.
- `groupState`: `unknown`, `open`, `closed`.
- `monitoringEnabled`: bot armado ou parado.
- `monitoringMode`: `target` para grupo alvo, `test` para grupo teste.
- `targetDispatchMode`: `manual` ou `ocr`.
- `nuclearMode`: modo de disparo mais agressivo.
- `warmupCompleted`, `warmupMessagesSent`, `testStatus`.
- `performanceMetrics`: latencia, duracao, medias, fila, enviados, falhas, keep-alive.

Funcoes publicas importantes:

- `getSnapshot()`: devolve tudo que o frontend precisa: status, grupo, QR, config, grupos, checklist, logs, erro, monitoramento, teste, metricas e historico de rotas.
- `getRoutes()`: devolve historico de disparos do usuario.
- `validateRoute(routeId, validatedBy)`: marca rota como validada pelo admin.
- `rejectRoute(routeId, rejectedBy)`: marca rota como rejeitada pelo admin.
- `isMonitoringEnabled()`: indica se esta armado.
- `enableMonitoring()`: arma modo alvo manual.
- `enableImageMonitoring()`: arma modo alvo OCR/imagem.
- `enableNuclearMonitoring()`: arma modo alvo manual com nuclear ligado.
- `enableTestMonitoring()`: arma grupo de teste para ouvir abertura/fechamento como se fosse real.
- `disableMonitoring()`: para monitoramento, cancela ciclos, para teste se ativo, limpa timers.
- `simulateOpening()`: simula abertura e dispara sem depender do evento real.
- `manualDispatch()`: dispara manualmente, mas so se WhatsApp conectado e grupo alvo estiver aberto.
- `simulateTargetDispatchOnTestGroup()`: envia as mensagens do alvo no grupo de teste.
- `start()`: inicia conexao WhatsApp/Baileys.
- `stop()`: encerra conexao e timers, preserva auth.
- `shutdownAndClearSession()`: para conexao e monitoramento preservando auth, usado no reset diario/fechamento.
- `restart()`: reinicia conexao.
- `clearSession()`: logout, apaga auth e inicia para gerar novo QR.
- `factoryReset()`: apaga auth, config, cache, mensagens, estado e volta ao padrao.
- `saveGroup(group, groupId, groupName)`: salva grupo alvo.
- `saveTestGroup(group, groupId, groupName)`: salva grupo teste.
- `warmupConnection(message?)`: envia mensagens de aquecimento no grupo teste.
- `refreshGroups()`: carrega grupos do WhatsApp.
- `clearLogs(silent?)`: limpa logs do usuario.
- `clearRouteHistory(silent?)`: limpa historico de disparos do usuario.
- `setGeneralSettings(settings)`: salva nuclear, fastMode, minSendDelayMs, alwaysWarmMode, keepAliveIntervalMs.
- `setMessageCodes(codes)`: salva codigos do alvo.
- `setMessageSettings(senderName, codes, routes, monitoredRouteDetails, targetDispatchMode)`: salva nome, mensagens alvo manual, rotas OCR e modo alvo.
- `setWarmupMessageSettings(senderName, codes, messageCount, intervalMs)`: salva mensagens de teste/aquecimento.

Funcoes privadas relevantes:

- `loadBaileys()`: importa Baileys dinamicamente.
- `connect()`: cria socket Baileys, registra eventos de credenciais, conexao, grupos e mensagens.
- `handleConnectionUpdate(update, connectionId)`: trata QR, conexao aberta, queda, reconexao e sessao invalida.
- `failConnectionWithoutReconnect(message)`: para em erro sem loop infinito.
- `resolveConfiguredGroup()`: resolve e salva JID/nome do grupo alvo.
- `resolveConfiguredTargetGroup(config)`: acha grupo por JID/cache/nome.
- `loadGroups()`: carrega grupos participantes e atualiza cache.
- `captureInitialGroupState()`: identifica se grupo iniciou aberto ou fechado.
- `scheduleReconnect(forceNewQr)`: tenta reconectar ate 5 vezes.
- `handleGroupsUpdate(updates, connectionId)`: detecta abertura/fechamento por `announce`.
- `handleMessages(messages, connectionId)`: detecta palavras de abertura e imagens para OCR.
- `scheduleReactionProcessing(messages)`: agenda processamento de reacoes sem atrapalhar disparo critico.
- `scheduleRouteImageProcessing(msg, groupJid)`: agenda OCR de imagem.
- `processRouteImage(msg, groupJid)`: baixa imagem, roda OCR, acha rota/codigo, prepara ou dispara mensagem.
- `handleReactions(messages)`: registra reacoes em mensagens enviadas.
- `getReactionSenderIdentifiers()`: tenta identificar telefone/JID de quem reagiu.
- `getReactionPhoneFromGroupMetadata()`: resolve telefone da reacao pelo metadata do grupo.
- `resolvePhoneFromLid(value)`: traduz LID interno para telefone quando possivel.
- `collectReactionIdentifierCandidates(input)`: varre objetos procurando JIDs/telefones.
- `isAdminPhoneIdentifier(value)`: confere se telefone e de lider/admin.
- `getLeaderNameFromIdentifiers(values)`: traduz telefone de lider para nome conhecido.
- `samePhone(left, right)`: compara numeros com/sem DDI 55.
- `enviarMensagensRapidas(cycleId, trigger, eventDetectedAt)`: escolhe sequencia de envio e registra rota.
- `ensurePreparedRelayMessages()`, `rebuildPreparedRelayMessages()`, `getRelaySignature()`: preconstroem mensagens Baileys para reduzir latencia.
- `registerRouteDispatch()`: cria registro de rota/disparo.
- `updateRouteDispatch()`: atualiza status `sent`, `partial` ou `failed`.
- `sendFastSequence()`: envio sequencial rapido.
- `sendNuclearTargetSequence()`: chama sequencia agressiva com log de nuclear.
- `sendAggressiveTargetSequence()`: envia mensagens em paralelo via `relayMessage`.
- `stopMonitoringAfterTargetDispatch()`: para bot automaticamente depois de disparo no alvo para evitar duplicidade.
- `sendSingleInstant()`: envia uma mensagem preparada.
- `sendMessageWithRetry()`: retenta erros temporarios/not-acceptable.
- `isRetryableSendError()`: identifica erros retentaveis.
- `startHealthCheck()`, `runHealthCheck()`: verifica saude e reinicia se falhar.
- `startWarmKeepAlive()`, `runWarmKeepAlive()`: modo sempre quente, renova metadata/cache/plano.
- `prewarmConnection()`, `prewarmGroup()`: valida metadata, estado e participacao da conta no grupo.
- `getReadinessChecks()`: checklist para UI.
- `hasReadyMessages()`: verifica se ha mensagens/rotas configuradas.
- `hasConfiguredOcrRoutes()`: verifica rotas OCR.
- `describeConfiguredOcrRoutes()`: texto resumido das rotas OCR.
- `diagnoseNotAcceptable()`: diagnostica erro quando WhatsApp recusa mensagem.
- `isInvalidSession()`: detecta auth invalida/logout.
- `hasAuthSession()`: verifica `creds.json`.
- `logoutAndClearSession()`: logout e limpeza de auth.
- `isFatalRuntimeError()`: detecta falhas como `crypto is not defined`.
- `getWhatsAppVersion()`: busca versao WhatsApp Web pelo Baileys.
- `refreshGroupMetadata(jid)`: atualiza cache de metadata do grupo.
- `removeAuthDir()`: apaga pasta auth.
- `setStatus()`, `emitSnapshot()`: atualizam estado e emitem evento.
- `normalizePhone()`, `normalizePhoneFromUnknown()`: normalizam telefone.

## Modos de operacao que o admin deve entender

1. Bot manual alvo:
   - Usuario configura grupo alvo, nome de envio e codigos.
   - Mensagens ficam no formato `<nomeEnvio> <codigo>`.
   - Bot arma e espera grupo fechar e abrir.
   - Ao abrir, dispara ate 2 mensagens.

2. Bot imagem/OCR:
   - Usuario configura grupo alvo, nome e rotas monitoradas por cidade/bairro.
   - Bot le imagens recebidas no grupo.
   - OCR procura bairro/cidade e gaiola/codigo seguro na mesma linha.
   - Se grupo estiver aberto, dispara na hora.
   - Se grupo estiver fechado, deixa mensagem pronta para proxima abertura.

3. Bot nuclear:
   - Variante agressiva do alvo manual.
   - Dispara com baixa latencia e logs especificos.

4. Teste/aquecimento:
   - Usuario configura grupo teste.
   - Pode enviar `testMessageCount` mensagens, padrao 15.
   - Pode configurar intervalo `testMessageIntervalMs`.
   - Pode armar grupo teste para abrir/fechar como se fosse alvo.
   - Pode simular mensagens do alvo no grupo de teste.

5. Modo sempre quente:
   - `alwaysWarmMode` renova metadata e plano periodicamente.
   - `keepAliveIntervalMs` entre 1 e 10 minutos.
   - Metricas mostram ultimo keep-alive, duracao e quantidade.

## OCR: funcoes e regras

Arquivo: `src/bot/ocr.ts`.

- `normalizeOcrText(text)`: remove acento, caixa baixa, limpa caracteres e espacos.
- `readImageText(imagePath)`: retorna apenas texto OCR.
- `readRouteImageOcr(imagePath)`: cria imagem preprocessada e le OCR estruturado.
- `readSingleRouteImageOcr(imagePath, label)`: tenta binario e cai para JS.
- `readRouteImageOcrWithBinary()`: usa comando `tesseract ... tsv`.
- `readRouteImageOcrWithTesseractJs()`: usa worker `tesseract.js`.
- `createPrimaryPreprocessedImage()`: usa `sharp`, rotaciona, corta topo, aumenta resolucao, grayscale, normalize, contraste e sharpen.
- `getTesseractJsWorker()`: singleton do worker.
- `isMissingTesseractBinary()`: detecta falta do binario.
- `findConfiguredRouteCode()`: API legada por texto simples.
- `findConfiguredRouteCodeDetailed()`: procura em texto com rotas detalhadas.
- `findConfiguredRouteCodeFromOcr()`: procura usando linhas/posicoes OCR.
- `findConfiguredRouteCodeInLines()`: regra principal: precisa achar cidade/bairro configurado e codigo/gaiola seguro.

O painel admin deve ter visibilidade de:

- Quais clientes usam OCR.
- Quais rotas/cidades/bairros estao configuradas.
- Logs de OCR detectado ou ignorado.
- Disparos originados por OCR.

## Configuracao do bot

Arquivo: `src/bot/config.ts`.

`DEFAULT_CONFIG`:

- `grupoAlvoJid`, `grupoAlvoNome`
- `grupoTesteJid`, `grupoTesteNome`
- `nomeEnvio`
- `targetDispatchMode`: `manual` ou `ocr`
- `nuclearMode`
- `codigosMensagensAlvo`
- `rotasMonitoradas`
- `rotasMonitoradasDetalhadas`
- `codigosMensagensTeste`
- `testMessageCount`
- `testMessageIntervalMs`
- `fastMode`
- `minSendDelayMs`
- `alwaysWarmMode`
- `keepAliveIntervalMs`

Funcoes:

- `load()`: carrega e normaliza config.
- `save(config)`: merge com config atual e salva.
- `saveGroup(group)`: salva grupo alvo por nome ou JID.
- `saveGroupById(groupId, groupName)`: salva alvo por ID.
- `saveTestGroup(group)`: salva teste por nome ou JID.
- `saveTestGroupById(groupId, groupName)`: salva teste por ID.
- `normalize(input)`: aplica defaults, limites e compatibilidade legada.
- `clampNumber(value, min, max, fallback)`: limita numeros.

## Grupos

Arquivo: `src/bot/group.ts`.

- `normalizarTexto(texto)`: remove acentos, baixa caixa e trim.
- `resolveGroup(sock, group)`: se tiver JID, retorna ele; senao busca grupo participante pelo nome exato normalizado.

O admin deve mostrar grupo alvo e grupo teste de cada cliente, incluindo nome e JID quando disponivel.

## Logs

Arquivo: `src/bot/logger.ts`.

- `BotLogger` guarda no maximo 250 logs por usuario.
- Cada log tem `id`, `timestamp`, `level` (`info`, `success`, `warning`, `error`) e `message`.
- `clear()` limpa.
- `info/success/warning/error()` adicionam logs.
- `flush()` salva em JSON.

Admin deve ter:

- Logs ao vivo de todos os clientes.
- Filtro por cliente.
- Filtro por nivel.
- Busca por texto.
- Indicador de logs novos.
- Acesso aos ultimos 1000 logs agregados.
- Botao de limpar logs por cliente ou global.

## Historico de rotas e validacao

Arquivo: `src/bot/routeStore.ts`.

- `RouteStore` guarda no maximo 100 rotas por cliente.
- `all()`: lista rotas.
- `clear()`: limpa historico.
- `create(input)`: cria rota com `decisionStatus: pending`.
- `update(id, patch)`: atualiza contagem/status.
- `validate(id, validatedBy)`: marca `validated`, salva admin e hora.
- `reject(id, rejectedBy)`: marca `rejected`, salva admin e hora.
- `addReaction(messageId, reaction)`: associa reacao a rota pelo ID da mensagem enviada.
- `flush()`: grava imediatamente.
- `normalize(input)`: normaliza dados antigos.

Tipos importantes:

- `RouteDispatch`:
  - `id`
  - `clientEmail`
  - `clientColor`
  - `groupJid`, `groupName`
  - `mode`: `target` ou `test`
  - `trigger`: `automatic`, `manual`, `warmup`, `target-simulation`, `simulation`
  - `messages`
  - `sentMessageIds`
  - `confirmedCount`, `totalCount`
  - `status`: `sending`, `sent`, `partial`, `failed`
  - `createdAt`, `updatedAt`
  - `validated`
  - `decisionStatus`: `pending`, `validated`, `rejected`
  - `validatedAt`, `validatedBy`, `rejectedAt`, `rejectedBy`
  - `reactions`

- `RouteReaction`:
  - `id`
  - `timestamp`
  - `emoji`
  - `senderJid`
  - `senderPhone`
  - `senderIdentifiers`
  - `isAdmin`
  - `leaderName`

Admin novo precisa ter:

- Fila de rotas pendentes.
- Destaque para rotas com reacao de lider/admin.
- Validar rota.
- Rejeitar rota.
- Ver detalhes da rota.
- Ver mensagens enviadas.
- Ver reacoes, telefone, identificadores e nome do lider.
- Filtrar por cliente, data, status, origem e grupo.
- Separar historico automatico, manual/simulacao e teste/aquecimento.
- Relatorios por periodo com validadas, pendentes, rejeitadas, total e taxa.

## Suporte interno

Arquivo: `src/supportMessageStore.ts`.

- Clientes bloqueados ou logados podem enviar mensagem ao admin.
- `create(input)` exige email e mensagem, salva user-agent e limita a 300.
- `markRead(id)` marca lida.
- `clear(email?)` limpa todas ou de um cliente.
- `all()` lista.

Admin novo precisa ter:

- Caixa de entrada de suporte.
- Contador de nao lidas.
- Filtro por cliente.
- Marcar como lida.
- Limpar mensagens por cliente ou global.
- Mostrar user-agent e data.

## APIs HTTP existentes

Arquivo: `src/server.ts`.

Publicas:

- `GET /api/ping`: healthcheck.
- `POST /api/login`: login por email e senha.
- `POST /api/support/messages`: cliente envia suporte.

Cliente logado:

- `GET /api/me`
- `GET /api/snapshot`
- `GET /events?token=...`: SSE do snapshot do bot do cliente.
- `GET /qr.svg`: QR do WhatsApp.
- `POST /api/action/:action`: executa acao do bot.

Admin:

- `GET /api/admin/events?token=...`: SSE com monitor admin.
- `GET /api/admin/monitor`: snapshot completo admin.
- `GET /api/admin/routes`: rotas agregadas.
- `PATCH /api/admin/routes/:id/validate`
- `PATCH /api/admin/routes/:id/reject`
- `GET /api/admin/users`
- `GET /api/admin/users/:email`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:email`
- `GET /api/admin/support/messages`
- `PATCH /api/admin/support/messages/:id`
- `POST /api/admin/maintenance/clear`

Acoes em `/api/action/:action`:

- `start`: inicia WhatsApp.
- `stop`: para WhatsApp.
- `restart`: reinicia.
- `clear-session`: limpa sessao/auth e gera novo QR.
- `factory-reset`: reset completo do usuario.
- `clear-logs`: limpa logs.
- `refresh-groups`: carrega grupos.
- `start-monitoring`: arma modo alvo manual.
- `start-image-monitoring`: arma OCR.
- `start-nuclear-monitoring`: arma nuclear.
- `start-test-monitoring`: arma grupo teste.
- `stop-monitoring`: desarma.
- `simulate-opening`: simula abertura.
- `manual-dispatch`: disparo manual no alvo se aberto.
- `simulate-target-dispatch`: manda alvo no grupo teste.
- `warmup`: aquecimento/teste.
- `save-group`: salva grupo alvo.
- `save-test-group`: salva grupo teste.
- `save-codes`: salva codigos alvo.
- `save-message-settings` / `save-target-message-settings`: salva nome, codigos, rotas e modo.
- `save-warmup-message-settings`: salva teste/aquecimento.
- `save-general-settings`: salva nuclear e sempre quente.

## Snapshots admin existentes

`getAdminMonitorSnapshot()` retorna:

- `routes`: resultado de `getAdminRoutesSnapshot()`
- `users`: resultado de `getAdminUsersSnapshot()`
- `support`: resultado de `getAdminSupportMessagesSnapshot()`
- `logs`: resultado de `getAdminLogsSnapshot()`

`getAdminRoutesSnapshot()`:

- agrega rotas de todos os clientes.
- injeta `clientColor`.
- traz `routes` ultimas 100.
- traz `pendingReactionRoutes`.
- traz totals: total de rotas, validadas, reacoes e clientes.

`getAdminUsersSnapshot()`:

- lista todos usuarios com status, presenca e metricas.

`getAdminUserDetail(email)`:

- traz resumo do usuario.
- config.
- grupos.
- status do bot.
- modo de monitoramento.
- metricas.
- ultima conexao WhatsApp inferida pelos logs.
- logs ate 250.
- rotas.
- historico de login.

`getAdminLogsSnapshot()`:

- agrega logs de clientes.
- limita a 1000.
- injeta email e cor.

## Frontend atual

Arquivos principais:

- `src/desktop/renderer/App.tsx`: app inteiro, cliente e admin juntos.
- `src/desktop/renderer/api.ts`: fetch HTTP, auth localStorage, SSE, `botApi`.
- `src/desktop/renderer/components/ControlButtons.tsx`: botoes de conectar/parar/iniciar/parar monitoramento/disparo manual.
- `src/desktop/renderer/components/GroupMessageCard.tsx`: configuracao de grupo alvo, OCR e teste.
- `src/desktop/renderer/components/SettingsPanel.tsx`: conta, suporte, modo sempre quente, limpar logs, factory reset.
- `src/desktop/renderer/components/LogsPanel.tsx`: timeline do cliente.
- `src/desktop/renderer/components/QrCodeBox.tsx`: QR.
- `src/desktop/renderer/components/StatusCard.tsx`: status e checklist.
- `src/desktop/renderer/styles.css`: estilo atual.

No admin atual em `App.tsx` existem funcoes/componentes que podem ser reaproveitados ou substituidos:

- `AdminDashboard`
- `AdminMetric`
- `AdminRouteHistory`
- `RouteRow`
- `UserEditor`
- `AdminUserRow`
- `UserDetailModal`
- `RouteDetailModal`
- `SupportMessageRow`
- `AdminLogRow`
- filtros por cliente, status, origem e nivel de log.
- relatorio mensal por periodo.
- limpeza de logs/rotas/suporte/all.
- notificacoes de logs/suporte/validacoes.

Voce pode refatorar o admin em componentes separados. Evite deixar tudo gigante em `App.tsx`.

## Electron

`src/desktop/main.ts`:

- Cria `BrowserWindow`.
- Cria `BotService` local em modo desktop.
- Registra handlers IPC equivalentes as acoes do bot.
- No fechamento, chama `shutdownAndClearSession()` para parar conexao preservando auth.

`src/desktop/preload.ts`:

- Expoe `window.botApi` com `contextBridge`.
- Tem metodos equivalentes ao `DesktopApi`.

Atencao:

- O admin web usa HTTP/SSE.
- O desktop local usa IPC.
- Nao quebre os dois caminhos.

## Requisitos concretos para o novo admin

1. Dashboard:
   - clientes online.
   - bots conectados.
   - monitoramentos ativos.
   - disparos hoje/periodo.
   - pendentes para validar.
   - reacoes de lider.
   - falhas recentes.
   - latencia media e ultima latencia.
   - fila de alertas.

2. Clientes:
   - tabela com email, role, status painel, status bot, monitoramento, grupo alvo, grupo teste, ultimo login, ultimo visto, uso total.
   - criar/editar/bloquear/desbloquear.
   - detalhe lateral com config, grupos, metricas, logs, rotas e loginHistory.

3. Validacoes:
   - fila priorizada por reacao de lider/admin.
   - botoes validar/rejeitar.
   - detalhe da rota.
   - filtros por cliente, data, status e lider.

4. Historico:
   - automatico alvo.
   - manual/simulacao.
   - teste/aquecimento.
   - status de envio, mensagens, grupo, horario, cliente.

5. Logs:
   - tempo real via SSE.
   - filtro por cliente, nivel e busca.
   - destaque para erro/warning.

6. Suporte:
   - mensagens nao lidas.
   - marcar como lida.
   - filtrar por cliente.
   - limpar.

7. Relatorios:
   - intervalo de data.
   - por cliente: total, validadas, pendentes, rejeitadas, reacoes, taxa de validacao, ultimo disparo.
   - cards de totais gerais.

8. Manutencao:
   - limpar logs, rotas, suporte ou tudo.
   - por cliente ou global.
   - confirmar antes de acoes destrutivas.
   - logout admin.

9. Tempo real:
   - usar `subscribeAdminMonitor`.
   - manter dados atualizados sem refresh manual.
   - mostrar estado de conexao do stream.

10. Qualidade:
   - rodar `npm run build`.
   - corrigir erros TypeScript.
   - manter imports limpos.
   - nao remover funcionalidades do cliente.
   - nao alterar regras do bot sem pedido explicito.

## Cuidado com lacunas atuais

- O backend ja tem muitos dados; priorize expor e organizar melhor no admin antes de inventar API nova.
- Se precisar de campo que o backend ainda nao retorna, adicione de forma compativel nos tipos e snapshots.
- Nao reduza limites/historicos existentes.
- Nao remova suporte interno.
- Nao remova reset diario/keep-alive.
- Nao misture dados de clientes.
- Nao confunda grupo alvo com grupo teste.
- Nao deixe cliente comum acessar admin.

## Entregavel esperado

Implemente o novo painel admin completo. Pode refatorar o frontend admin em arquivos novos. Preserve o painel cliente. Depois informe:

- quais arquivos foram alterados/criados;
- quais telas admin existem agora;
- quais funcionalidades do bot/admin ficaram cobertas;
- resultado do build/teste.
