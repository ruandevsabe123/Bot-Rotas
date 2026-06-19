import { FormEvent, useEffect, useMemo, useState } from "react";
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
    placeholder: "Ex: grupo das rotas",
    empty: "Nenhum grupo alvo"
  },
  test: {
    title: "Grupo teste",
    action: "Salvar teste",
    placeholder: "Ex: grupo teste",
    empty: "Nenhum grupo teste"
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

  const isTarget = kind === "target";
  const label = labels[kind];
  const savedGroupName = isTarget
    ? config.grupoAlvoNome || config.grupoAlvoJid
    : config.grupoTesteNome || config.grupoTesteJid;
  const savedCodes = useMemo(
    () => (isTarget ? config.codigosMensagensAlvo : config.codigosMensagensTeste) || [],
    [config.codigosMensagensAlvo, config.codigosMensagensTeste, isTarget]
  );
  const savedCodesKey = savedCodes.join("\n");

  useEffect(() => {
    setGroup(isTarget ? config.grupoAlvoJid || config.grupoAlvoNome || "" : config.grupoTesteJid || config.grupoTesteNome || "");
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

  function submit(event: FormEvent) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const value = selectedGroup ? selectedGroup.name : group.trim();
    const nextCodes = parseCodes(codes);

    if (!value || !senderName.trim() || !nextCodes.length) return;
    setCodes(nextCodes.join("\n"));
    onSave(value, selectedGroup?.id, selectedGroup?.name, senderName.trim(), nextCodes);
  }

  const previewMessages = parseCodes(codes)
    .map((code) => `${senderName.trim() || config.nomeEnvio} ${code.toUpperCase()}`.trim());

  return (
    <article className={`panel group-message-card ${isTarget ? "group-message-target" : "group-message-test"}`}>
      <div className="compact-heading">
        <p className="panel-label">{label.title}</p>
        <strong>{savedGroupName || label.empty}</strong>
      </div>

      <form className="group-form" onSubmit={submit}>
        <div className="form-heading-row">
          <label htmlFor={`${kind}-group-select`}>Grupo</label>
          <button className="link-button" disabled={busy} type="button" onClick={onRefresh}>
            Atualizar
          </button>
        </div>
        <select
          id={`${kind}-group-select`}
          value={selectedGroupId}
          onChange={(event) => {
            const id = event.target.value;
            const selectedGroup = groups.find((item) => item.id === id);
            setSelectedGroupId(id);
            setGroup(selectedGroup?.name || "");
          }}
        >
          <option value="">Escolha um grupo</option>
          {groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <input
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setSelectedGroupId("");
          }}
          placeholder={label.placeholder}
        />

        <label htmlFor={`${kind}-sender-name`}>Nome na mensagem</label>
        <input
          id={`${kind}-sender-name`}
          value={senderName}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="Ex: Alan da Silva Alves"
        />

        <label htmlFor={`${kind}-codes`}>Mensagem/códigos</label>
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
            Enviar 15 mensagens
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
