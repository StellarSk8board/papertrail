import { useState, useRef, useEffect } from 'react';
import { Agent, AgentSkill, AgentTodo, /* ApiKeys, */ Message, MODELS, ToolCall } from '../lib/types';
import { sendMessage } from '../lib/ai';
import { executeTask, generateTodoList, /* routeTasks, */ routeTasksViaClaudeCode } from '../lib/orchestrator';
import { createAgent } from '../lib/storage';
import { sendClaudeCodeInput, PermissionRequest } from '../lib/terminal';

interface ChatWindowProps {
  agent: Agent | null;
  agents: Agent[];
  apiKeys?: Record<string, string>; // API keys disabled — kept for interface compat
  skills: AgentSkill[];
  onUpdateAgent: (agent: Agent) => void;
  onAddAgent: (agent: Agent) => void;
}

const EMPTY_KEYS = { openai: '', anthropic: '', gemini: '', github: '' };

export default function ChatWindow({ agent, agents, skills, onUpdateAgent, onAddAgent }: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('outworked_debug') === '1');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const debugBottomRef = useRef<HTMLDivElement>(null);

  function addDebug(line: string) {
    const ts = new Date().toISOString().slice(11, 23);
    setDebugLog(prev => [...prev.slice(-500), `[${ts}] ${line}`]);
  }

  function toggleDebug() {
    const next = !debugMode;
    setDebugMode(next);
    localStorage.setItem('outworked_debug', next ? '1' : '0');
    if (next) setShowDebug(true);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent?.history, streamingText]);

  useEffect(() => {
    debugBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugLog]);

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
        <div className="text-4xl">🖥️</div>
        <p className="text-xs font-pixel text-slate-300">Click on an employee in the office to start chatting</p>
      </div>
    );
  }

  async function handleSend() {
    if (!input.trim() || isStreaming || !agent) return;
    const userText = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const userMsg: Message = { role: 'user', content: userText, timestamp: Date.now() };
    const updatedWithUser: Agent = {
      ...agent,
      history: [...agent.history, userMsg],
      status: 'thinking',
      currentThought: 'Thinking...',
    };
    onUpdateAgent(updatedWithUser);

    abortRef.current = new AbortController();

    const isBoss = !!agent.isBoss;
    if (debugMode) {
      setDebugLog([]);
      setShowDebug(true);
      addDebug(`--- New message to ${agent.name} (${isBoss ? 'boss' : 'agent'}) ---`);
      addDebug(`User: ${userText.slice(0, 200)}`);
    }

    try {
      let reply: string;

      if (isBoss) {
        // Boss = orchestrator. Route the user's message through the orchestrator pipeline.
        reply = await handleBossOrchestrate(updatedWithUser, userText);
      } else {
        // Regular agent: direct chat with tools
        reply = await handleRegularChat(updatedWithUser, userText);
      }

      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: Date.now() };
      onUpdateAgent({
        ...updatedWithUser,
        history: [...updatedWithUser.history, assistantMsg],
        status: 'idle',
        currentThought: reply.slice(0, 80) + (reply.length > 80 ? '...' : ''),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      if (errorMsg !== 'AbortError') {
        const errMsg: Message = { role: 'assistant', content: `⚠️ Error: ${errorMsg}`, timestamp: Date.now() };
        onUpdateAgent({
          ...updatedWithUser,
          history: [...updatedWithUser.history, errMsg],
          status: 'idle',
          currentThought: '',
        });
      } else {
        onUpdateAgent({ ...updatedWithUser, status: 'idle', currentThought: '' });
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }

    // ── Boss orchestrator flow ───────────────────────────────────
    async function handleBossOrchestrate(bossAgent: Agent, userText: string): Promise<string> {
      const employees = agents.filter(a => !a.isBoss);
      // const hasSubagents = employees.some(a => a.subagentDef);

      // Always use Claude Code Agent Teams (API-key-based classic routing disabled)
      return handleBossAgentTeams(bossAgent, userText, employees);

      /* === Classic orchestrator (commented out — requires API keys) ===
      if (!hasSubagents) {
        return handleBossClassic(bossAgent, userText);
      }
      */
    }

    // Boss flow using Claude Code Agent Teams
    async function handleBossAgentTeams(bossAgent: Agent, userText: string, employees: Agent[]): Promise<string> {
      onUpdateAgent({ ...bossAgent, status: 'thinking', currentThought: '🤖 Claude Code Agent Teams: orchestrating…' });
      setStreamingText('⚡ **Claude Code Agent Teams** — delegating work to subagent employees…\n\n');

      // Keep a live list so dynamically-created agents get reset to idle at the end
      const activeEmployees = [...employees];

      try {
        const result = await routeTasksViaClaudeCode(
          userText,
          employees,
          {
            onTeamEvent: (event) => {
              if (event.type === 'text' && event.text) {
                setStreamingText(prev => prev + event.text);
              }
              if (debugMode) addDebug(`[team] type=${event.type}${event.agentName ? ` agent=${event.agentName}` : ''}${event.text ? ` text=${event.text.slice(0, 120)}` : ''}`);
            },
            onAgentStatus: (agentName, status, thought) => {
              // Check both original employees and dynamically-created ones
              const emp = activeEmployees.find(a => a.name.toLowerCase() === agentName.toLowerCase());
              if (emp) {
                const mappedStatus = status === 'working' ? 'working'
                  : status === 'waiting-input' ? 'waiting-input'
                  : status === 'waiting-approval' ? 'waiting-approval'
                  : status === 'stuck' ? 'stuck'
                  : 'idle';
                onUpdateAgent({
                  ...emp,
                  status: mappedStatus,
                  currentThought: thought || '',
                });
              }
            },
            onNewAgent: (agentName, description) => {
              // Dynamically create a new employee in the UI
              const newAgent = createAgent({
                name: agentName,
                role: description || 'Specialist',
                personality: `You are ${agentName}, a specialist created to help with: ${description}`,
                position: {
                  x: Math.floor(Math.random() * 10) + 2,
                  y: Math.floor(Math.random() * 6) + 2,
                },
              }, true);
              activeEmployees.push(newAgent);
              onAddAgent(newAgent);
              onUpdateAgent({ ...newAgent, status: 'working', currentThought: `Just hired! Working on: ${description}` });
              setStreamingText(prev => prev + `\n\n👤 **New hire:** ${agentName} — ${description}\n`);
            },
            onPermissionRequest: (agentName, tool, description, reqId) => {
              // Surface as a team-level permission banner
              if (agentName) {
                const emp = activeEmployees.find(a => a.name.toLowerCase() === agentName.toLowerCase());
                if (emp) {
                  onUpdateAgent({ ...emp, status: 'waiting-approval', currentThought: `🔒 Needs approval: ${tool}` });
                }
              }
              setStreamingText(prev => prev + `\n🔒 **Permission needed${agentName ? ` (${agentName})` : ''}:** ${tool} — ${description}\n`);
              // Set pendingPermission so the approval UI appears and user can respond
              if (reqId != null) {
                setPendingPermission({ reqId, tool, description });
              }
            },
          },
          abortRef.current?.signal,
          debugMode ? (line: string) => addDebug(line) : undefined,
          bossAgent.sessionId,
        );

        // Save the session ID on the boss agent for conversation continuity
        if (result.sessionId) {
          bossAgent.sessionId = result.sessionId;
          onUpdateAgent({ ...bossAgent, sessionId: result.sessionId });
        }

        // Reset all employees (including dynamically-created ones) to idle
        for (const emp of activeEmployees) {
          onUpdateAgent({ ...emp, status: 'idle', currentThought: '' });
        }

        return result.text;
      } catch (err) {
        // Reset all employees to idle on error too
        for (const emp of activeEmployees) {
          onUpdateAgent({ ...emp, status: 'idle', currentThought: '' });
        }
        // Agent teams error — no fallback to classic orchestration (API keys disabled)
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        throw new Error(`Agent teams error: ${errMsg}`);
      }
    }

    /* === Classic Boss orchestrator flow (commented out — requires API keys) ===
    async function handleBossClassic(bossAgent: Agent, userText: string): Promise<string> {
      const routerModel = { model: agent!.model, provider: agent!.provider };

      // Step 1: Route through orchestrator
      onUpdateAgent({ ...bossAgent, status: 'thinking', currentThought: '🧠 Analyzing and planning...' });
      setStreamingText('🧠 Analyzing the request and planning task assignments...\n');

      const result = await routeTasks(
        userText,
        agents.filter(a => !a.isBoss),
        EMPTY_KEYS,
        routerModel,
      );

      // Step 2: Create any new agents
      const createdAgents: Agent[] = [];
      for (const spec of result.newAgents) {
        const exists = agents.find(a => a.name.toLowerCase() === spec.name.toLowerCase());
        if (exists) continue;
        const newAgent = createAgent({
          name: spec.name,
          role: spec.role,
          personality: spec.personality,
          model: routerModel.model,
          provider: routerModel.provider,
          position: {
            x: Math.floor(Math.random() * 10) + 2,
            y: Math.floor(Math.random() * 6) + 2,
          },
        });
        createdAgents.push(newAgent);
        onAddAgent(newAgent);
      }

      const allAgents = [...agents, ...createdAgents];

      // Step 3: Resolve assignments
      const resolvedAssignments = result.assignments.map(a => {
        if (a.agentId) return a;
        const match = allAgents.find(ag => ag.name.toLowerCase() === a.agentName.toLowerCase());
        return { ...a, agentId: match?.id ?? '' };
      });

      // Stream progress
      let progress = `📝 **Plan:** ${result.plan}\n📁 **Working directory:** ${result.workingDirectory}/\n`;
      if (createdAgents.length > 0) {
        progress += `👥 **New hires:** ${createdAgents.map(a => `${a.name} (${a.role})`).join(', ')}\n`;
      }
      progress += `\n**Assignments:**\n${resolvedAssignments.map(a => `- ${a.agentName}: ${a.task}`).join('\n')}\n`;

      if (resolvedAssignments.length === 0) {
        return await handleBossFallbackChat(bossAgent, userText);
      }

      setStreamingText(progress + '\n⏳ Executing tasks...\n');
      onUpdateAgent({ ...bossAgent, status: 'working', currentThought: `📋 ${resolvedAssignments.length} tasks in progress...` });

      const taskResults: { agentName: string; success: boolean; reply: string }[] = [];

      const taskPromises = resolvedAssignments.map(async (assignment) => {
        const targetAgent = allAgents.find(a => a.id === assignment.agentId);
        if (!targetAgent) {
          taskResults.push({ agentName: assignment.agentName, success: false, reply: 'Agent not found' });
          return;
        }

        onUpdateAgent({ ...targetAgent, status: 'working', currentThought: `Planning: ${assignment.task.slice(0, 60)}...` });

        try {
          const todos = await generateTodoList(targetAgent, assignment.task, EMPTY_KEYS, skills);
          const agentWithTodos: Agent = {
            ...targetAgent,
            todos: [...(targetAgent.todos ?? []), ...todos.map(t => ({ ...t, status: 'in-progress' as const }))],
          };
          onUpdateAgent({ ...agentWithTodos, status: 'working', currentThought: `Working: ${assignment.task.slice(0, 60)}...` });

          const { agent: updatedAgent, reply } = await executeTask(
            agentWithTodos, assignment.task, EMPTY_KEYS,
            (partial) => onUpdateAgent({ ...agentWithTodos, status: 'working', currentThought: partial.slice(0, 80) + (partial.length > 80 ? '...' : '') }),
            undefined, skills, result.workingDirectory,
          );

          const todoIds = new Set(todos.map(t => t.id));
          const finalAgent: Agent = {
            ...updatedAgent,
            todos: (updatedAgent.todos ?? []).map(t => todoIds.has(t.id) ? { ...t, status: 'done' as const } : t),
          };
          onUpdateAgent(finalAgent);
          taskResults.push({ agentName: assignment.agentName, success: true, reply });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          onUpdateAgent({ ...targetAgent, status: 'idle', currentThought: '' });
          taskResults.push({ agentName: assignment.agentName, success: false, reply: errMsg });
        }
      });

      await Promise.all(taskPromises);

      const summaryParts = [progress, '\n---\n\n**Results:**\n'];
      for (const tr of taskResults) {
        const icon = tr.success ? '✅' : '❌';
        summaryParts.push(`${icon} **${tr.agentName}:** ${tr.reply.slice(0, 400)}\n`);
      }

      setStreamingText(summaryParts.join(''));
      onUpdateAgent({ ...bossAgent, status: 'speaking', currentThought: 'Summarizing results...' });

      const summaryPrompt = `You just orchestrated the following work...`;
      const bossForSummary: Agent = { ...bossAgent, history: [] };
      const summary = await sendMessage(bossForSummary, summaryPrompt, EMPTY_KEYS, (partial) => setStreamingText(partial), abortRef.current?.signal, { useTools: false });

      return summary;
    }
    === end commented-out classic boss flow === */

    // Boss fallback: conversational response when there's nothing to orchestrate
    async function handleBossFallbackChat(bossAgent: Agent, userText: string): Promise<string> {
      const otherAgents = agents.filter(a => a.id !== agent!.id);
      const roster = otherAgents.map(a => `- ${a.name} (${a.role})`).join('\n');
      const extraSystemPrompt = `\n\n## Your Team\nCurrent employees:\n${roster}\n\nThe user's request doesn't seem to require delegating work. Respond conversationally.`;

      return await sendMessage(
        bossAgent,
        userText,
        EMPTY_KEYS,
        (partial) => {
          setStreamingText(partial);
          onUpdateAgent({ ...bossAgent, status: 'speaking', currentThought: partial.slice(0, 80) + (partial.length > 80 ? '...' : '') });
        },
        abortRef.current?.signal,
        { skills, extraSystemPrompt, useTools: false },
      );
    }

    // ── Regular agent chat flow ──────────────────────────────────
    async function handleRegularChat(agentState: Agent, userText: string): Promise<string> {
      return await sendMessage(
        agentState,
        userText,
        EMPTY_KEYS,
        (partial) => {
          setStreamingText(partial);
          onUpdateAgent({
            ...agentState,
            status: 'speaking',
            currentThought: partial.slice(0, 80) + (partial.length > 80 ? '...' : ''),
          });
        },
        abortRef.current!.signal,
        {
          skills,
          onToolCall: (call) => {
            // Handle todo updates directly
            if (call.name === 'update_todos') {
              const raw = call.args.todos as AgentTodo[];
              if (Array.isArray(raw)) {
                const todos: AgentTodo[] = raw.map((t: AgentTodo) => ({
                  id: String(t.id),
                  text: t.text,
                  status: t.status,
                  timestamp: Date.now(),
                }));
                onUpdateAgent({ ...agentState, todos, status: 'working', currentThought: `📋 Planning ${todos.length} tasks` });
              }
              return;
            }

            const toolLabel =
              call.name === 'run_command' ? `$ ${call.args.command}` :
              call.name === 'write_file' ? `Writing ${call.args.path}` :
              call.name === 'read_file' ? `Reading ${call.args.path}` :
              call.name === 'delete_file' ? `Deleting ${call.args.path}` :
              call.name === 'execute_code' ? 'Running code' :
              call.name === 'list_files' ? 'Listing files' :
              call.name;
            onUpdateAgent({
              ...agentState,
              status: 'working',
              currentThought: `🔧 ${toolLabel}`,
            });
            if (debugMode) addDebug(`[event] tool_call: ${call.name} ${JSON.stringify(call.args).slice(0, 200)}`);
          },
          // Claude Code stream events for subagent employees
          onClaudeCodeEvent: agentState.subagentDef ? (event) => {
            if (event.type === 'tool_use' && event.toolName) {
              onUpdateAgent({
                ...agentState,
                status: 'working',
                currentThought: `🔧 ${event.toolName}${event.toolInput?.file_path ? ` ${event.toolInput.file_path}` : ''}`,
              });
            }
          } : undefined,
          onPermissionRequest: (request) => {
            setPendingPermission(request);
          },
          onStderr: debugMode ? (text) => addDebug(`[stderr] ${text.trim()}`) : undefined,
        },
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handlePermissionResponse(allow: boolean) {
    if (!pendingPermission) return;
    const { reqId } = pendingPermission;
    setPendingPermission(null);
    // Send "yes" or "no" followed by newline to the Claude Code process stdin
    await sendClaudeCodeInput(reqId, allow ? 'yes\n' : 'no\n');
  }

  const model = MODELS.find((m) => m.id === agent.model);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-600 bg-slate-900">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: agent.color }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-pixel text-white truncate">{agent.name}</p>
          <p className="text-[11px] font-pixel truncate" style={{ color: agent.color }}>{agent.role}</p>
        </div>
        <span className="text-[11px] font-pixel text-slate-400 shrink-0">
          {agent.subagentFile ? '⚡ Claude Code' : model?.label ?? agent.model}
        </span>
        <button
          onClick={toggleDebug}
          className={`text-[9px] px-1.5 py-0.5 rounded font-pixel transition-colors ${
            debugMode ? 'bg-amber-700 text-amber-100' : 'bg-slate-800 text-slate-500 hover:text-slate-300'
          }`}
          title={debugMode ? 'Debug ON — click to disable' : 'Enable debug mode'}
        >
          🐛
        </button>
      </div>

      {/* Status — enhanced for waiting/stuck states */}
      {(agent.status === 'stuck' || agent.status === 'waiting-input' || agent.status === 'waiting-approval') && (
        <div className={`px-3 py-2 border-b border-slate-600 ${
          agent.status === 'stuck' ? 'bg-red-900/30 border-red-700/40' :
          agent.status === 'waiting-approval' ? 'bg-amber-900/30 border-amber-700/40' :
          'bg-orange-900/30 border-orange-700/40'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${agent.status === 'stuck' ? 'animate-pulse' : ''}`}>
              {agent.status === 'stuck' ? '⚠️' : agent.status === 'waiting-approval' ? '🔒' : '⏸️'}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-pixel ${
                agent.status === 'stuck' ? 'text-red-300' :
                agent.status === 'waiting-approval' ? 'text-amber-300' :
                'text-orange-300'
              }`}>
                {agent.status === 'stuck' ? 'Agent is stuck — no progress detected' :
                 agent.status === 'waiting-approval' ? 'Waiting for permission approval' :
                 'Waiting for more instructions'}
              </p>
              {agent.currentThought && (
                <p className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{agent.currentThought}</p>
              )}
            </div>
            {agent.status === 'stuck' && (
              <button
                onClick={() => {
                  setInput(`The previous task seems stuck. Please try a different approach or let me know what's blocking you.`);
                }}
                className="btn-pixel text-[9px] bg-red-700 hover:bg-red-600 text-white px-2 py-0.5 shrink-0"
              >
                Nudge
              </button>
            )}
            {agent.status === 'waiting-input' && (
              <button
                onClick={() => {
                  const textarea = document.querySelector('textarea');
                  textarea?.focus();
                }}
                className="btn-pixel text-[9px] bg-orange-700 hover:bg-orange-600 text-white px-2 py-0.5 shrink-0"
              >
                Reply
              </button>
            )}
          </div>
        </div>
      )}
      {agent.currentThought && agent.status !== 'stuck' && agent.status !== 'waiting-input' && agent.status !== 'waiting-approval' && (
        <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-600">
          <p className="text-[11px] font-mono text-yellow-400 truncate">💭 {agent.currentThought}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 font-mono overflow-y-auto px-3 py-2 space-y-2">
        {agent.isBoss && (
          <div className="text-center pt-4">
            <p className="text-[11px] font-pixel text-slate-400">Boss will assign tasks to the right agents. Just tell Boss what you need.</p>
            <p className="text-[11px] font-pixel text-slate-400">Boss can also hire new agents if needed.</p>
          </div>
        )}

        {agent.history.length === 0 && (
          <div className="text-center pt-4">
            <p className="text-[11px] font-pixel text-slate-400">Say hi to {agent.name}!</p>
          </div>
        )}

        {agent.history.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-2.5 py-1.5 rounded text-[12px] font-mono leading-7 whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-700 text-gray-100'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-2.5 py-1.5 rounded text-[12px] font-mono leading-7 bg-slate-700 text-gray-100 whitespace-pre-wrap break-words">
              {streamingText}
              <span className="inline-block w-1.5 h-3 bg-gray-400 ml-0.5 animate-pulse align-middle" />
            </div>
          </div>
        )}
        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="px-2.5 py-1.5 rounded bg-slate-700">
              <span className="text-[11px] font-mono text-slate-300 animate-pulse">thinking...</span>
            </div>
          </div>
        )}
        {pendingPermission && (
          <div className="mx-auto max-w-[90%] bg-amber-900/40 border border-amber-600/50 rounded-lg p-3 animate-slide-up">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-amber-400 text-sm">🔒</span>
              <span className="text-[11px] font-pixel text-amber-200">Permission Requested</span>
            </div>
            <p className="text-[11px] text-amber-100/80 font-mono mb-1">
              <span className="text-amber-300 font-bold">{pendingPermission.tool}</span>
            </p>
            <p className="text-[10px] text-amber-200/60 mb-2">{pendingPermission.description}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handlePermissionResponse(true)}
                className="btn-pixel text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-0.5"
              >
                ✓ Allow
              </button>
              <button
                onClick={() => handlePermissionResponse(false)}
                className="btn-pixel text-[10px] bg-red-700 hover:bg-red-600 text-white px-3 py-0.5"
              >
                ✕ Deny
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Debug log panel */}
      {debugMode && showDebug && debugLog.length > 0 && (
        <div className="border-t border-amber-800/50 bg-slate-950 max-h-40 overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1 bg-amber-900/30 border-b border-amber-800/40 sticky top-0">
            <span className="text-[9px] font-pixel text-amber-400">🐛 Debug Log ({debugLog.length})</span>
            <div className="flex gap-1">
              <button onClick={() => setDebugLog([])} className="text-[9px] text-slate-500 hover:text-amber-300 px-1">Clear</button>
              <button onClick={() => setShowDebug(false)} className="text-[9px] text-slate-500 hover:text-amber-300 px-1">Hide</button>
            </div>
          </div>
          <div className="px-2 py-1 space-y-0">
            {debugLog.map((line, i) => (
              <pre key={i} className={`text-[9px] font-mono leading-tight whitespace-pre-wrap break-all ${
                line.includes('[stderr]') ? 'text-red-400/80' :
                line.includes('[raw]') ? 'text-cyan-400/60' :
                line.includes('[team]') ? 'text-amber-400/70' :
                line.includes('[event]') ? 'text-purple-400/70' :
                'text-slate-500'
              }`}>{line}</pre>
            ))}
            <div ref={debugBottomRef} />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-slate-600 bg-slate-900">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agent.name}...`}
            disabled={isStreaming}
            rows={2}
            className="input-mono flex-1 bg-slate-800 border border-gray-600 rounded-md px-3 py-2 text-sm font-sans text-white placeholder-slate-400 resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-pixel rounded transition-colors"
            >
              stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-pixel rounded transition-colors"
            >
              send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
