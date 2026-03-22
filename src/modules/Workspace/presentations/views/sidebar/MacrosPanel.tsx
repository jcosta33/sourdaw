/**
 * MacrosPanel — sidebar panel listing saved macros.
 *
 * Deep-black metallic theme matching other sidebar panels.
 * Features: play, rename, delete macros + recording indicator.
 */

import {
    type ReactElement,
    useSyncExternalStore,
    useState,
    useRef,
    useEffect,
} from 'react';
import { Play, Trash2, Pencil, Circle, Square } from 'lucide-react';
import { macroStore, type MacroStoreState } from '#/modules/Command/stores/macroStore';
import {
    startMacroRecording,
    stopMacroRecording,
    playMacro,
    deleteMacro,
    renameMacro,
    type Macro,
} from '#/modules/Command/useCases/macroUseCases';
import { cn } from '#/helpers/Styles/cn';

const defaultState: MacroStoreState = { macros: [], recording: false, currentRecording: [] };

export const MacrosPanel = (): ReactElement => {
    const state = useSyncExternalStore(
        (cb) => macroStore.subscribe(cb),
        () => macroStore.value ?? defaultState
    );

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
        <div className="flex flex-col h-full bg-surface-base">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-surface-overlay/50">
                <span className="text-[11px] font-semibold text-foreground">Macros</span>
                <div className="flex-1" />
                <button
                    type="button"
                    className={cn(
                        'h-5 px-1.5 rounded flex items-center gap-1 text-[9px] transition-colors',
                        state.recording
                            ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20'
                            : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/5'
                    )}
                    onClick={handleToggleRecording}
                    aria-label={state.recording ? 'Stop macro recording' : 'Start macro recording'}
                >
                    {state.recording ? (
                        <>
                            <Square className="size-2.5 fill-red-400" />
                            <span>Stop ({state.currentRecording.length})</span>
                        </>
                    ) : (
                        <>
                            <Circle className="size-2.5" />
                            <span>Record</span>
                        </>
                    )}
                </button>
            </div>

            {/* Recording name input (shown while recording) */}
            {state.recording && (
                <div className="px-3 py-1.5 border-b border-red-500/20 bg-red-500/5">
                    <input
                        className="w-full bg-transparent text-[10px] text-foreground/80 outline-none placeholder:text-muted-foreground/30"
                        placeholder="Macro name..."
                        value={newMacroName}
                        onChange={(e) => setNewMacroName(e.target.value)}
                    />
                </div>
            )}

            {/* Macro list */}
            <div className="flex-1 overflow-y-auto">
                {state.macros.length === 0 && !state.recording ? (
                    <div className="flex items-center justify-center h-full">
                        <span className="text-[9px] text-muted-foreground/30">
                            No macros yet · Click Record to start
                        </span>
                    </div>
                ) : (
                    <div className="p-1 space-y-0.5">
                        {state.macros.map((macro: Macro) => (
                            <div
                                key={macro.id}
                                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 group transition-colors"
                            >
                                {editingId === macro.id ? (
                                    <input
                                        ref={inputRef}
                                        className="flex-1 bg-transparent text-[10px] text-foreground outline-none"
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

                                {editingId !== macro.id && (
                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            type="button"
                                            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-green-400 hover:bg-green-500/10 transition-colors"
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
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
