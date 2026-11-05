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

import { undoStepStore, type UndoStepStoreState } from '../../stores/undoStepStore';
import { moveHistoryToStep } from '../../useCases/moveHistoryToStep';

const defaultState: UndoStepStoreState = { pastSteps: [], futureSteps: [] };

export const UndoHistoryPanel = (): ReactElement | null => {
    const wsOpen = useStore(workspaceStore)?.undoHistoryOpen ?? false;

    const state = useStore(undoStepStore, defaultState);

    if (!wsOpen) {
        return null;
    }

    const close = closeUndoHistory;

    const handleClick = (targetEntryId: string) => {
        void moveHistoryToStep(targetEntryId);
    };

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
                {state.pastSteps.length === 0 && state.futureSteps.length === 0 ? (
                    <div className="p-3">
                        <DawEmptyState
                            compact
                            title="No history yet"
                            description="Your edit timeline will appear here as you work."
                        />
                    </div>
                ) : null}

                {state.futureSteps.length > 0 ? (
                    <div className="border-b border-border/30 pb-1 pt-1">
                        <DawEyebrowLabel className="block px-3 py-0.5">
                            <Redo2 className="mr-1 inline size-2.5" />
                            Redo
                        </DawEyebrowLabel>
                        {[...state.futureSteps].reverse().map((step) => (
                            <DawUtilityListRow
                                key={step.key}
                                title={step.label}
                                titleClassName="text-xs text-muted-foreground/50"
                                onPress={() => handleClick(step.targetEntryId)}
                            />
                        ))}
                    </div>
                ) : null}

                <div className="px-3 py-1">
                    <DawEyebrowLabel className="flex items-center gap-1 text-[var(--color-state-success)]/80">
                        <span className="size-1.5 rounded-full bg-[var(--color-state-success)]" />
                        Current State
                    </DawEyebrowLabel>
                </div>

                {state.pastSteps.length > 0 ? (
                    <div className="pt-0.5 pb-1">
                        <DawEyebrowLabel className="block px-3 py-0.5">
                            <Undo2 className="mr-1 inline size-2.5" />
                            Undo
                        </DawEyebrowLabel>
                        {[...state.pastSteps].reverse().map((step, index) => (
                            <DawUtilityListRow
                                key={step.key}
                                active={index === 0}
                                title={step.label}
                                titleClassName={cn(
                                    'text-xs',
                                    index === 0 ? 'text-foreground' : 'text-muted-foreground'
                                )}
                                endSlot={
                                    step.source !== 'manual' ? (
                                        <DawMicroBadge className="px-1" tone="muted">
                                            {step.source}
                                        </DawMicroBadge>
                                    ) : null
                                }
                                onPress={() => handleClick(step.targetEntryId)}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </DawUtilityPanel>
    );
};
