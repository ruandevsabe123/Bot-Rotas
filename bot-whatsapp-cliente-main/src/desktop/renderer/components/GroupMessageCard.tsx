import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { BotConfig, BotGroup, MonitoredRoute } from "../../../shared/types";
import { uiText } from "../uiText";
import { getNeighborhoodPreferences, moveNeighborhoodPreference as moveRoute, neighborhoodPreferenceLabel, normalizeNeighborhoodPreferences as normalizeMonitoredRoutes } from "../neighborhoodPreferences";

type Props = {
  kind: "target" | "test";
  targetMode?: "manual" | "ocr";
  config: BotConfig;
  groups: BotGroup[];
  busy: boolean;
  onRefresh: () => void;
  onSave: (
    group: string,
    groupId: string | undefined,
    groupName: string | undefined,
    senderName: string,
    codes: string[],
    messageCount?: number,
    intervalMs?: number,
    startAfterSave?: boolean,
    monitoredRoutes?: MonitoredRoute[],
    targetDispatchMode?: "manual" | "ocr"
  ) => void;
  onSaveManual?: (
    group: string,
    groupId: string | undefined,
    groupName: string | undefined,
    senderName: string,
    codes: string[]
  ) => void;
  onWarmup?: () => void;
  onSaveRoutePreset?: (name: string, routes: MonitoredRoute[]) => void;
  onDeleteRoutePreset?: (id: string) => void;
};

const labels = {
  target: {
    title: "Grupo alvo",
    action: "Salvar alvo",
    placeholder: "Pesquisar grupo alvo",
    empty: "Nenhum grupo alvo"
  },
  test: {
    title: "Teste de abrir e fechar",
    action: "Salvar teste",
    placeholder: "Pesquisar grupo de teste",
    empty: "Nenhum teste salvo"
  }
};

function formatMessageCode(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^([a-zA-Z])\s*-?\s*(\d+)$/);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function parseCodes(value: string) {
  return value
    .split(/\r?\n|,/)
    .map(formatMessageCode)
    .filter(Boolean);
}

function createEmptyRoute(): MonitoredRoute {
  return { cidade: "", bairro: "" };
}

