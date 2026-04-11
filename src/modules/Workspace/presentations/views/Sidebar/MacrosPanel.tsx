/**
 * MacrosPanel — sidebar panel listing saved macros.
 *
 * Deep-black metallic theme matching other sidebar panels.
 * Features: play, rename, delete macros + recording indicator.
 */

import { type ReactElement, useState, useRef, useEffect } from 'react';
import { useStore } from '#/infra/store/useStore';
import { Play, Trash2, Pencil, Circle, Square } from 'lucide-react';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { macroStore } from '#/modules/Command/stores';
import { startMacroRecording, stopMacroRecording, playMacro, deleteMacro, renameMacro } from '#/modules/Command/useCases';
import { cn } from '#/helpers/Styles/cn';

type MacroView = {
    id: string;
    name: string;
    actions: unknown[];
};

type MacroPanelState = {
    macros: MacroView[];
    recording: boolean;
    currentRecording: unknown[];
};

const defaultState: MacroPanelState = { macros: [], recording: false, currentRecording: [] };

export const MacrosPanel = (): ReactElement => {
    const state = useStore<MacroPanelState>(macroStore, defaultState);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [newMacroName, setNewMacroName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingId]);

    const commitRename = (): void => {
        if (editingId && editName.trim()) {
            renameMacro(editingId, editName.trim());
        }
        setEditingId(null);
    };

    const handleToggleRecording = (): void => {
        if (state.recording) {
            stopMacroRecording(newMacroName || `Macro ${state.macros.length + 1}`);
            setNewMacroName('');
        } else {
            startMacroRecording();
        }
    };

    return (
        <DawPanelSurface>
            {/* Header */}
            <DawHeaderBand
                className="px-3 py-1.5"
                title="Macros"
                titleClassName="text-[11px] font-semibold normal-case tracking-normal text-foreground"
                actions={
                    <button
                        type="button"
                        className={cn(
                            'flex h-5 items-center gap-1 rounded px-1.5 text-[9px] transition-colors',
                            state.recording
                                ? 'bg-[var(--color-state-danger)]/10 text-[var(--color-state-danger)] hover:bg-[var(--color-state-danger)]/20'
                                : 'text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground'
                        )}
                        onClick={handleToggleRecording}
                        aria-label={state.recording ? 'Stop macro recording' : 'Start macro recording'}
                    >
                        {state.recording ? (
                            <>
                                <Square className="size-2.5 fill-[var(--color-state-danger)]" />
                                <span>Stop ({state.currentRecording.length})</span>
                            </>
                        ) : (
                            <>
                                <Circle className="size-2.5" />
                                <span>Record</span>
                            </>
                        )}
                    </button>
                }
            />

            {/* Recording name input (shown while recording) */}
            {state.recording ? (
                <div className="px-3 py-1.5 border-b border-[var(--color-state-danger)]/20 bg-[var(--color-state-danger)]/5">
                    <DawCompactInput
                        size="micro"
                        className="border-0 bg-transparent px-0 text-[10px] text-foreground/80 shadow-none placeholder:text-muted-foreground/30 focus-visible:ring-0"
                        placeholder="Macro name..."
                        value={newMacroName}
                        onChange={(e) => setNewMacroName(e.target.value)}
                    />
                </div>
            ) : null}

            {/* Macro list */}
            <div className="flex-1 overflow-y-auto">
                {state.macros.length === 0 && !state.recording ? (
                    <div className="flex h-full items-center justify-center p-4">
                        <DawEmptyState
                            compact
                            title="No macros yet"
                            description="Click Record to capture a repeatable command sequence."
                            className="max-w-xs"
                        />
                    </div>
                ) : (
                    <div className="p-1 space-y-0.5">
                        {state.macros.map((macro: MacroView) => (
                            <div
                                key={macro.id}
                                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 group transition-colors"
                            >
                                {editingId === macro.id ? (
                                    <DawCompactInput
                                        ref={inputRef}
                                        size="micro"
                                        className="flex-1 border-0 bg-transparent px-0 text-[10px] text-foreground shadow-none focus-visible:ring-0"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={commitRename}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                commitRename();
                                            }
                                            if (e.key === 'Escape') {
                                                setEditingId(null);
                                            }
                                        }}
                                    />
                                ) : (
                                    <>
                                        <span className="flex-1 text-[10px] text-foreground/80 truncate">
                                            {macro.name}
                                        </span>
                                        <span className="text-[8px] text-muted-foreground/30 mr-1">
                                            {macro.actions.length} actions
                                        </span>
                                    </>
                                )}

                                {editingId !== macro.id ? (
                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            type="button"
                                            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-[var(--color-state-success)] hover:bg-[var(--color-state-success)]/10 transition-colors"
                                            onClick={() => playMacro(macro.id)}
                                            aria-label={`Play macro ${macro.name}`}
                                            title="Play macro"
                                        >
                                            <Play className="size-2.5" />
                                        </button>
                                        <button
                                            type="button"
                                            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground/70 hover:bg-white/5 transition-colors"
                                            onClick={() => {
                                                setEditingId(macro.id);
                                                setEditName(macro.name);
                                            }}
                                            aria-label={`Rename macro ${macro.name}`}
                                            title="Rename"
                                        >
                                            <Pencil className="size-2.5" />
                                        </button>
                                        <button
                                            type="button"
                                            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-destructive/70 hover:bg-destructive/5 transition-colors"
                                            onClick={() => deleteMacro(macro.id)}
                                            aria-label={`Delete macro ${macro.name}`}
                                            title="Delete"
                                        >
                                            <Trash2 className="size-2.5" />
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </DawPanelSurface>
    );
};
