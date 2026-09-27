# Auditoria técnica — 24/09/2026

Auditoria com correções aplicadas ao código, testes de regressão e segunda revisão. Arquitetura, identidade visual e regras de seleção/prioridade de rotas foram preservadas. O resultado validado é local, em Windows com Node.js 24.17.0; não constitui garantia de ausência de bugs ou homologação do WhatsApp em produção.

## Resultado verificado

- **184 testes passaram**, sem falhas, cancelamentos ou testes ignorados.
- TypeScript e build de produção passaram.
- Aplicação Electron abriu em janela oculta com dados temporários: main, preload, React, CSS, IPC, SQLite e processamento de imagens funcionaram.
- Pacote Windows e instalador NSIS foram gerados. Os módulos nativos SQLite e sharp também foram executados diretamente a partir do `app.asar` distribuído.
- `npm audit`: de **24 alertas iniciais** — 20 altos, 3 moderados e 1 baixo — para **zero vulnerabilidades conhecidas reportadas** na árvore instalada.
- Nenhuma conexão real, pareamento ou mensagem de WhatsApp foi realizada durante a validação. Credenciais e dados reais existentes não foram usados como fixtures nem impressos no relatório.

## Arquitetura e cobertura

| Área | Funcionamento e revisão |
| --- | --- |
| `src/server.ts` | Servidor HTTP Node, login, autorização, sessões, SSE, administração, arquivos estáticos, uploads e roteamento das ações por cliente. |
| `src/bot/` | Baileys, conexão/reconexão, workers por cliente, fila e coordenação de disparos, cancelamento, OCR, locks/cache, logs e históricos. |
| `src/services/` | Prioridade condicional entre clientes, coordenação de corrida, leitura de romaneios, agrupamento, filtros e ranking. |
| Stores na raiz de `src/` | Contas, líderes, suporte, notificações e cobrança por análises; normalização, persistência e entradas inválidas. |
| `src/desktop/` | Electron main/preload, isolamento do renderer, IPC, execução empacotada e encerramento. |
| `src/desktop/renderer/` | React 19, transporte HTTP/SSE, estado de sessão, painel administrativo, formulários, ações concorrentes e service worker. |
| Persistência | JSON por cliente e stores globais; autenticação WhatsApp em SQLite com WAL/transações e compatibilidade com sessão legada. |
| Configuração e entrega | npm/lockfile, TypeScript, Vite, Electron Builder, Docker, Render, exclusões de dados locais e testes existentes. |

O fluxo web é React → HTTP/SSE → servidor → proxy/worker do cliente → BotService → Baileys/OCR/stores. No desktop, React usa o preload/IPC para acessar o BotService. `dist/` é saída gerada: as correções foram feitas em `src/` e recompiladas, incluindo `dist/bot/dispatchQueue.js`.

## Problemas críticos e de alto impacto corrigidos