export function GroupMessageCard({ kind, targetMode = "manual", config, groups, busy, onRefresh, onSave, onSaveManual, onWarmup, onSaveRoutePreset, onDeleteRoutePreset }: Props) {
  const [group, setGroup] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [senderName, setSenderName] = useState("");
  const [codes, setCodes] = useState("");
  const [monitoredRoutes, setMonitoredRoutes] = useState<MonitoredRoute[]>([createEmptyRoute()]);
  const [manualCodes, setManualCodes] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [messageCount, setMessageCount] = useState(15);
  const [intervalMs, setIntervalMs] = useState(0);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const requestedGroupsRef = useRef(false);

  const isTarget = kind === "target";
  const isImageTarget = isTarget && targetMode === "ocr";
  const label = labels[kind];
  const savedGroupName = isTarget
    ? config.grupoAlvoNome || ""
    : config.grupoTesteNome || "";
  const savedCodes = useMemo(
    () => (isImageTarget ? config.rotasMonitoradasDetalhadas?.length ? config.rotasMonitoradasDetalhadas.map((item) => item.bairro) : config.rotasMonitoradas || [] : isTarget ? config.codigosMensagensAlvo : config.codigosMensagensTeste) || [],
    [config.codigosMensagensAlvo, config.codigosMensagensTeste, config.rotasMonitoradas, config.rotasMonitoradasDetalhadas, isImageTarget, isTarget]
  );
  const savedCodesKey = savedCodes.join("\n");
  const savedPreferencesKey = JSON.stringify(getNeighborhoodPreferences(config));
  const nextPreferences = normalizeMonitoredRoutes(monitoredRoutes);
  const hasIncompletePreference = monitoredRoutes.some((route) => route.cidade.trim() && !route.bairro.trim());
  const hasMessageSettings = isImageTarget ? nextPreferences.length > 0 && !hasIncompletePreference : parseCodes(codes).length > 0;

  useEffect(() => {
    setGroup(isTarget ? config.grupoAlvoNome || "" : config.grupoTesteNome || "");
    setSelectedGroupId(isTarget ? config.grupoAlvoJid || "" : config.grupoTesteJid || "");
    setSenderName(config.nomeEnvio);
    setCodes(savedCodesKey);
    const savedPreferences = getNeighborhoodPreferences(config);
    setMonitoredRoutes(savedPreferences.length ? savedPreferences.map((route) => ({ ...route })) : [createEmptyRoute()]);
    setManualCodes((config.codigosMensagensAlvo || []).join("\n"));
    setMessageCount(config.testMessageCount || 15);
    setIntervalMs(config.testMessageIntervalMs || 0);
  }, [
    config.grupoAlvoJid,
    config.grupoAlvoNome,
    config.grupoTesteJid,
    config.grupoTesteNome,
    config.nomeEnvio,
    config.testMessageCount,
    config.testMessageIntervalMs,
    isTarget,
    savedCodesKey,
    savedPreferencesKey
  ]);

  useEffect(() => {
    if (requestedGroupsRef.current || groups.length || busy) return;
    requestedGroupsRef.current = true;
    onRefresh();
  }, [busy, groups.length, onRefresh]);

  function submit(event: Pick<FormEvent, "preventDefault">, startAfterSave = false) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const foundByName = groups.find((item) => item.name.toLowerCase() === group.trim().toLowerCase());
    const chosenGroup = selectedGroup || foundByName;
    const value = chosenGroup ? chosenGroup.name : group.trim();
    if (busy) return;
    const nextRoutes = isImageTarget ? normalizeMonitoredRoutes(monitoredRoutes) : [];
    const nextCodes = isImageTarget ? nextRoutes.map((item) => item.bairro) : parseCodes(codes);

    if (!value || !senderName.trim() || !nextCodes.length || (isImageTarget && hasIncompletePreference)) return;
    setCodes(nextCodes.join("\n"));
    onSave(value, chosenGroup?.id, chosenGroup?.name, senderName.trim(), nextCodes, messageCount, intervalMs, startAfterSave, nextRoutes, isImageTarget ? "ocr" : "manual");
  }

  function submitManual(event: Pick<FormEvent, "preventDefault">) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const foundByName = groups.find((item) => item.name.toLowerCase() === group.trim().toLowerCase());
    const chosenGroup = selectedGroup || foundByName;
    const value = chosenGroup ? chosenGroup.name : group.trim();
    const nextCodes = parseCodes(manualCodes);
    if (!value || !senderName.trim() || !nextCodes.length || !onSaveManual) return;
    setManualCodes(nextCodes.join("\n"));
    onSaveManual(value, chosenGroup?.id, chosenGroup?.name, senderName.trim(), nextCodes);
  }

  const previewMessages = isImageTarget
    ? nextPreferences.map((route, index) => `Preferência ${index + 1}: ${neighborhoodPreferenceLabel(route)}`)
    : parseCodes(codes).map((code) => `${senderName.trim() || config.nomeEnvio} ${code.toUpperCase()}`.trim());
  const query = group.trim().toLowerCase();
  const filteredGroups = groups
    .filter((item) => !query || item.name.toLowerCase().includes(query))
    .slice(0, 12);

  return (
    <article className={`panel group-message-card ${isTarget ? "group-message-target" : "group-message-test"}`}>
      <div className="compact-heading">
        <p className="panel-label">{label.title}</p>
        <strong>{savedGroupName || label.empty}</strong>
      </div>

      <form className="group-form" onSubmit={(event) => submit(event)}>
        <div className="form-heading-row">
          <label htmlFor={`${kind}-group-search`}>Grupo</label>
          <button className="link-button" disabled={busy} type="button" onClick={onRefresh}>
            Atualizar
          </button>
        </div>
        <input
          id={`${kind}-group-search`}
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setSelectedGroupId("");
          }}
          placeholder={label.placeholder}
        />
        {filteredGroups.length ? (
          <div className="group-search-list">
            {filteredGroups.map((item) => (
              <button
                key={item.id}
                className={selectedGroupId === item.id ? "selected" : ""}
                type="button"
                onClick={() => {
                  setGroup(item.name);
                  setSelectedGroupId(item.id);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="group-search-list group-search-empty">
            <span>{groups.length ? "Nenhum grupo encontrado com essa pesquisa." : "Conecte o WhatsApp e toque em Atualizar para carregar os grupos."}</span>
          </div>
        )}

        <label htmlFor={`${kind}-sender-name`}>Nome fixo na mensagem</label>
        <input
          id={`${kind}-sender-name`}
          value={senderName}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="Digite seu nome"
        />

        {isImageTarget ? (
          <div className="ocr-primary-copy">
            <strong>Bairros por ordem de preferência</strong>
            <span>O bot procura seus bairros na imagem e prepara uma única mensagem para a gaiola da primeira preferência disponível com leitura segura.</span>
          </div>
        ) : null}

        {isImageTarget ? (
          <section className="ocr-route-fields">
            <div className="settings-grid compact-settings">
              <label>
                Nome da configuração
                <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Ex: Rotas da manhã" />
              </label>
              <button
                className="button secondary"
                disabled={busy || !presetName.trim() || !nextPreferences.length || hasIncompletePreference || !onSaveRoutePreset}
                type="button"
                onClick={() => onSaveRoutePreset?.(presetName.trim(), normalizeMonitoredRoutes(monitoredRoutes))}
              >
                Salvar configuração
              </button>
              <label>
                Carregar configuração
                <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
                  <option value="">Escolha uma configuração</option>
                  {(config.routePresets || []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
              <div className="ocr-route-actions">
                <button
                  className="button secondary"
                  disabled={busy || !selectedPresetId}
                  type="button"
                  onClick={() => {
                    const preset = (config.routePresets || []).find((item) => item.id === selectedPresetId);
                    if (preset) {
                      setMonitoredRoutes(preset.routes.map((route) => ({ ...route })));
                      setPresetName(preset.name);
                    }
                  }}
                >
                  Carregar
                </button>
                <button className="button danger" disabled={busy || !selectedPresetId || !onDeleteRoutePreset} type="button" onClick={() => onDeleteRoutePreset?.(selectedPresetId)}>
                  Excluir salva
                </button>
              </div>
            </div>
            <div className="ocr-route-heading">
              <span>Preferência</span>
              <span>Bairro e cidade</span>
            </div>
            {monitoredRoutes.map((route, index) => (
              <div className="ocr-route-row" key={`ocr-route-${index}`}>
                <span className="ocr-route-index">{index + 1}ª opção</span>
                <div className="ocr-neighborhood-inputs">
                <input
                  aria-label={`Bairro da preferência ${index + 1}`}
                  maxLength={200}
                  disabled={busy}
                  value={route.bairro}
                  onChange={(event) => {
                    const nextRoutes = [...monitoredRoutes];
                    nextRoutes[index] = { ...route, bairro: event.target.value };
                    setMonitoredRoutes(nextRoutes);
                  }}
                  placeholder="Bairro: Parque Penha"
                />
                <input
                  aria-label={`Cidade da preferência ${index + 1} (opcional)`}
                  value={route.cidade}
                  maxLength={200}
                  disabled={busy}
                  onChange={(event) => {
                    const nextRoutes = [...monitoredRoutes];
                    nextRoutes[index] = { ...route, cidade: event.target.value };
                    setMonitoredRoutes(nextRoutes);
                  }}
                  placeholder="Cidade (opcional)"
                />
                </div>
                {monitoredRoutes.length > 1 ? (
                  <div className="ocr-route-rank-actions">
                    <button className="icon-button" disabled={busy || index === 0} title="Aumentar preferência" type="button" onClick={() => setMonitoredRoutes(moveRoute(monitoredRoutes, index, index - 1))}>
                      <ArrowUp size={16} />
                    </button>
                    <button className="icon-button" disabled={busy || index === monitoredRoutes.length - 1} title="Diminuir preferência" type="button" onClick={() => setMonitoredRoutes(moveRoute(monitoredRoutes, index, index + 1))}>
                      <ArrowDown size={16} />
                    </button>
                    <button className="icon-button" title="Remover bairro" disabled={busy} type="button" onClick={() => setMonitoredRoutes(monitoredRoutes.filter((_, itemIndex) => itemIndex !== index))}>
                      ×
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            <div className="ocr-route-actions">
              <button className="button secondary" disabled={busy} type="button" onClick={() => setMonitoredRoutes([...monitoredRoutes, createEmptyRoute()])}>
                Adicionar outro bairro
              </button>
              <small>{nextPreferences.length} bairro(s) configurado(s). Use as setas para ordenar suas preferências. A cidade ajuda a distinguir bairros com o mesmo nome; quando preenchida, ela também precisa ser identificada na imagem.</small>
              {hasIncompletePreference ? <small role="alert">Preencha o bairro da linha que contém somente a cidade.</small> : null}
            </div>
          </section>
        ) : (
          <>
            <label htmlFor={`${kind}-codes`}>Códigos</label>
            <textarea
              id={`${kind}-codes`}
              value={codes}
              onChange={(event) => setCodes(event.target.value)}
              onBlur={() => setCodes(parseCodes(codes).join("\n"))}
              placeholder="Ex: P-12"
              rows={3}
            />
          </>
        )}

        {!isTarget ? (
          <div className="test-settings-grid">
            <label htmlFor={`${kind}-count`}>
              Quantidade
              <input
                id={`${kind}-count`}
                min={1}
                max={200}
                type="number"
                value={messageCount}
                onChange={(event) => setMessageCount(Number(event.target.value || 1))}
              />
            </label>
            <label htmlFor={`${kind}-interval`}>
              Intervalo ms
              <input
                id={`${kind}-interval`}
                min={0}
                max={10000}
                step={50}
                type="number"
                value={intervalMs}
                onChange={(event) => setIntervalMs(Number(event.target.value || 0))}
              />
            </label>
          </div>
        ) : null}

        <button className="button primary" disabled={busy || !group.trim() || !senderName.trim() || !hasMessageSettings} type="submit">
          {label.action}
        </button>
        {isTarget ? (
          <button className="button skull-button" disabled={busy || !group.trim() || !senderName.trim() || !hasMessageSettings} type="button" onClick={(event) => submit(event, true)}>
            <span aria-hidden="true">☠</span>
            Salvar e iniciar
          </button>
        ) : null}
        {!isTarget && onWarmup ? (
          <button className="button secondary" disabled={busy || !savedGroupName} type="button" onClick={onWarmup}>
            Testar envio
          </button>
        ) : null}

        <div className="message-preview compact-preview">
          <strong>{previewMessages.length} {isImageTarget ? "preferência(s) de bairro" : "mensagem(ns)"}</strong>
          {previewMessages.slice(0, 3).map((message, index) => (
            <span key={`${message}-${index}`}>{uiText(message)}</span>
          ))}
        </div>

        {false && isTarget && !isImageTarget ? (
          <section className="manual-fallback-panel">
            <button className="link-button" type="button" onClick={() => setManualOpen((current) => !current)}>
              {manualOpen ? "Ocultar envio manual" : "Configurar envio manual avançado"}
            </button>
            {manualOpen ? (
              <div className="manual-fallback-body">
                <label htmlFor={`${kind}-manual-codes`}>Códigos manuais de reserva</label>
                <textarea
                  id={`${kind}-manual-codes`}
                  value={manualCodes}
                  onChange={(event) => setManualCodes(event.target.value)}
                  onBlur={() => setManualCodes(parseCodes(manualCodes).join("\n"))}
                  placeholder="Ex: F-14"
                  rows={3}
                />
                <button className="button secondary" disabled={busy || !group.trim() || !senderName.trim() || !manualCodes.trim()} type="button" onClick={submitManual}>
                  Salvar manual
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </form>
    </article>
  );
}
