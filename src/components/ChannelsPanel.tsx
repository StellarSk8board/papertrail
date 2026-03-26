// ─── Channels Panel ─────────────────────────────────────────────
// UI for managing messaging channels (iMessage, Slack).
// Allows adding, connecting, disconnecting, and viewing message history.

import { useEffect, useState, useCallback, useRef } from "react";
import { ChannelConfig, ChannelMessage } from "../lib/types";

interface ChannelLiveStatus {
  id: string;
  type: string;
  name: string;
  status: "connected" | "disconnected" | "error";
  errorMessage: string | null;
}

function getAPI() {
  const w = window as unknown as { electronAPI?: Record<string, unknown> };
  return w.electronAPI ?? null;
}

function openFullDiskAccessSettings() {
  const api = getAPI();
  const exec = api?.exec as
    | ((cmd: string, cwd?: string, timeout?: number) => Promise<unknown>)
    | undefined;
  if (exec) {
    exec(
      'open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"',
    );
  }
}

function getDb() {
  const api = getAPI();
  return (api?.db ?? null) as {
    channelConfigSave: (config: Record<string, unknown>) => Promise<unknown>;
    channelConfigList: () => Promise<ChannelConfig[]>;
    channelConfigDelete: (id: string) => Promise<unknown>;
    channelMessageList: (
      channelId: string,
      limit: number,
    ) => Promise<ChannelMessage[]>;
    channelRegister: (config: Record<string, unknown>) => Promise<{ ok: boolean }>;
    channelConnect: (id: string) => Promise<{ ok: boolean; error?: string }>;
    channelDisconnect: (id: string) => Promise<{ ok: boolean; error?: string }>;
    channelSend: (
      channelId: string,
      conversationId: string,
      content: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    channelListLive: () => Promise<ChannelLiveStatus[]>;
    channelLoadAll: () => Promise<{ ok: boolean; count: number }>;
    onChannelInbound: (cb: (msg: ChannelMessage) => void) => () => void;
  } | null;
}

type View = "list" | "add-imessage" | "add-slack" | "messages";

export default function ChannelsPanel() {
  const [channels, setChannels] = useState<ChannelLiveStatus[]>([]);
  const [view, setView] = useState<View>("list");
  const [selectedChannel, setSelectedChannel] =
    useState<ChannelLiveStatus | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    const db = getDb();
    if (!db) return;
    try {
      await db.channelLoadAll();
      const live = await db.channelListLive();
      setChannels(live || []);
    } catch {
      // fallback to config list
      const api = getAPI();
      const dbInner = api?.db as { channelConfigList: () => Promise<ChannelConfig[]> };
      if (dbInner) {
        const configs = await dbInner.channelConfigList();
        setChannels(
          configs.map((c) => ({
            id: c.id,
            type: c.type,
            name: c.name,
            status: c.status || "disconnected",
            errorMessage: null,
          })),
        );
      }
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Listen for inbound messages to refresh when viewing
  useEffect(() => {
    const db = getDb();
    if (!db) return;
    const unsub = db.onChannelInbound(() => {
      if (selectedChannel) {
        db.channelMessageList(selectedChannel.id, 100).then(setMessages);
      }
    });
    return unsub;
  }, [selectedChannel]);

  const handleConnect = useCallback(
    async (id: string) => {
      const db = getDb();
      if (!db) return;
      setLoading(true);
      setError(null);
      try {
        const result = await db.channelConnect(id);
        if (!result.ok) setError(result.error || "Failed to connect");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to connect");
      }
      await loadChannels();
      setLoading(false);
    },
    [loadChannels],
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      const db = getDb();
      if (!db) return;
      setLoading(true);
      try {
        await db.channelDisconnect(id);
      } catch {
        /* ignore */
      }
      await loadChannels();
      setLoading(false);
    },
    [loadChannels],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const db = getDb();
      if (!db) return;
      try {
        await db.channelDisconnect(id).catch(() => {});
      } catch {
        /* ignore */
      }
      const api = getAPI();
      const dbRaw = api?.db as { channelConfigDelete: (id: string) => Promise<unknown> };
      if (dbRaw) await dbRaw.channelConfigDelete(id);
      await loadChannels();
      if (selectedChannel?.id === id) {
        setSelectedChannel(null);
        setView("list");
      }
    },
    [loadChannels, selectedChannel],
  );

  const handleViewMessages = useCallback(
    async (ch: ChannelLiveStatus) => {
      const db = getDb();
      if (!db) return;
      setSelectedChannel(ch);
      const msgs = await db.channelMessageList(ch.id, 100);
      setMessages(msgs || []);
      setView("messages");
    },
    [],
  );

  return (
    <div className="p-4 text-slate-200 flex flex-col gap-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        {view !== "list" && (
          <button
            onClick={() => {
              setView("list");
              setError(null);
            }}
            className="text-slate-400 hover:text-white text-xs mr-2"
          >
            &larr; Back
          </button>
        )}
        <h3 className="text-sm font-pixel text-white flex-1">
          {view === "list" && "Channels"}
          {view === "add-imessage" && "Add iMessage"}
          {view === "add-slack" && "Add Slack"}
          {view === "messages" && (selectedChannel?.name || "Messages")}
        </h3>
      </div>

      {error && (
        <div className="bg-red-900/60 border border-red-700/50 rounded px-3 py-2 text-xs text-red-200">
          <p>{error}</p>
          {(error.includes("Full Disk Access") ||
            error.includes("authorization denied")) && (
            <button
              onClick={() => openFullDiskAccessSettings()}
              className="btn-pixel text-[10px] bg-amber-700 hover:bg-amber-600 text-white mt-2 px-2 py-1"
            >
              Open System Settings
            </button>
          )}
        </div>
      )}

      {/* ── Channel List ──────────────────────────────────────────── */}
      {view === "list" && (
        <>
          {channels.length === 0 ? (
            <div className="text-center text-slate-500 text-xs py-8">
              No channels configured yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {channels.map((ch) => (
                <ChannelCard
                  key={ch.id}
                  channel={ch}
                  loading={loading}
                  onConnect={() => handleConnect(ch.id)}
                  onDisconnect={() => handleDisconnect(ch.id)}
                  onDelete={() => handleDelete(ch.id)}
                  onViewMessages={() => handleViewMessages(ch)}
                />
              ))}
            </div>
          )}

          <div className="border-t border-slate-700 pt-3 mt-auto">
            <p className="text-[10px] text-slate-500 font-pixel mb-2">
              Add Channel
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setView("add-imessage");
                  setError(null);
                }}
                className="flex-1 btn-pixel text-[10px] bg-blue-800 hover:bg-blue-700 text-blue-100 py-1.5"
              >
                iMessage
              </button>
              <button
                onClick={() => {
                  setView("add-slack");
                  setError(null);
                }}
                className="flex-1 btn-pixel text-[10px] bg-purple-800 hover:bg-purple-700 text-purple-100 py-1.5"
              >
                Slack
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Add iMessage ──────────────────────────────────────────── */}
      {view === "add-imessage" && (
        <AddImessageForm
          onAdded={() => {
            loadChannels();
            setView("list");
          }}
          onError={setError}
        />
      )}

      {/* ── Add Slack ─────────────────────────────────────────────── */}
      {view === "add-slack" && (
        <AddSlackForm
          onAdded={() => {
            loadChannels();
            setView("list");
          }}
          onError={setError}
        />
      )}

      {/* ── Message History ───────────────────────────────────────── */}
      {view === "messages" && selectedChannel && (
        <MessageHistory
          channel={selectedChannel}
          messages={messages}
        />
      )}
    </div>
  );
}

