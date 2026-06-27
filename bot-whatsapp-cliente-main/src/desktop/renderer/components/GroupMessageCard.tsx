import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BotConfig, BotGroup } from "../../../shared/types";

type Props = {
  kind: "target" | "test";
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
    startAfterSave?: boolean
  ) => void;
  onSaveManual?: (
    group: string,
    groupId: string | undefined,
    groupName: string | undefined,
    senderName: string,
    codes: string[]
  ) => void;
  onWarmup?: () => void;
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

function parseRoutes(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function GroupMessageCard({ kind, config, groups, busy, onRefresh, onSave, onSaveManual, onWarmup }: Props) {
  const [group, setGroup] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [senderName, setSenderName] = useState("");
  const [codes, setCodes] = useState("");
  const [manualCodes, setManualCodes] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [messageCount, setMessageCount] = useState(15);
  const [intervalMs, setIntervalMs] = useState(0);
  const requestedGroupsRef = useRef(false);

  const isTarget = kind === "target";
  const label = labels[kind];
  const savedGroupName = isTarget
    ? config.grupoAlvoNome || ""
    : config.grupoTesteNome || "";
  const savedCodes = useMemo(
    () => (isTarget ? config.rotasMonitoradas?.length ? config.rotasMonitoradas : config.codigosMensagensAlvo : config.codigosMensagensTeste) || [],
    [config.codigosMensagensAlvo, config.codigosMensagensTeste, config.rotasMonitoradas, isTarget]
  );
  const savedCodesKey = savedCodes.join("\n");

  useEffect(() => {
    setGroup(isTarget ? config.grupoAlvoNome || "" : config.grupoTesteNome || "");
    setSelectedGroupId(isTarget ? config.grupoAlvoJid || "" : config.grupoTesteJid || "");
    setSenderName(config.nomeEnvio);
    setCodes(savedCodesKey);
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
    savedCodesKey
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
    const nextCodes = isTarget ? parseRoutes(codes) : parseCodes(codes);

    if (!value || !senderName.trim() || !nextCodes.length) return;
    setCodes(nextCodes.join("\n"));
    onSave(value, chosenGroup?.id, chosenGroup?.name, senderName.trim(), nextCodes, messageCount, intervalMs, startAfterSave);
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

  const previewMessages = isTarget
    ? parseRoutes(codes).map((route) => `OCR: ${route}`)
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

        {isTarget ? (
          <div className="ocr-primary-copy">
            <strong>Principal: detectar gaiola pela foto</strong>
            <span>Cadastre o bairro. Quando o analista mandar a tabela, o bot encontra a linha do bairro e pega a gaiola atual.</span>
          </div>
        ) : null}

        <label htmlFor={`${kind}-codes`}>{isTarget ? "Bairros para detectar na foto" : "Códigos"}</label>
        <textarea
          id={`${kind}-codes`}
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
          onBlur={() => setCodes((isTarget ? parseRoutes(codes) : parseCodes(codes)).join("\n"))}
          placeholder={isTarget ? "Ex: Parque Guarus" : "Ex: P-12"}
          rows={isTarget ? 4 : 3}
        />

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

        <button className="button primary" disabled={busy || !group.trim() || !senderName.trim() || !codes.trim()} type="submit">
          {label.action}
        </button>
        {isTarget ? (
          <button className="button skull-button" disabled={busy || !group.trim() || !senderName.trim() || !codes.trim()} type="button" onClick={(event) => submit(event, true)}>
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
          <strong>{previewMessages.length} {isTarget ? "rota(s)" : "mensagem(ns)"}</strong>
          {previewMessages.slice(0, 3).map((message, index) => (
            <span key={`${message}-${index}`}>{message}</span>
          ))}
        </div>

        {isTarget ? (
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
