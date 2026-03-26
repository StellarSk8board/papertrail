import { useState } from "react";
import { SubagentDef, McpServerInline } from "../lib/types";

// ─── Presets ──────────────────────────────────────────────────

const MCP_PRESETS: {
  name: string;
  command: string;
  args?: string[];
  description: string;
}[] = [
  {
    name: "github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    description: "GitHub repos, issues, PRs",
  },
  {
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    description: "File system access",
  },
  {
    name: "postgres",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    description: "PostgreSQL database",
  },
  {
    name: "slack",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-slack"],
    description: "Slack messages & channels",
  },
  {
    name: "linear",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-linear"],
    description: "Linear issues & projects",
  },
  {
    name: "playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    description: "Browser automation & testing",
  },
  {
    name: "memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    description: "Persistent key-value memory",
  },
  {
    name: "fetch",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-fetch"],
    description: "HTTP fetching",
  },
];

// ─── Helpers ──────────────────────────────────────────────────

type McpEntry = string | Record<string, McpServerInline>;

function getServerName(entry: McpEntry): string {
  if (typeof entry === "string") return entry;
  return Object.keys(entry)[0] || "";
}

function getServerConfig(entry: McpEntry): McpServerInline | null {
  if (typeof entry === "string") return null;
  const keys = Object.keys(entry);
  return keys.length > 0 ? entry[keys[0]] : null;
}

function getServerDisplayInfo(entry: McpEntry): {
  name: string;
  detail: string;
} {
  const name = getServerName(entry);
  const cfg = getServerConfig(entry);
  if (!cfg) return { name, detail: "" };
  if (cfg.url) return { name, detail: cfg.url };
  if (cfg.command) {
    const args = cfg.args ? " " + cfg.args.join(" ") : "";
    return { name, detail: `${cfg.command}${args}` };
  }
  return { name, detail: "" };
}

function isPreset(entry: McpEntry): boolean {
  const name = getServerName(entry);
  return MCP_PRESETS.some((p) => p.name === name);
}

function hasServer(
  servers: McpEntry[],
  name: string,
): boolean {
  return servers.some((e) => getServerName(e) === name);
}

// ─── Modal ────────────────────────────────────────────────────

interface McpServersModalProps {
  mcpServers: SubagentDef["mcpServers"];
  onUpdate: (servers: SubagentDef["mcpServers"]) => void;
  onClose: () => void;
}

