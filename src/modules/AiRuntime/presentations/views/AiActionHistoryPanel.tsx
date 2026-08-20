import { type ReactElement, useState } from 'react';

import { History, Undo2, Trash2, ChevronDown, ChevronRight, X, Bot, User, RefreshCw } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityListRow } from '#/components/daw/DawUtilityListRow';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { useStore } from '#/infra/store/useStore';
import { actionReplayRevisionStore } from '#/modules/Command/stores';
import { clearActionHistory, getActionReplayStatus, revertAction } from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { aiActionHistoryStore, toggleAiHistoryPanel, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { revertAiActionGroup } from '../../useCases/aiHistoryActions';

type AiActionEntryView = { kind: 'appAction'; actionType: string; label: string };

type AiActionGroupView = {
    id: string;
    prompt: string;
    actions: AiActionEntryView[];
    groupId: string;
    timestamp: number;
    reverted: boolean;
    executionKind?: 'project' | 'runtime';
};

type ActionHistoryEntryView = {
    id: string;
    label: string;
    actionKind: string;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    reverted: boolean;
    groupId?: string;
    groupLabel?: string;
};

const defaultAiState = { groups: [] as AiActionGroupView[], panelOpen: false };
const defaultHistoryState = { entries: [] as ActionHistoryEntryView[] };

type HistoryItem = { kind: 'ai'; group: AiActionGroupView } | { kind: 'action'; entry: ActionHistoryEntryView };

/**
 * Unified Action History — shows all user and AI actions in chronological order.
 * AI actions show as expandable groups with batch revert.
 * User actions show individually with non-linear revert when an inverse exists.
 */
export const AiActionHistoryPanel = (): ReactElement | null => {
    const aiState = useStore(aiActionHistoryStore, defaultAiState);
    const historyState = useStore(actionHistoryStore, defaultHistoryState);
    const replay_revision = useStore(actionReplayRevisionStore, 0);
    const [clear_error, setClearError] = useState<string | null>(null);

    if (!aiState.panelOpen) {
        return null;
    }

    const items: HistoryItem[] = [];

    for (const group of aiState.groups) {
        items.push({ kind: 'ai', group });
    }

    for (const entry of historyState.entries) {
        if (entry.source !== 'ai') {
            items.push({ kind: 'action', entry });
        }
    }

    items.sort((alpha, b) => {
        const ta = alpha.kind === 'ai' ? alpha.group.timestamp : alpha.entry.timestamp;
        const tb = b.kind === 'ai' ? b.group.timestamp : b.entry.timestamp;
        return tb - ta;
    });

    const visibleItems = items.slice(0, 50);

    const handleClearAll = () => {
        setClearError(null);
        try {
            clearActionHistory();
            clearAiHistory();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            setClearError(`Clear history failed: ${reason}`);
        }
    };

    return (
        <DawUtilityPanel className="fixed right-4 bottom-16 z-50 flex max-h-[60vh] w-80 flex-col animate-in slide-in-from-right-5">
            <DawHeaderBand
                className="rounded-t-lg px-3 py-2"
                startSlot={<History className="size-3.5 text-[var(--color-accent-lavender)]" />}
                title="Action History"
                titleClassName="text-xs font-medium normal-case tracking-normal text-foreground"
                actions={
                    <Row gap={1}>
                        {visibleItems.length > 0 ? (
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={handleClearAll}
                                title="Clear history"
                                aria-label="Clear action history"
                            >
                                <Trash2 className="size-3" />
                            </Button>
                        ) : null}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={toggleAiHistoryPanel}
                            aria-label="Close action history"
                        >
                            <X className="size-3" />
                        </Button>
                    </Row>
                }
            />
            {clear_error ? (
                <div
                    role="alert"
                    className="border-b border-border/50 px-3 py-1.5 text-[10px] text-[var(--color-state-danger)]"
                >
                    {clear_error}
                </div>
            ) : null}
            <ScrollArea className="flex-1 max-h-[50vh]">
                {visibleItems.length === 0 ? (
                    <div className="p-3">
                        <DawEmptyState
                            compact
                            icon={<History className="size-4" />}
                            title="No actions yet"
                            description="Changes you make will appear here."
                        />
                    </div>
                ) : (
                    visibleItems.map((item, idx) =>
                        item.kind === 'ai' ? (
                            <AiGroupItem key={`ai-${item.group.id}`} group={item.group} />
                        ) : (
                            <ActionItem
                                key={`action-${getActionHistoryEntryIdentity(item.entry)}-${replay_revision}-${idx}`}
                                entry={item.entry}
                            />
                        )
                    )
                )}
            </ScrollArea>
        </DawUtilityPanel>
    );
};

const AiGroupItem = ({ group }: { group: AiActionGroupView }): ReactElement => {
    const [expanded, setExpanded] = useState(false);
    const isRuntimeExecution = group.executionKind === 'runtime';

    let endSlot: ReactElement | null;
    if (isRuntimeExecution) {
        endSlot = <span className="text-[8px] italic text-muted-foreground">runtime</span>;
    } else if (group.reverted) {
        endSlot = <span className="text-[8px] italic text-muted-foreground">undone</span>;
    } else {
        endSlot = (
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void revertAiActionGroup(group)}
                title="Undo all changes from this AI action"
            >
                <Undo2 className="size-3" />
            </Button>
        );
    }

    return (
        <div className={`border-b border-border/50 last:border-0 ${group.reverted ? 'opacity-40' : ''}`}>
            <DawUtilityListRow
                dimmed={group.reverted}
                startSlot={
                    <Row gap={1.5}>
                        <button
                            type="button"
                            onClick={() => setExpanded(!expanded)}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        </button>
                        <Bot className="size-3 text-[var(--color-accent-lavender)]" />
                    </Row>
                }
                title={group.prompt}
                subtitle={`${group.actions.length} ${isRuntimeExecution ? 'runtime command' : 'change'}${group.actions.length !== 1 ? 's' : ''} · ${formatTimeAgo(group.timestamp)}`}
                endSlot={endSlot}
            />
            {expanded ? (
                <Stack gap={0.5} className="px-3 pb-1.5 pl-8">
                    {group.actions.map((alpha, index) => (
                        <Row gap={1.5} key={index}>
                            <span className="size-1 rounded-full bg-[var(--color-accent-lavender)]/40 shrink-0" />
                            <span className="text-[9px] text-muted-foreground truncate">{alpha.label}</span>
                        </Row>
                    ))}
                </Stack>
            ) : null}
        </div>
    );
};