| Prioridade | Problema confirmado | Correção e evidência |
| --- | --- | --- |
| Crítico | Autenticação alternativa somente por senha podia selecionar uma conta diferente com a mesma senha. | Removido `x-panel-password`; login exige identidade e senha, seguido de token. Regressão HTTP verifica rejeição do caminho antigo. |
| Crítico | Tokens continuavam válidos após mudanças sensíveis; logout não invalidava o token no servidor. | Tokens vinculados à versão da conta e ao administrador que iniciou impersonação; revogação persistente no logout. Testados senha, bloqueio/desbloqueio, expiração inválida e reinícios. |
| Crítico | Senhas eram persistidas em texto simples. | Novas gravações usam scrypt com salt individual; leitura legada compatível. Fixture confirma hash e login após reinício. Arquivos reais e backups antigos não foram reescritos pela auditoria. |
| Crítico | Escritas diretas e recuperação de arquivo corrompido como base vazia podiam perder dados. | Escrita por arquivo temporário exclusivo, sincronização e substituição; stores críticos recusam sobrescrever JSON inválido. Testes verificam preservação do arquivo original. A atomicidade é por arquivo. |
| Crítico | Upload inválido podia substituir o romaneio válido antes da validação. | Planilha processada antes da substituição; teste confirma preservação do romaneio anterior. |
| Alto | Dependência SQLite não carregava no Node local; recompilação nativa exigia ferramentas ausentes. | Atualização compatível do runtime e módulos nativos; testes de SQLite no Node, Electron e pacote distribuído passaram. |
| Alto | Cancelamentos durante ACK, espera ou retry ainda podiam permitir relay posterior. | Revalidação do ciclo após operações assíncronas; testes comprovam que o envio seguinte não ocorre após cancelamento. |
| Alto | Requisição repetida ao coordenador substituía a promessa anterior, deixando chamador pendente. | Reutilização da mesma requisição por cliente/ciclo, confirmação idempotente e liberação em falha/timeout. |
| Alto | Promessa da segunda mensagem podia rejeitar antes de receber tratamento; falha síncrona podia prender a segunda faixa. | Promessas observadas imediatamente e liberação coordenada mesmo em falha. Testes cobrem ambos os cenários. |
| Alto | Parar um bot já desconectado deixava timers/ciclos ativos; falha de persistência podia impedir fechamento. | Cancelamento e limpeza também no estado desconectado; fechamento prossegue e informa erro de armazenamento. Testes incluem falha de gravação com encerramento de socket. |
| Alto | Eventos de worker antigo podiam afetar o substituto e recuperação podia reativar intenção antiga. | Eventos vinculados à instância correta; encerramento rejeita esperas e intenção de recuperação acompanha ações explícitas. |
| Alto | Lock recém-criado, ainda vazio, podia ser tomado por outro processo; reciclagem OCR deixava solicitações pendentes. | Lock recente preservado; solicitações associadas ao worker encerrado são rejeitadas e recuperadas de forma controlada. Testes usam processos simulados e locks temporários. |
| Alto | HTTP antigo podia sobrescrever SSE novo; reconexões/polling redundantes acumulavam trabalho. | Assinatura compartilhada com revisão de eventos, uma busca em andamento, cancelamento e limpeza no unsubscribe. Testes entregam respostas fora de ordem. |
| Alto | Estado do usuário anterior podia sobreviver a troca de sessão e rascunhos financeiros eram sobrescritos por atualizações. | Remontagem do painel por sessão, verificação de token em respostas/ações pendentes e preservação dos campos em edição. |

## Outras correções de comportamento

- Usuários criados/editados no painel permanecem após reinício; origem da configuração e versão de sessão passam a ser explícitas. Login atualiza corretamente seu contador e histórico.
- PATCH de usuário preserva propriedades omitidas; exclusão acidental do último administrador ativo por bloqueio/rebaixamento é recusada. E-mails duplicados e colisões de diretório são rejeitados.
- Renomeação aguarda o encerramento do worker, preserva metadados da conta e transfere histórico financeiro. Diretório de destino existente impede a operação antes de mover dados.
- Remover todos os líderes mantém a lista vazia; os padrões só são usados quando o arquivo ainda não existe.
- Totais manuais de cobrança incluem clientes sem análises no mês. Valores inválidos não viram zero silenciosamente no editor.
- Histórico de rotas tolera itens opcionais nulos sem descartar registros válidos. Gravações assíncronas do histórico OCR e logs são serializadas.
- Leitura de romaneio reconhece cabeçalho deslocado, inclusive início em C8. Limpeza realizada por outra instância invalida o cache correspondente.
- Cartão de mensagem usa os códigos presentes no campo visível; filtros de OCR podem permanecer vazios quando o modo automático permite isso.
- A interface deixou de apagar o histórico persistido ao exceder 80 itens visíveis. O alerta considera o log mais recente.
- IPC propaga erros de ações; funcionalidades de romaneio foram ligadas ao desktop. Assets usam caminho relativo para carregar via `file://`.
- Service worker limpa apenas caches do aplicativo e limita destino de notificação à mesma origem.

