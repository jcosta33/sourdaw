import { type ReactElement, useSyncExternalStore } from 'react';
import { undoStore, type UndoStoreState } from '../../stores/undoStore';
import { undoToIndex } from '../../useCases/undoRedo';
import { closeUndoHistory } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { cn } from '#/helpers/Styles/cn';
import { X, Undo2, Redo2 } from 'lucide-react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
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

    const close = closeUndoHistory;

    const handleClick = (index: number) => {
        void undoToIndex(index);
    };

    const pastCount = state.past.length;

    return (
        <DawUtilityPanel className="absolute right-2 top-10 z-40 w-56">
            <DawHeaderBand
                className="rounded-t-lg px-3 py-2"
                title="Undo History"
                titleClassName="text-xs font-medium normal-case tracking-normal text-foreground"
                actions={
                    <Button variant="ghost" size="icon-xs" onClick={close} aria-label="Close undo history">
                        <X className="size-3" />
                    </Button>
                }
            />

            <div className="max-h-72 overflow-y-auto">
                {state.past.length === 0 && state.future.length === 0 ? (
                    <div className="p-3">
                        <DawEmptyState
                            compact
                            title="No history yet"
                            description="Your edit timeline will appear here as you work."
                        />
                    </div>
                ) : null}

                {state.future.length > 0 ? (
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
                ) : null}

                <div className="px-3 py-1">
                    <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-[var(--color-state-success)]/80">
                        <span className="size-1.5 rounded-full bg-[var(--color-state-success)]" />
                        Current State
                    </div>
                </div>

                {state.past.length > 0 ? (
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
                                        <span className="ml-auto shrink-0 rounded bg-muted/40 px-1 text-[10px] text-muted-foreground">
                                            {entry.source}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ) : null}
            </div>
        </DawUtilityPanel>
    );
};