const ActionItem = ({ entry }: { entry: ActionHistoryEntryView }): ReactElement => {
    const replay_status = getActionReplayStatus(entry.id);
    const [operation_status, setOperationStatus] = useState<
        'idle' | 'pending' | 'executed' | 'executed-unmarked' | 'reconciled'
    >('idle');
    const [operation_error, setOperationError] = useState<string | null>(null);

    const handleRevert = async () => {
        setOperationStatus('pending');
        setOperationError(null);
        try {
            const result = await revertAction(entry.id);
            if (
                result.status === 'executed' ||
                result.status === 'executed-unmarked' ||
                result.status === 'reconciled'
            ) {
                setOperationStatus(result.status);
                return;
            }
            setOperationStatus('idle');
            setOperationError('Revert is no longer available');
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            setOperationStatus('idle');
            setOperationError(`Revert failed: ${reason}`);
        }
    };

    let subtitle = formatTimeAgo(entry.timestamp);
    if (operation_error) {
        subtitle = operation_error;
    } else if (operation_status === 'pending') {
        subtitle = replay_status.status === 'reconcile-mark' ? 'Updating history...' : 'Reverting...';
    } else if (operation_status === 'executed') {
        subtitle = 'Reverted';
    } else if (operation_status === 'executed-unmarked') {
        subtitle = 'Change applied, but history row changed';
    } else if (operation_status === 'reconciled') {
        subtitle = 'History repaired';
    } else if (replay_status.status === 'reconcile-mark') {
        subtitle = 'History update pending';
    }

    let subtitle_class_name: string | undefined;
    if (operation_error) {
        subtitle_class_name = 'text-[var(--color-state-danger)]';
    } else if (operation_status === 'executed-unmarked') {
        subtitle_class_name = 'text-[var(--color-state-warning)]';
    }

    let endSlotContent: ReactElement | null = null;
    if (entry.reverted) {
        endSlotContent = <span className="text-[8px] italic text-muted-foreground">undone</span>;
    } else if (
        (replay_status.status === 'ready' || replay_status.status === 'reconcile-mark') &&
        operation_status !== 'executed' &&
        operation_status !== 'executed-unmarked' &&
        operation_status !== 'reconciled'
    ) {
        const is_reconciliation = replay_status.status === 'reconcile-mark';
        const action_label = is_reconciliation ? 'Retry history update' : 'Revert this change';
        endSlotContent = (
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleRevert}
                disabled={operation_status === 'pending'}
                title={action_label}
                aria-label={action_label}
            >
                {is_reconciliation ? (
                    <RefreshCw
                        className={`size-3 text-muted-foreground/50 ${operation_status === 'pending' ? 'animate-spin' : ''}`}
                    />
                ) : (
                    <Undo2 className="size-3 text-muted-foreground/50" />
                )}
            </Button>
        );
    }

    return (
        <DawUtilityListRow
            className="border-b border-border/30 last:border-0"
            dimmed={entry.reverted}
            startSlot={<User className="size-3 text-muted-foreground/50" />}
            title={entry.label}
            subtitle={subtitle}
            subtitleClassName={subtitle_class_name}
            endSlot={endSlotContent}
        />
    );
};

function getActionHistoryEntryIdentity(entry: ActionHistoryEntryView): string {
    return JSON.stringify([
        entry.id,
        entry.label,
        entry.actionKind,
        entry.source,
        entry.timestamp,
        entry.groupId ?? null,
        entry.groupLabel ?? null,
    ]);
}

function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) {
        return 'just now';
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}