## Performance e causas de travamento

| Causa | Tratamento e limite da evidência |
| --- | --- |
| Agrupamento de planilha copiava arrays repetidamente e expandia grande lista em `Math.max`. | Agrupamento incremental e cálculo de máximo por iteração; teste com 150 mil linhas passou. Não equivale a benchmark completo de importação Excel. |
| Busca repetida por cabeçalhos percorria toda a planilha. | Busca inicial limitada às primeiras 250 linhas candidatas, mantendo os cenários de cabeçalho deslocado testados. |
| Polling sobreposto e subscriptions remontadas a cada mudança de estado. | Transporte compartilhado evita buscas simultâneas e limpa listeners, timers e requisições. |
| Persistência frequente de presença. | Escrita limitada a uma por 15 segundos por conta, mantendo presença em memória. |
| Consumidor SSE lento podia acumular buffers. | Limite de conexões por conta, heartbeat, revalidação de autorização e fechamento em backpressure. |
| Promessas, locks e workers antigos podiam deixar ações pendentes. | Identidade de worker, cancelamento de ciclo, observação imediata de rejeições e recuperação de locks corrigidos. |
| Notificações disparadas sem limite de concorrência/tempo. | Lotes de oito envios e timeout de dez segundos; assinaturas expiradas continuam sendo removidas. |

Não foram adicionados `useMemo`/`useCallback` indiscriminadamente. Não houve ensaio contínuo por dias, perfil de heap sob tráfego real ou medição de latência do WhatsApp.

## Validações, erros e segurança

- Corpos JSON limitados a 1 MiB e objetos válidos; recebimento de upload limitado a 12 MiB e 30 segundos. Falhas de formato/tamanho/tempo têm respostas HTTP específicas nos leitores compartilhados.
- Validação de e-mail, tamanho de senha/textos/listas, competência mensal e valores inteiros em centavos entre zero e 10.000.000, inclusive no servidor.
- Limites de tentativas de login por conta e endereço de conexão; formulário público de suporte também limitado. Não se confia automaticamente em `X-Forwarded-For`.
- SSE administrativo sem autenticação responde 401. Conexões abertas revalidam sessão e permissões durante sua vida útil.
- Push aceita HTTPS de provedores conhecidos, bloqueando destino arbitrário/local e host que apenas imita um provedor. Destinatários administrativos são escolhidos pelas permissões atuais.
- Caminhos estáticos normalizados, erro de stream tratado, URL analisada dentro do tratamento de erro e cabeçalhos básicos contra sniffing/enquadramento.
- Janela Electron bloqueia navegação externa e abertura de novas janelas. O launcher mantém os avisos de segurança do Electron.
- Removido dump de debug de desconexão do WhatsApp. Logs de falha de armazenamento informam o problema sem incluir o conteúdo dos arquivos.
- `.gitignore` e `.dockerignore` passaram a excluir mais credenciais, sessões, caches e dados de execução. Isso protege novos artefatos; não reescreve histórico Git nem remove backups existentes.

A aplicação usa token explícito no transporte web, não autenticação automática por cookie. O token continua armazenado no navegador e é enviado na URL do EventSource: sanitização de URLs em logs do proxy e uma eventual migração do transporte de sessão continuam relevantes. Não foi identificada necessidade de alterar o schema SQLite; os testes de migração da sessão legada, transações e reabertura passaram.

## Refatoração, tipagem e limpeza

Foram extraídos helpers para escrita JSON atômica, senha, leitura/validação HTTP, assinaturas de snapshots e rascunhos financeiros. Eles substituem lógica duplicada diretamente envolvida nos bugs. A API IPC recebeu os tipos dos métodos de romaneio.

