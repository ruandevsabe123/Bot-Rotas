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

export function GroupMessageCard({ kind, config, groups, busy, onRefresh, onSave, onWarmup }: Props) {
  const [group, setGroup] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [senderName, setSenderName] = useState("");
  const [codes, setCodes] = useState("");
  const requestedGroupsRef = useRef(false);

  const isTarget = kind === "target";
  const label = labels[kind];
  const savedGroupName = isTarget
    ? config.grupoAlvoNome || ""
    : config.grupoTesteNome || "";
  const savedCodes = useMemo(
    () => (isTarget ? config.codigosMensagensAlvo : config.codigosMensagensTeste) || [],
    [config.codigosMensagensAlvo, config.codigosMensagensTeste, isTarget]
  );
  const savedCodesKey = savedCodes.join("\n");

  useEffect(() => {
    setGroup(isTarget ? config.grupoAlvoNome || "" : config.grupoTesteNome || "");
    setSelectedGroupId(isTarget ? config.grupoAlvoJid || "" : config.grupoTesteJid || "");
    setSenderName(config.nomeEnvio);
    setCodes(savedCodesKey);
  }, [
    config.grupoAlvoJid,
    config.grupoAlvoNome,
    config.grupoTesteJid,
    config.grupoTesteNome,
    config.nomeEnvio,
    isTarget,
    savedCodesKey
  ]);

  useEffect(() => {
    if (requestedGroupsRef.current || groups.length || busy) return;
    requestedGroupsRef.current = true;
    onRefresh();
  }, [busy, groups.length, onRefresh]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const foundByName = groups.find((item) => item.name.toLowerCase() === group.trim().toLowerCase());
    const chosenGroup = selectedGroup || foundByName;
    const value = chosenGroup ? chosenGroup.name : group.trim();
    const nextCodes = parseCodes(codes);

    if (!value || !senderName.trim() || !nextCodes.length) return;
    setCodes(nextCodes.join("\n"));
    onSave(value, chosenGroup?.id, chosenGroup?.name, senderName.trim(), nextCodes);
  }

  const previewMessages = parseCodes(codes)
    .map((code) => `${senderName.trim() || config.nomeEnvio} ${code.toUpperCase()}`.trim());
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

      <form className="group-form" onSubmit={submit}>
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

        <label htmlFor={`${kind}-sender-name`}>Nome na mensagem</label>
        <input
          id={`${kind}-sender-name`}
          value={senderName}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="Digite seu nome"
        />

        <label htmlFor={`${kind}-codes`}>Códigos</label>
        <textarea
          id={`${kind}-codes`}
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
          onBlur={() => setCodes(parseCodes(codes).join("\n"))}
          placeholder="Ex: P-12"
          rows={3}
        />

        <button className="button primary" disabled={busy || !group.trim() || !senderName.trim() || !codes.trim()} type="submit">
          {label.action}
        </button>
        {!isTarget && onWarmup ? (
          <button className="button secondary" disabled={busy || !savedGroupName} type="button" onClick={onWarmup}>
            Testar envio
          </button>
        ) : null}

        <div className="message-preview compact-preview">
          <strong>{previewMessages.length} mensagem(ns)</strong>
          {previewMessages.slice(0, 3).map((message, index) => (
            <span key={`${message}-${index}`}>{message}</span>
          ))}
        </div>
      </form>
    </article>
  );
}

