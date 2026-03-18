import { useState } from 'react';
import { AgentSkill } from '../lib/types';
import { parseSkill, isSkillFormat } from '../lib/skill-parser';
import { getBundledSkills } from '../lib/bundled-skills';

interface SkillsPanelProps {
  skills: AgentSkill[];
  onUpdate: (skills: AgentSkill[]) => void;
}

type ModalTab = 'bundled' | 'create' | 'import';

export default function SkillsPanel({ skills, onUpdate }: SkillsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<ModalTab>('bundled');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [viewingSkill, setViewingSkill] = useState<string | null>(null);

  const bundledSkills = getBundledSkills();
  const isBundled = (id: string) => id.startsWith('bundled:');
  const enabledBundledIds = new Set(skills.filter((s) => isBundled(s.id)).map((s) => s.id));
  const userSkills = skills.filter((s) => !isBundled(s.id));

  function openModal() {
    setModalOpen(true);
    setModalTab('bundled');
    setName('');
    setContent('');
    setImportText('');
    setImportError('');
  }

  function closeModal() {
    setModalOpen(false);
    setImportError('');
  }

  function addSkill() {
    if (!name.trim() || !content.trim()) return;
    const skill: AgentSkill = {
      id: crypto.randomUUID(),
      name: name.trim(),
      content: content.trim(),
    };
    onUpdate([...skills, skill]);
    setName('');
    setContent('');
  }

  function importSkill() {
    if (!importText.trim()) return;
    setImportError('');

    if (!isSkillFormat(importText)) {
      setImportError('Not a valid SKILL.md — must start with --- frontmatter');
      return;
    }

    try {
      const skill = parseSkill(importText);
      if (!skill.content && !skill.name) {
        setImportError('Could not parse skill content');
        return;
      }
      onUpdate([...skills, skill]);
      setImportText('');
      setImportError('');
    } catch {
      setImportError('Failed to parse SKILL.md');
    }
  }

  function removeSkill(id: string) {
    onUpdate(skills.filter((s) => s.id !== id));
    if (viewingSkill === id) setViewingSkill(null);
  }

  function toggleBundledSkill(bundled: AgentSkill) {
    const exists = skills.some((s) => s.id === bundled.id);
    if (exists) {
      onUpdate(skills.filter((s) => s.id !== bundled.id));
    } else {
      onUpdate([...skills, bundled]);
    }
  }

  const tabs: { key: ModalTab; label: string }[] = [
    { key: 'bundled', label: 'Bundled' },
    { key: 'create', label: 'Create' },
    { key: 'import', label: 'Import' },
  ];

  return (
    <>
      <div className="border-t border-slate-600">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-pixel text-slate-300 uppercase tracking-wider hover:text-gray-200 transition-colors"
        >
          <span>Skills ({skills.length})</span>
          <span className="text-[12px]">{expanded ? '▼' : '▶'}</span>
        </button>

        {expanded && (
          <div className="px-3 pb-2 space-y-1.5">
            {skills.length === 0 && (
              <p className="text-[12px] font-pixel text-slate-400 text-center py-1">
                No skills enabled
              </p>
            )}

            {/* Active skills list */}
            {skills.map((skill) => (
              <div key={skill.id}>
                <div className="flex items-center gap-1.5 group">
                  <button
                    onClick={() => setViewingSkill(viewingSkill === skill.id ? null : skill.id)}
                    className={`text-[12px] font-pixel truncate flex-1 text-left hover:text-indigo-300 transition-colors ${isBundled(skill.id) ? 'text-teal-400' : 'text-indigo-400'}`}
                    title={skill.description || skill.name}
                  >
                    {skill.name}
                  </button>
                  <button
                    onClick={() => removeSkill(skill.id)}
                    className="text-[12px] font-pixel text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={isBundled(skill.id) ? 'Disable' : 'Remove'}
                  >
                    ✕
                  </button>
                </div>
                {viewingSkill === skill.id && (
                  <div className="mt-1 mb-1.5 p-1.5 bg-slate-800/60 rounded border border-slate-600">
                    {skill.description && (
                      <p className="text-[11px] font-pixel text-slate-300 mb-1">{skill.description}</p>
                    )}
                    {skill.metadata?.requires?.bins && (
                      <p className="text-[11px] font-pixel text-yellow-600">
                        Requires: {skill.metadata.requires.bins.join(', ')}
                      </p>
                    )}
                    {skill.metadata?.requires?.anyBins && (
                      <p className="text-[11px] font-pixel text-yellow-600">
                        Requires one of: {skill.metadata.requires.anyBins.join(', ')}
                      </p>
                    )}
                    <pre className="text-[11px] font-pixel text-slate-400 mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap">
                      {skill.content.slice(0, 500)}{skill.content.length > 500 ? '…' : ''}
                    </pre>
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={openModal}
              className="btn-pixel bg-slate-700 hover:bg-gray-600 w-full text-[12px]"
            >
              + Manage Skills
            </button>
          </div>
        )}
      </div>

      {/* Skills Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={closeModal}>
          <div
            className="bg-slate-900 border border-slate-600 rounded-lg w-[480px] max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-700">
              <h2 className="text-sm font-pixel text-white">Skills</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-700">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setModalTab(tab.key); setImportError(''); }}
                  className={`flex-1 px-4 py-2.5 text-[12px] font-pixel transition-colors ${
                    modalTab === tab.key
                      ? 'text-teal-400 border-b-2 border-teal-400 bg-slate-800/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/20'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* Bundled tab */}
              {modalTab === 'bundled' && (
                <div className="space-y-2">
                  <p className="text-[12px] font-pixel text-slate-400 mb-3">
                    Toggle bundled skills on/off. Enabled skills are injected into all agent prompts.
                  </p>
                  <div className="space-y-1">
                    {bundledSkills.map((bs) => {
                      const enabled = enabledBundledIds.has(bs.id);
                      return (
                        <button
                          key={bs.id}
                          onClick={() => toggleBundledSkill(bs)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-left transition-colors ${
                            enabled
                              ? 'bg-teal-900/40 hover:bg-teal-900/60 border border-teal-800/50'
                              : 'bg-slate-800/30 hover:bg-slate-800/60 border border-slate-700/50'
                          }`}
                        >
                          <span className="text-[14px] w-5 text-center">{enabled ? '✅' : '⬜'}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[13px] font-pixel text-slate-200 block truncate">
                              {bs.name}
                            </span>
                            {bs.description && (
                              <span className="text-[11px] font-pixel text-slate-500 block truncate">
                                {bs.description}
                              </span>
                            )}
                          </div>
                          {bs.metadata?.requires?.bins && (
                            <span className="text-[10px] font-pixel text-yellow-600 bg-yellow-900/20 px-1.5 py-0.5 rounded shrink-0">
                              {bs.metadata.requires.bins.join(', ')}
                            </span>
                          )}
                          {bs.metadata?.requires?.anyBins && (
                            <span className="text-[10px] font-pixel text-yellow-600 bg-yellow-900/20 px-1.5 py-0.5 rounded shrink-0">
                              {bs.metadata.requires.anyBins.join(' | ')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        const allEnabled = bundledSkills.every((bs) => enabledBundledIds.has(bs.id));
                        if (allEnabled) {
                          onUpdate(userSkills);
                        } else {
                          const newBundled = bundledSkills.filter((bs) => !enabledBundledIds.has(bs.id));
                          onUpdate([...skills, ...newBundled]);
                        }
                      }}
                      className="btn-pixel bg-teal-800 hover:bg-teal-700 text-[12px] flex-1"
                    >
                      {bundledSkills.every((bs) => enabledBundledIds.has(bs.id)) ? 'Disable All' : 'Enable All'}
                    </button>
                  </div>
                </div>
              )}

              {/* Create tab */}
              {modalTab === 'create' && (
                <div className="space-y-3">
                  <p className="text-[12px] font-pixel text-slate-400 mb-1">
                    Create a custom skill with markdown instructions.
                  </p>
                  <div>
                    <label className="text-[11px] font-pixel text-slate-300 block mb-1">Name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. code-reviewer"
                      className="input-mono text-[13px] w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-pixel text-slate-300 block mb-1">Content (markdown)</label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={"# My Skill\n\nInstructions for the agent..."}
                      rows={10}
                      className="input-mono text-[13px] resize-none w-full font-mono"
                    />
                  </div>
                  <button
                    onClick={addSkill}
                    disabled={!name.trim() || !content.trim()}
                    className="btn-pixel bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-[12px] w-full"
                  >
                    Add Skill
                  </button>
                  {/* User-created skills list */}
                  {userSkills.length > 0 && (
                    <div className="border-t border-slate-700 pt-3 mt-3">
                      <p className="text-[11px] font-pixel text-slate-400 mb-2">Custom skills</p>
                      <div className="space-y-1">
                        {userSkills.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 bg-slate-800/40 rounded border border-slate-700/50">
                            <span className="text-[12px] font-pixel text-indigo-400 flex-1 truncate">{s.name}</span>
                            <button
                              onClick={() => removeSkill(s.id)}
                              className="text-[12px] font-pixel text-red-500 hover:text-red-400"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Import tab */}
              {modalTab === 'import' && (
                <div className="space-y-3">
                  <p className="text-[12px] font-pixel text-slate-400 mb-1">
                    Paste a SKILL.md file with YAML frontmatter.
                  </p>
                  <textarea
                    value={importText}
                    onChange={(e) => { setImportText(e.target.value); setImportError(''); }}
                    placeholder={"---\nname: my-skill\ndescription: What this skill does\nmetadata:\n  {\n    \"emoji\": \"🔧\",\n    \"requires\": { \"bins\": [\"tool\"] }\n  }\n---\n\n# Skill instructions\n\nMarkdown content here..."}
                    rows={12}
                    className="input-mono text-[13px] resize-none w-full font-mono"
                  />
                  {importError && (
                    <p className="text-[12px] font-pixel text-red-400">{importError}</p>
                  )}
                  <button
                    onClick={importSkill}
                    disabled={!importText.trim()}
                    className="btn-pixel bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-[12px] w-full"
                  >
                    Import
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
