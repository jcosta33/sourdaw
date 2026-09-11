import { type KeyboardEvent, type ReactElement, type Ref } from 'react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

const MAX_REQUEST_LABEL_LENGTH = 80;

type AgentRunListItem = {
    runId: string;
    request: string;
    phase: string;
};

type AgentRunListProps = {
    runs: readonly AgentRunListItem[];
    selectedRunId: string | null;
    onSelect: (runId: string) => void;
    ref?: Ref<HTMLDivElement>;
};

function optionId(runId: string): string {
    return `agent-run-option-${runId}`;
}

function truncateRequest(request: string): string {
    if (request.length <= MAX_REQUEST_LABEL_LENGTH) {
        return request;
    }
    return `${request.slice(0, MAX_REQUEST_LABEL_LENGTH)}…`;
}

/** `null` for a key the listbox does not own, so the event keeps its default. */
function getSelectionIndex(key: string, currentIndex: number, count: number): number | null {
    if (key === 'ArrowDown') {
        return Math.min(currentIndex + 1, count - 1);
    }
    if (key === 'ArrowUp') {
        return Math.max(currentIndex - 1, 0);
    }
    if (key === 'Home') {
        return 0;
    }
    if (key === 'End') {
        return count - 1;
    }
    if (key === 'Enter' || key === ' ') {
        return currentIndex;
    }
    return null;
}

export const AgentRunList = ({ runs, selectedRunId, onSelect, ref }: AgentRunListProps): ReactElement => {
    if (runs.length === 0) {
        return <DawEmptyState title="No agent runs yet" compact />;
    }

    const selectedIndex = Math.max(
        runs.findIndex((run) => run.runId === selectedRunId),
        0
    );
    const activeRun = runs[selectedIndex]!;

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const nextIndex = getSelectionIndex(event.key, selectedIndex, runs.length);
        if (nextIndex === null) {
            return;
        }
        event.preventDefault();
        onSelect(runs[nextIndex]!.runId);
    };

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label="Agent runs"
            aria-activedescendant={optionId(activeRun.runId)}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1 outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
        >
            {runs.map((run) => {
                const selected = run.runId === selectedRunId;

                return (
                    <div
                        key={run.runId}
                        id={optionId(run.runId)}
                        role="option"
                        aria-selected={selected}
                        tabIndex={-1}
                        data-state={selected ? 'selected' : 'idle'}
                        onClick={() => onSelect(run.runId)}
                        className={cn(
                            'cursor-pointer rounded px-2 py-1.5 transition-colors motion-reduce:transition-none',
                            selected
                                ? 'bg-surface-raised text-foreground'
                                : 'text-muted-foreground hover:bg-surface-raised/50'
                        )}
                    >
                        <Row justify="between" gap={2} className="min-w-0">
                            <span className="min-w-0 truncate text-xs">{truncateRequest(run.request)}</span>
                            <DawMicroBadge>{run.phase}</DawMicroBadge>
                        </Row>
                    </div>
                );
            })}
        </div>
    );
};