export default function McpServersModal({
  mcpServers,
  onUpdate,
  onClose,
}: McpServersModalProps) {
  const servers = mcpServers || [];
  const [creating, setCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);

  const togglePreset = (preset: (typeof MCP_PRESETS)[number], enabled: boolean) => {
    if (enabled) {
      const entry: McpEntry = {
        [preset.name]: {
          type: "stdio",
          command: preset.command,
          args: preset.args,
        },
      };
      onUpdate([...servers, entry]);
    } else {
      onUpdate(servers.filter((e) => getServerName(e) !== preset.name));
    }
  };

  const removeServer = (name: string) => {
    onUpdate(servers.filter((e) => getServerName(e) !== name));
  };

  const addCustomServer = (data: {
    name: string;
    type: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
  }) => {
    const cfg: McpServerInline =
      data.type === "http"
        ? { type: "http", url: data.url }
        : { type: "stdio", command: data.command, args: data.args };
    onUpdate([...servers, { [data.name]: cfg }]);
    setCreating(false);
  };

  const updateCustomServer = (
    originalName: string,
    data: {
      name: string;
      type: "stdio" | "http";
      command?: string;
      args?: string[];
      url?: string;
    },
  ) => {
    const cfg: McpServerInline =
      data.type === "http"
        ? { type: "http", url: data.url }
        : { type: "stdio", command: data.command, args: data.args };
    onUpdate(
      servers.map((e) =>
        getServerName(e) === originalName ? { [data.name]: cfg } : e,
      ),
    );
    setEditingName(null);
  };

  const customServers = servers.filter((e) => !isPreset(e));

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-600 rounded-lg w-[420px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="text-xs font-pixel text-white">MCP Servers</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs font-pixel px-1"
          >
            X
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {creating ? (
            <McpServerForm
              existingNames={servers.map(getServerName)}
              onSave={addCustomServer}
              onCancel={() => setCreating(false)}
            />
          ) : editingName ? (
            (() => {
              const entry = servers.find(
                (e) => getServerName(e) === editingName,
              );
              if (!entry) return null;
              const info = getServerDisplayInfo(entry);
              const cfg = getServerConfig(entry);
              return (
                <McpServerForm
                  key={editingName}
                  existingNames={servers
                    .map(getServerName)
                    .filter((n) => n !== editingName)}
                  initial={{
                    name: info.name,
                    type: cfg?.type === "http" ? "http" : "stdio",
                    command: cfg?.command || "",
                    args: cfg?.args?.join(" ") || "",
                    url: cfg?.url || "",
                  }}
                  onSave={(data) => updateCustomServer(editingName, data)}
                  onCancel={() => setEditingName(null)}
                  onDelete={() => {
                    removeServer(editingName);
                    setEditingName(null);
                  }}
                />
              );
            })()
          ) : (
            <>
              {/* Preset servers */}
              <section className="space-y-1.5">
                <p className="text-[9px] font-pixel text-slate-500 uppercase tracking-wider">
                  Popular
                </p>
                {MCP_PRESETS.map((preset) => {
                  const enabled = hasServer(servers, preset.name);
                  return (
                    <div
                      key={preset.name}
                      className={`rounded border p-2.5 transition-colors ${
                        enabled
                          ? "border-purple-600/50 bg-purple-950/30"
                          : "border-slate-700/50 bg-slate-800/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) =>
                            togglePreset(preset, e.target.checked)
                          }
                          className="accent-purple-500 shrink-0"
                        />
                        <span className="text-[11px] font-pixel text-slate-200 flex-1 min-w-0 truncate">
                          {preset.name}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-500 mt-1 ml-6">
                        {preset.description}
                      </p>
                    </div>
                  );
                })}
              </section>

              {/* Custom servers */}
              <section className="space-y-1.5">
                <p className="text-[9px] font-pixel text-slate-500 uppercase tracking-wider">
                  Custom
                </p>

                {customServers.map((entry) => {
                  const info = getServerDisplayInfo(entry);
                  return (
                    <div
                      key={info.name}
                      className="group rounded border border-purple-600/50 bg-purple-950/30 p-2.5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-pixel text-slate-200 flex-1 min-w-0 truncate">
                          {info.name}
                        </span>
                        <button
                          onClick={() => {
                            setEditingName(info.name);
                            setCreating(false);
                          }}
                          className="text-[9px] font-pixel text-slate-600 group-hover:text-slate-400 hover:!text-purple-400 shrink-0 transition-colors"
                        >
                          edit
                        </button>
                        <button
                          onClick={() => removeServer(info.name)}
                          className="text-[9px] font-pixel text-slate-600 group-hover:text-slate-400 hover:!text-red-400 shrink-0 transition-colors"
                        >
                          remove
                        </button>
                      </div>
                      {info.detail && (
                        <p className="text-[9px] text-slate-500 mt-1 font-mono truncate">
                          {info.detail}
                        </p>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={() => {
                    setCreating(true);
                    setEditingName(null);
                  }}
                  className="w-full py-2.5 text-[10px] font-pixel text-slate-500 hover:text-purple-400 border border-dashed border-slate-700 hover:border-purple-600/50 rounded transition-colors"
                >
                  + Add Custom Server
                </button>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-700">
          <button
            onClick={onClose}
            className="w-full btn-pixel bg-purple-600 hover:bg-purple-500 text-[11px]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Server create/edit form ─────────────────────────────────

function McpServerForm({
  initial,
  existingNames,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: {
    name: string;
    type: "stdio" | "http";
    command: string;
    args: string;
    url: string;
  };
  existingNames: string[];
  onSave: (data: {
    name: string;
    type: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [serverType, setServerType] = useState<"stdio" | "http">(
    initial?.type || "stdio",
  );
  const [command, setCommand] = useState(initial?.command || "");
  const [args, setArgs] = useState(initial?.args || "");
  const [url, setUrl] = useState(initial?.url || "");
  const isNew = !initial;

  const nameConflict =
    name.trim() !== "" &&
    name.trim() !== initial?.name &&
    existingNames.includes(name.trim());

  const canSave =
    name.trim() &&
    !nameConflict &&
    (serverType === "http" ? url.trim() : command.trim());

  return (
    <div className="rounded border border-purple-600/50 bg-purple-950/20 p-3 space-y-2.5">
      <p className="text-[10px] font-pixel text-purple-300">
        {isNew ? "Add Server" : "Edit Server"}
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Server name (e.g. my-server)"
        className="input-mono"
      />
      {nameConflict && (
        <p className="text-[9px] text-red-400 font-pixel">
          Name already in use
        </p>
      )}

      {/* Type toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setServerType("stdio")}
          className={`text-[9px] font-pixel px-2 py-1 rounded border transition-colors ${
            serverType === "stdio"
              ? "border-purple-600 bg-purple-900/50 text-purple-300"
              : "border-slate-700 text-slate-500 hover:text-slate-300"
          }`}
        >
          Command (stdio)
        </button>
        <button
          onClick={() => setServerType("http")}
          className={`text-[9px] font-pixel px-2 py-1 rounded border transition-colors ${
            serverType === "http"
              ? "border-purple-600 bg-purple-900/50 text-purple-300"
              : "border-slate-700 text-slate-500 hover:text-slate-300"
          }`}
        >
          URL (http)
        </button>
      </div>

      {serverType === "stdio" ? (
        <>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Command (e.g. npx)"
            className="input-mono"
          />
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="Arguments (e.g. -y @modelcontextprotocol/server-github)"
            className="input-mono text-[10px]"
          />
        </>
      ) : (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8000/mcp"
          className="input-mono"
        />
      )}

      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <button
            onClick={() => {
              if (confirm("Remove this MCP server?")) onDelete();
            }}
            className="text-[10px] font-pixel text-red-400/70 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="text-[10px] font-pixel text-slate-400 hover:text-slate-200 px-3 py-1 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (!canSave) return;
            const trimmedName = name.trim();
            if (serverType === "http") {
              onSave({ name: trimmedName, type: "http", url: url.trim() });
            } else {
              const argList = args
                .trim()
                .split(/\s+/)
                .filter(Boolean);
              onSave({
                name: trimmedName,
                type: "stdio",
                command: command.trim(),
                args: argList.length > 0 ? argList : undefined,
              });
            }
          }}
          disabled={!canSave}
          className="btn-pixel bg-purple-600 hover:bg-purple-500 text-[10px] disabled:opacity-50"
        >
          {isNew ? "Add" : "Save"}
        </button>
      </div>
    </div>
  );
}
