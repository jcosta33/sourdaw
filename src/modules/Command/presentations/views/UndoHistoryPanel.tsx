import { type ReactElement, useSyncExternalStore } from 'react';
import { undoStore, type UndoStoreState } from '../../stores/undoStore';
import { undoToIndex } from '../../useCases/undoRedo';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { cn } from '#/helpers/Styles/cn';
import { X, Undo2, Redo2 } from 'lucide-react';
import { Button } from '#/components/ui/button';

const defaultState: UndoStoreState = { past: [], future: [] };

export const UndoHistoryPanel = (): ReactElement | null => {
    const wsOpen = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.undoHistoryOpen ?? false
    );

    const state = useSyncExternalStore(
        (cb) => undoStore.subscribe(() => cb()),
        () => undoStore.value ?? defaultState,
        () => undoStore.value ?? defaultState
    );

    if (!wsOpen) {
        return null;
    }

    const close = () => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, undoHistoryOpen: false });
        }
    };

    const handleClick = (index: number) => {
        void undoToIndex(index);
    };

    const pastCount = state.past.length;

    return (
        <div className="absolute right-2 top-10 z-40 flex w-56 flex-col rounded-lg border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
                <h3 className="text-xs font-medium text-foreground">Undo History</h3>
                <Button variant="ghost" size="icon-xs" onClick={close} aria-label="Close undo history">
                    <X className="size-3" />
                </Button>
            </div>

            <div className="max-h-72 overflow-y-auto">
                {state.past.length === 0 && state.future.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">No history yet</div>
                )}

                {state.future.length > 0 && (
                    <div className="border-b border-border/30 pb-1 pt-1">
                        <div className="px-3 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">
                            <Redo2 className="mr-1 inline size-2.5" />
                            Redo
                        </div>
                        {[...state.future].reverse().map((entry, i) => {
                            const futureIndex = pastCount + (state.future.length - 1 - i);
                            return (
                                <button
                                    type="button"
                                    key={entry.id}
                                    className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-muted-foreground/50 hover:bg-accent/50 hover:text-muted-foreground"
                                    onClick={() => handleClick(futureIndex)}
                                >
                                    <span className="truncate">{entry.label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="px-3 py-1">
                    <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-emerald-500/80">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Current State
                    </div>
                </div>

                {state.past.length > 0 && (
                    <div className="pt-0.5 pb-1">
                        <div className="px-3 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">
                            <Undo2 className="mr-1 inline size-2.5" />
                            Undo
                        </div>
                        {[...state.past].reverse().map((entry, i) => {
                            const entryIndex = pastCount - 1 - i;
                            return (
                                <button
                                    type="button"
                                    key={entry.id}
                                    className={cn(
                                        'flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent',
                                        i === 0 ? 'text-foreground font-medium' : 'text-muted-foreground'
                                    )}
                                    onClick={() => handleClick(entryIndex)}
                                >
                                    <span className="truncate">{entry.label}</span>
                                    {entry.source !== 'manual' && (
                                        <span className="ml-auto shrink-0 rounded bg-muted/40 px-1 text-[8px] text-muted-foreground">
                                            {entry.source}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