// ─── Channel Card ─────────────────────────────────────────────────

function ChannelCard({
  channel,
  loading,
  onConnect,
  onDisconnect,
  onDelete,
  onViewMessages,
}: {
  channel: ChannelLiveStatus;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
  onViewMessages: () => void;
}) {
  const typeLabel = channel.type === "imessage" ? "iMessage" : "Slack";
  const typeColor =
    channel.type === "imessage" ? "text-blue-400" : "text-purple-400";

  const statusDot =
    channel.status === "connected"
      ? "bg-green-400"
      : channel.status === "error"
        ? "bg-red-400"
        : "bg-slate-500";

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-2 h-2 rounded-full ${statusDot}`} />
        <span className="text-xs text-white font-medium flex-1 truncate">
          {channel.name}
        </span>
        <span className={`text-[10px] ${typeColor}`}>{typeLabel}</span>
      </div>

      {channel.errorMessage && (
        <p className="text-[10px] text-red-400 mb-1.5 truncate">
          {channel.errorMessage}
        </p>
      )}

      <div className="flex gap-1.5">
        {channel.status !== "connected" ? (
          <button
            onClick={onConnect}
            disabled={loading}
            className="btn-pixel text-[10px] bg-green-800 hover:bg-green-700 text-green-100 px-2 py-0.5 disabled:opacity-50"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={onDisconnect}
            disabled={loading}
            className="btn-pixel text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
        <button
          onClick={onViewMessages}
          className="btn-pixel text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5"
        >
          Messages
        </button>
        <button
          onClick={onDelete}
          className="btn-pixel text-[10px] bg-red-900/60 hover:bg-red-800 text-red-300 px-2 py-0.5 ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Add iMessage Form ────────────────────────────────────────────

function AddImessageForm({
  onAdded,
  onError,
}: {
  onAdded: () => void;
  onError: (err: string) => void;
}) {
  const [name, setName] = useState("iMessage");
  const [allowedSenders, setAllowedSenders] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    const db = getDb();
    if (!db) {
      onError("Not running in Electron");
      return;
    }

    setSaving(true);
    try {
      const id = `imessage-${Date.now()}`;
      const senders = allowedSenders
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const config = {
        id,
        type: "imessage",
        name: name.trim(),
        config: senders.length > 0 ? { allowedSenders: senders } : {},
      };
      await db.channelRegister(config);
      onAdded();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add channel");
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-slate-400">
        Reads incoming iMessages from the macOS Messages database and sends
        replies via AppleScript. macOS only. Requires Full Disk Access for the
        app.
      </p>

      <label className="text-[10px] text-slate-400 font-pixel">
        Channel Name
        <input
          className="input-mono w-full mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="iMessage"
        />
      </label>

      <label className="text-[10px] text-slate-400 font-pixel">
        Allowed Senders
        <input
          className="input-mono w-full mt-1"
          value={allowedSenders}
          onChange={(e) => setAllowedSenders(e.target.value)}
          placeholder="+15555550100, +15555550200"
        />
        <span className="text-[9px] text-slate-500 mt-0.5 block">
          Comma-separated phone numbers or emails. Leave empty to allow all.
        </span>
      </label>

      <button
        onClick={handleSubmit}
        disabled={saving || !name.trim()}
        className="btn-pixel text-[10px] bg-blue-700 hover:bg-blue-600 text-white py-1.5 disabled:opacity-50"
      >
        {saving ? "Adding..." : "Add iMessage Channel"}
      </button>
    </div>
  );
}

// ─── Add Slack Form ───────────────────────────────────────────────

function AddSlackForm({
  onAdded,
  onError,
}: {
  onAdded: () => void;
  onError: (err: string) => void;
}) {
  const [name, setName] = useState("Slack");
  const [botToken, setBotToken] = useState("");
  const [channelIds, setChannelIds] = useState("");
  const [appUserId, setAppUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !botToken.trim() || !channelIds.trim()) return;
    const db = getDb();
    if (!db) {
      onError("Not running in Electron");
      return;
    }

    setSaving(true);
    try {
      const id = `slack-${Date.now()}`;
      const ids = channelIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const config = {
        id,
        type: "slack",
        name: name.trim(),
        config: {
          botToken: botToken.trim(),
          channelIds: ids,
          appUserId: appUserId.trim() || undefined,
        },
      };
      await db.channelRegister(config);
      onAdded();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add channel");
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-slate-400">
        Polls Slack channels via the Web API and sends replies via
        chat.postMessage. Requires a bot token with channels:history and
        chat:write scopes.
      </p>

      <label className="text-[10px] text-slate-400 font-pixel">
        Channel Name
        <input
          className="input-mono w-full mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Slack"
        />
      </label>

      <label className="text-[10px] text-slate-400 font-pixel">
        Bot Token
        <input
          className="input-mono w-full mt-1"
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="xoxb-..."
        />
      </label>

      <label className="text-[10px] text-slate-400 font-pixel">
        Channel IDs (comma-separated)
        <input
          className="input-mono w-full mt-1"
          value={channelIds}
          onChange={(e) => setChannelIds(e.target.value)}
          placeholder="C01234567, C09876543"
        />
      </label>

      <label className="text-[10px] text-slate-400 font-pixel">
        Bot User ID (optional, auto-detected)
        <input
          className="input-mono w-full mt-1"
          value={appUserId}
          onChange={(e) => setAppUserId(e.target.value)}
          placeholder="U01234567"
        />
      </label>

      <button
        onClick={handleSubmit}
        disabled={saving || !name.trim() || !botToken.trim() || !channelIds.trim()}
        className="btn-pixel text-[10px] bg-purple-700 hover:bg-purple-600 text-white py-1.5 disabled:opacity-50"
      >
        {saving ? "Adding..." : "Add Slack Channel"}
      </button>
    </div>
  );
}

// ─── Message History ──────────────────────────────────────────────

function MessageHistory({
  channel,
  messages,
}: {
  channel: ChannelLiveStatus;
  messages: ChannelMessage[];
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`w-2 h-2 rounded-full ${channel.status === "connected" ? "bg-green-400" : "bg-slate-500"}`}
        />
        <span className="text-[10px] text-slate-400">
          {channel.status} &middot; {messages.length} messages
        </span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
        {messages.length === 0 ? (
          <div className="text-center text-slate-500 text-xs py-8">
            No messages yet.
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`rounded px-2.5 py-1.5 text-xs max-w-[85%] ${
                msg.direction === "inbound"
                  ? "bg-slate-700/60 self-start text-slate-200"
                  : "bg-indigo-800/60 self-end text-indigo-100"
              }`}
            >
              {msg.sender && msg.direction === "inbound" && (
                <div className="text-[10px] text-slate-400 mb-0.5">
                  {msg.sender}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">
                {msg.content}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5 text-right">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
