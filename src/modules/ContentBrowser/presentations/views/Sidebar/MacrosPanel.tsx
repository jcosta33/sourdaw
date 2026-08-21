/**
 * MacrosPanel — sidebar panel listing saved macros.
 *
 * Deep-black metallic theme matching other sidebar panels.
 * Features: play, rename, delete macros + recording indicator.
 */

import { type ReactElement, useState, useRef, useEffect } from 'react';

import { Play, Trash2, Pencil, Circle, Square } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { macroStore } from '#/modules/Command/stores';
import { startMacroRecording, stopMacroRecording, executeAppAction } from '#/modules/Command/useCases';
import { cn } from '#/utils/Styles/cn';

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
            void executeAppAction({ type: 'renameMacro', payload: { macroId: editingId, name: editName.trim() } });
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
                    <Button
                        variant="bare"
                        size="bare"
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
                    </Button>
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
                        onChange={(event) => setNewMacroName(event.target.value)}
                    />
                </div>
            ) : null}
            {/* Macro list */}
            <div className="flex-1 overflow-y-auto">
                {state.macros.length === 0 && !state.recording ? (
                    <Row justify="center" className="h-full p-4">
                        <DawEmptyState
                            compact
                            title="No macros yet"
                            description="Click Record to capture a repeatable command sequence."
                            className="max-w-xs"
                        />
                    </Row>
                ) : (
                    <Stack gap={0.5} className="p-1">
                        {state.macros.map((macro: MacroView) => (
                            <Row
                                gap={1}
                                className="px-2 py-1 rounded hover:bg-white/5 group transition-colors"
                                key={macro.id}
                            >
                                {editingId === macro.id ? (
                                    <DawCompactInput
                                        ref={inputRef}
                                        size="micro"
                                        className="flex-1 border-0 bg-transparent px-0 text-[10px] text-foreground shadow-none focus-visible:ring-0"
                                        value={editName}
                                        onChange={(event) => setEditName(event.target.value)}
                                        onBlur={commitRename}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                commitRename();
                                            }
                                            if (event.key === 'Escape') {
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
                                    <Row
                                        align="stretch"
                                        gap={0.5}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-[var(--color-state-success)] hover:bg-[var(--color-state-success)]/10 transition-colors"
                                            onClick={() => {
                                                void executeAppAction({
                                                    type: 'playMacro',
                                                    payload: { macroId: macro.id },
                                                });
                                            }}
                                            aria-label={`Play macro ${macro.name}`}
                                            title="Play macro"
                                        >
                                            <Play className="size-2.5" />
                                        </Button>
                                        <Button
                                            variant="bare"
                                            size="bare"
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
                                        </Button>
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-destructive/70 hover:bg-destructive/5 transition-colors"
                                            onClick={() => {
                                                void executeAppAction({
                                                    type: 'deleteMacro',
                                                    payload: { macroId: macro.id },
                                                });
                                            }}
                                            aria-label={`Delete macro ${macro.name}`}
                                            title="Delete"
                                        >
                                            <Trash2 className="size-2.5" />
                                        </Button>
                                    </Row>
                                ) : null}
                            </Row>
                        ))}
                    </Stack>
                )}
            </div>
        </DawPanelSurface>
    );
};