Não foram introduzidos `@ts-ignore`, desativação de lint ou `any` como solução para falhas de compilação. A configuração existente `strict: false` foi mantida: há tipagem legada e componentes grandes que exigem trabalho específico para uma migração estrita. Não há ESLint nem script de lint configurado.

Nenhum arquivo existente do projeto foi removido. Imports e lógica tornados desnecessários nas áreas alteradas foram limpos. Componentes legados maiores não foram apagados sem uma substituição integral validada. Não houve reset, limpeza destrutiva, commit, push ou publicação.

## Dependências e compatibilidade

| Componente | Antes | Depois / motivo |
| --- | --- | --- |
| Node declarado e Docker | 20 | 24.x; alinhamento com runtime local e dependências nativas atualizadas. |
| better-sqlite3 | 11.10.0 | ^13.0.3; versão com Node-API e binário nativo validado nos dois runtimes. |
| sharp | ^0.35.2 | ^0.35.4; correções da biblioteca e árvore nativa. |
| xlsx | ^0.18.5 no npm | 0.20.3 pelo tarball oficial SheetJS; substituição da distribuição desatualizada. |
| Electron | ^31.7.7 | ^41.10.3; correções de segurança, revisão de mudanças incompatíveis e teste real do aplicativo. |
| Vite / plugin React | ^5.4.21 / ^4.3.4 | ^6.4.3 / ^4.7.0; correções e compatibilidade verificada pelo build. |
| Transitivas | Lockfile anterior | Atualizadas dentro das faixas permitidas; árvore instalada consistente e audit final sem alertas. |

