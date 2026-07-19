import { type ReactElement } from 'react';

import { X, Undo2, Redo2 } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawUtilityListRow } from '#/components/daw/DawUtilityListRow';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { closeUndoHistory } from '#/modules/WorkspaceShell/useCases';
import { cn } from '#/utils/Styles/cn';

import { undoStore, type UndoStoreState } from '../../stores/undoStore';
import { collectUndoHistoryUnits } from '../../useCases/collectUndoHistoryUnits';
import { undoToIndex } from '../../useCases/undoToIndex';

const defaultState: UndoStoreState = { past: [], future: [] };

export const UndoHistoryPanel = (): ReactElement | null => {
    const wsOpen = useStore(workspaceStore)?.undoHistoryOpen ?? false;

    const state = useStore(undoStore, defaultState);

    if (!wsOpen) {
        return null;
    }

    const close = closeUndoHistory;

    const handleClick = (unitId: string) => {
        void undoToIndex(unitId);
    };

    const pastUnits = collectUndoHistoryUnits(state.past);
    const futureUnits = collectUndoHistoryUnits(state.future);

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

                {futureUnits.length > 0 ? (
                    <div className="border-b border-border/30 pb-1 pt-1">
                        <DawEyebrowLabel className="block px-3 py-0.5">
                            <Redo2 className="mr-1 inline size-2.5" />
                            Redo
                        </DawEyebrowLabel>
                        {[...futureUnits].reverse().map((unit) => {
                            const entry = unit.entry;
                            return (
                                <DawUtilityListRow
                                    key={unit.id}
                                    title={entry.label}
                                    titleClassName="text-xs text-muted-foreground/50"
                                    onPress={() => handleClick(unit.id)}
                                />
                            );
                        })}
                    </div>
                ) : null}

                <div className="px-3 py-1">
                    <DawEyebrowLabel className="flex items-center gap-1 text-[var(--color-state-success)]/80">
                        <span className="size-1.5 rounded-full bg-[var(--color-state-success)]" />
                        Current State
                    </DawEyebrowLabel>
                </div>

                {pastUnits.length > 0 ? (
                    <div className="pt-0.5 pb-1">
                        <DawEyebrowLabel className="block px-3 py-0.5">
                            <Undo2 className="mr-1 inline size-2.5" />
                            Undo
                        </DawEyebrowLabel>
                        {[...pastUnits].reverse().map((unit, index) => {
                            const entry = unit.entry;
                            return (
                                <DawUtilityListRow
                                    key={unit.id}
                                    active={index === 0}
                                    title={entry.label}
                                    titleClassName={cn(
                                        'text-xs',
                                        index === 0 ? 'text-foreground' : 'text-muted-foreground'
                                    )}
                                    endSlot={
                                        entry.source !== 'manual' ? (
                                            <DawMicroBadge className="px-1" tone="muted">
                                                {entry.source}
                                            </DawMicroBadge>
                                        ) : null
                                    }
                                    onPress={() => handleClick(unit.id)}
                                />
                            );
                        })}
                    </div>
                ) : null}
            </div>
        </DawUtilityPanel>
    );
};
