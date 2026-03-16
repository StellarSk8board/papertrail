import { useState, useRef, useEffect } from 'react';
import { Agent, AgentSkill, /* ApiKeys, MODELS */ } from '../lib/types';
import { /* routeTasks, executeTask, generateTodoList, OrchestrationResult, TaskAssignment, */ routeTasksViaClaudeCode } from '../lib/orchestrator';
import { createAgent } from '../lib/storage';

export interface TaskStatus {
  assignment: { agentId: string; agentName: string; task: string };
  status: 'pending' | 'running' | 'done' | 'error';
  reply?: string;
  error?: string;
}

export interface InstructionRun {
  id: number;
  instruction: string;
  plan: string;
  tasks: TaskStatus[];
  done: boolean;
}

interface OfficeInstructionsProps {
  agents: Agent[];
  apiKeys?: Record<string, string>; // API keys disabled — kept for interface compat
  skills: AgentSkill[];
  onUpdateAgent: (agent: Agent) => void;
  onAddAgent: (agent: Agent) => void;
  runs: InstructionRun[];
  setRuns: React.Dispatch<React.SetStateAction<InstructionRun[]>>;
  routing: boolean;
  setRouting: React.Dispatch<React.SetStateAction<boolean>>;
}

let runId = 0;

export default function OfficeInstructions({ agents, skills, onUpdateAgent, onAddAgent, runs, setRuns, routing, setRouting }: OfficeInstructionsProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runs]);

  // API keys disabled — use Claude Code Agent Teams via the Boss chat instead
  // Pick the best available model for routing
  // function getRouterModel() {
  //   if (apiKeys.openai) return { model: 'gpt-5.4' as const, provider: 'openai' as const };
  //   if (apiKeys.anthropic) return { model: 'claude-sonnet-4-6' as const, provider: 'anthropic' as const };
  //   return { model: 'gpt-5-mini' as const, provider: 'openai' as const };
  // }

  async function handleSubmit() {
    if (!input.trim() || routing) return;
    const instruction = input.trim();
    setInput('');
    setRouting(true);

    const id = ++runId;
    const placeholder: InstructionRun = {
      id,
      instruction,
      plan: 'Delegating via Claude Code Agent Teams...',
      tasks: [],
      done: false,
    };
    setRuns((prev) => [...prev, placeholder]);

    try {
      const employees = agents.filter(a => !a.isBoss);
      const activeEmployees = [...employees];

      // Use Claude Code Agent Teams for orchestration (API-key-based routeTasks disabled)
      const result = await routeTasksViaClaudeCode(
        instruction,
        employees,
        {
          onTeamEvent: (event) => {
            if (event.type === 'text' && event.text) {
              setRuns((prev) =>
                prev.map((r) => (r.id === id ? { ...r, plan: (r.plan === 'Delegating via Claude Code Agent Teams...' ? '' : r.plan) + (event.text || '') } : r))
              );
            }
          },
          onAgentStatus: (agentName, status, thought) => {
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
            setRuns((prev) =>
              prev.map((r) => (r.id === id ? { ...r, plan: r.plan + `\n\n👤 New hire: ${agentName} — ${description}` } : r))
            );
          },
          onPermissionRequest: (agentName, tool, description) => {
            if (agentName) {
              const emp = activeEmployees.find(a => a.name.toLowerCase() === agentName.toLowerCase());
              if (emp) {
                onUpdateAgent({ ...emp, status: 'waiting-approval', currentThought: `🔒 Needs approval: ${tool}` });
              }
            }
            setRuns((prev) =>
              prev.map((r) => (r.id === id ? { ...r, plan: r.plan + `\n🔒 Permission needed${agentName ? ` (${agentName})` : ''}: ${tool}` } : r))
            );
          },
        },
      );

      const resultText = result.text;

      // Reset all employees (including dynamically-created ones) to idle
      for (const emp of activeEmployees) {
        onUpdateAgent({ ...emp, status: 'idle', currentThought: '' });
      }

      setRuns((prev) =>
        prev.map((r) => (r.id === id ? { ...r, plan: resultText || r.plan, done: true } : r))
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setRuns((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, plan: `Error: ${errMsg}`, done: true } : r
        )
      );
    } finally {
      setRouting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 bg-slate-900">
        <span className="text-[11px] font-pixel text-indigo-400">📋 Assign Tasks to All</span>
        <p className="text-[12px] font-mono text-slate-400 mt-0.5">
          Give a task — it gets auto-assigned to the right employees
        </p>
      </div>

      {/* Runs */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {runs.length === 0 && (
          <div className="text-center pt-4">
            <p className="text-[11px] font-pixel text-slate-400">
              &quot;Build a landing page&quot;, &quot;Design a new logo concept&quot;, &quot;Review the API architecture&quot;...
            </p>
          </div>
        )}

        {runs.map((run) => (
          <div key={run.id} className="border border-slate-700 rounded overflow-hidden">
            {/* Instruction */}
            <div className="px-2 py-1.5 bg-indigo-900/30 border-b border-slate-700">
              <p className="text-[11px] font-mono text-indigo-300">{run.instruction}</p>
            </div>

            {/* Plan */}
            <div className="px-2 py-1 bg-slate-900/50 border-b border-slate-700">
              <p className="text-[12px] font-mono text-slate-300">📝 {run.plan}</p>
            </div>

            {/* Tasks */}
            {run.tasks.map((task, i) => {
              const agent = agents.find((a) => a.id === task.assignment.agentId);
              return (
                <div key={i} className="px-2 py-1.5 border-b border-slate-700/50 last:border-none">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div
                      className={`w-2 h-2 rounded-full ${task.status === 'running' ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: agent?.color ?? '#666' }}
                    />
                    <span className="text-[12px] font-mono" style={{ color: agent?.color ?? '#888' }}>
                      {task.assignment.agentName}
                    </span>
                    <span className={`text-[12px] font-mono ml-auto ${
                      task.status === 'done' ? 'text-green-400' :
                      task.status === 'running' ? 'text-yellow-400' :
                      task.status === 'error' ? 'text-red-400' :
                      'text-slate-400'
                    }`}>
                      {task.status === 'done' ? '✓' : task.status === 'running' ? '⏳' : task.status === 'error' ? '✗' : '○'}
                    </span>
                  </div>
                  <p className="text-[12px] font-mono text-slate-300 mb-1">{task.assignment.task}</p>
                  {task.reply && (
                    <details className="text-[12px]">
                      <summary className="font-mono text-slate-400 cursor-pointer hover:text-slate-200">
                        View response
                      </summary>
                      <pre className="mt-1 text-[11px] text-slate-200 whitespace-pre-wrap break-words max-h-40 overflow-y-auto bg-slate-900 rounded p-1.5">
                        {task.reply}
                      </pre>
                    </details>
                  )}
                  {task.error && (
                    <p className="text-[12px] font-mono text-red-400">{task.error}</p>
                  )}
                </div>
              );
            })}

            {/* Done indicator */}
            {run.done && (
              <div className="px-2 py-1 bg-green-900/20 text-center">
                <span className="text-[12px] font-mono text-green-500">✓ All tasks complete</span>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-slate-700 bg-slate-900">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Give the office a task..."
            disabled={routing}
            rows={2}
            className="flex-1 input-mono bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm font-mono text-white placeholder-slate-400 resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={routing || !input.trim()}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-pixel rounded transition-colors"
          >
            {routing ? '...' : 'assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