As mudanças principais foram conferidas nas fontes dos mantenedores: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3/releases), [instalação SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), [aviso de segurança SheetJS](https://cdn.sheetjs.com/advisories/CVE-2024-22363), [sharp 0.35.4](https://github.com/lovell/sharp/releases/tag/v0.35.4), [breaking changes do Electron](https://www.electronjs.org/docs/latest/breaking-changes) e [migração Vite 6](https://v6.vite.dev/guide/migration).

`npmRebuild: false` evita recompilar desnecessariamente os módulos Node-API no empacotamento. A decisão foi validada executando SQLite e sharp dentro do Electron e novamente no pacote produzido; não serve como garantia para outra arquitetura/sistema operacional.

## Comandos e resultados

Executados dentro de `bot-whatsapp-cliente-main`:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Passou; `tsc --noEmit`. |
| `npm test` | Passou na execução final: 184/184, zero falhas; recompila o backend antes de executar os testes. |
| `npm run build` | Passou; TypeScript e Vite geraram backend/desktop/renderer. |
| `npm run test:desktop` | Passou; build e janela oculta com dados temporários, validação de main/preload/React/CSS/IPC/SQLite/sharp. |
| `npm run desktop:pack` | Passou após ajuste da reconstrução nativa; gerou `release/win-unpacked`. |
| `npm run desktop:build` | Passou; gerou `release/Bot WhatsApp-Setup-1.7.0.exe` e blockmap. |
| `node scripts/audit-packaged-runtime.cjs` | Passou; executa SQLite e sharp vindos do `app.asar`, usando o executável distribuído. |
| `npm audit --json` | Passou; zero alertas conhecidos. Resultado salvo em `.audit-artifacts/npm-audit-final.json`. |
| `npm ls --depth=0` | Árvore de dependências diretas consistente. |
| `git diff --check` | Passou; sem erros de whitespace no diff. |
| `npm run lint` | Não executado: não há script/configuração de lint. |

O smoke de desktop provoca intencionalmente uma chamada IPC com código nulo. O Electron registra a rejeição esperada antes do `PASS`; o teste exige essa rejeição para impedir que entradas inválidas sejam aceitas silenciosamente.

Diagnóstico inicial: o build compilava, mas os testes falhavam ao carregar o binding SQLite. `npm rebuild better-sqlite3` falhou por ausência de binário compatível/ferramentas Visual Studio. A primeira tentativa de empacotamento também tentou compilar código nativo e falhou. Esses casos foram resolvidos pela atualização e uso dos binários Node-API verificados. Não foram escondidos por alteração de expectativa de teste.

Avisos remanescentes do empacotador: campo `author` ausente, ícone padrão do Electron e referências transitivas duplicadas detectadas durante a coleta. A geração terminou com código zero; não foram inventados autor ou identidade visual. Avisos Git sobre futura conversão LF/CRLF refletem a configuração local.

Logs de validação ficam em `.audit-artifacts/`, ignorada no Git. Novos testes de regressão estão em `tests/audit-http-security.test.js`, `tests/audit-async-regressions.test.js`, `tests/audit-storage-reliability.test.js`, `tests/bot-dispatch-lifecycle.test.js` e nos casos acrescentados ao coordenador.

## Segunda revisão e limites restantes

A segunda passagem conferiu especialmente persistência após restart, invalidação após bloqueio/desbloqueio, cancelamento após `await`, reação a erro de disco no encerramento, assets via `file://`, módulos nativos empacotados, diff, dependências e limpeza das novas rotinas. Esses pontos receberam correções/testes adicionais quando necessário.

| Situação | Estado e próximo passo necessário |
| --- | --- |
| WhatsApp, OCR real e notificações externas | Integração real não executada. Requer homologação com conta/grupos de teste, corpus de imagens e dispositivos de push; os testes locais não enviam mensagens. |
| Docker/Render e outro computador | Dockerfile revisado, mas container Linux/deploy não executados. Instalador Windows gerado, sem instalar no computador do usuário ou em outra máquina. Homologar nos destinos antes de publicar. |
| Operações com vários arquivos | Gravação é atômica por arquivo. Renomear conta/diretório/cobrança e substituir os arquivos do romaneio não constitui transação única. Recuperação de interrupção entre etapas exigiria journal/transação com migração própria. |
| Referências históricas ao renomear conta | Metadados e cobrança são transferidos, mas suporte, assinaturas push e referências de outros clientes por e-mail não têm migração global. Revisar esses vínculos ao usar renomeação; unificação por ID estável exige uma migração mais ampla. |
| Planilhas muito grandes e armazenamento JSON | Limite de upload não limita totalmente a expansão de ZIP/XLSX; parsing e parte das gravações ainda são síncronos. Isolar importação e medir memória/latência com carga representativa é o próximo trabalho de escala. |
| Sessões no navegador e proxy | Token em armazenamento do navegador/URL SSE preserva compatibilidade. Revisar logs do proxy e transporte autenticado em um trabalho de hardening específico. Rate limit por endereço usa o peer TCP; proxy compartilhado pode agrupar clientes no mesmo limite. |
| Secrets e senhas legadas em disco | O código passa a gravar hashes, mas arquivos reais/backups antigos não foram inspecionados ou apagados. Proteção operacional e descarte seguro de backups dependem do ambiente. |
| Longa duração e falhas físicas | Não houve soak test por dias, queda de energia ou disco real cheio. Foram simuladas falhas e concorrência nos caminhos descritos; durabilidade absoluta não é garantida. |
| Tipagem/manutenção | `strict: false`, `any` legados e arquivos extensos continuam existentes. Migração incremental com testes evita uma reescrita arriscada nesta auditoria. |

## Aplicação da atualização

Use Node.js 24.x e o lockfile atualizado. A documentação de deploy foi ajustada. Tokens antigos exigirão novo login; com `PANEL_SESSION_SECRET` estável, as novas sessões preservam a persistência testada. Alterações no painel passam a prevalecer para contas marcadas como editadas/criadas nele.

O código, os testes, o build e o instalador estão disponíveis localmente. Nenhum deploy ou instalação no sistema foi realizado.
