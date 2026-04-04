import { type ReactElement, useSyncExternalStore, useState } from 'react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { History, Undo2, Trash2, ChevronDown, ChevronRight, X, Bot, User } from 'lucide-react';
import {
    aiActionHistoryStore,
    toggleAiHistoryPanel,
    clearAiHistory,
    type AiActionGroup,
} from '#/modules/AiRuntime/stores/aiActionHistoryStore';
import {
    actionHistoryStore,
    clearActionHistory,
    type ActionHistoryEntry,
} from '#/modules/CrdtDocument/stores/actionHistoryStore';
import { revertAiActionGroup } from '#/modules/AiRuntime/useCases/aiHistoryActions';
import { revertAction, canRevertAction } from '#/modules/CrdtDocument/useCases/revertAction';

const defaultAiState = { groups: [] as AiActionGroup[], panelOpen: false };
const defaultHistoryState = { entries: [] as ActionHistoryEntry[] };

type HistoryItem =
    | { kind: 'ai'; group: AiActionGroup }
    | { kind: 'action'; entry: ActionHistoryEntry };

/**
 * Unified Action History — shows all user and AI actions in chronological order.
 * AI actions show as expandable groups with batch revert.
 * User actions show individually with non-linear revert when an inverse exists.
 */
export const AiActionHistoryPanel = (): ReactElement | null => {
    const aiState = useSyncExternalStore(
        (cb) => aiActionHistoryStore.subscribe(cb),
        () => aiActionHistoryStore.value ?? defaultAiState
    );
    const historyState = useSyncExternalStore(
        (cb) => actionHistoryStore.subscribe(cb),
        () => actionHistoryStore.value ?? defaultHistoryState
    );

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

    items.sort((a, b) => {
        const ta = a.kind === 'ai' ? a.group.timestamp : a.entry.timestamp;
        const tb = b.kind === 'ai' ? b.group.timestamp : b.entry.timestamp;
        return tb - ta;
    });

    const visibleItems = items.slice(0, 50);

    const handleClearAll = () => {
        clearAiHistory();
        clearActionHistory();
    };

    return (
        <DawUtilityPanel className="fixed right-4 bottom-16 z-50 flex max-h-[60vh] w-80 flex-col animate-in slide-in-from-right-5">
            <DawHeaderBand
                className="rounded-t-lg px-3 py-2"
                startSlot={<History className="size-3.5 text-[var(--color-accent-lavender)]" />}
                title="Action History"
                titleClassName="text-xs font-medium normal-case tracking-normal text-foreground"
                actions={
                    <div className="flex items-center gap-1">
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
                        <Button variant="ghost" size="icon-xs" onClick={toggleAiHistoryPanel} aria-label="Close action history">
                            <X className="size-3" />
                        </Button>
                    </div>
                }
            />
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
                            <ActionItem key={`action-${item.entry.id}-${idx}`} entry={item.entry} />
                        )
                    )
                )}
            </ScrollArea>
        </DawUtilityPanel>
    );
};

const AiGroupItem = ({ group }: { group: AiActionGroup }): ReactElement => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={`border-b border-border/50 last:border-0 ${group.reverted ? 'opacity-40' : ''}`}>
            <div className="flex items-center gap-1.5 px-3 py-1.5">
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                    {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
                <Bot className="size-3 text-[var(--color-accent-lavender)] shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate" title={group.prompt}>
                        {group.prompt}
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                        {group.actions.length} change{group.actions.length !== 1 ? 's' : ''} ·{' '}
                        {formatTimeAgo(group.timestamp)}
                    </p>
                </div>
                {!group.reverted ? (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void revertAiActionGroup(group)}
                        title="Undo all changes from this AI action"
                    >
                        <Undo2 className="size-3" />
                    </Button>
                ) : (
                    <span className="text-[8px] text-muted-foreground italic">undone</span>
                )}
            </div>
            {expanded ? (
                <div className="px-3 pb-1.5 pl-8 space-y-0.5">
                    {group.actions.map((a, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                            <span className="size-1 rounded-full bg-[var(--color-accent-lavender)]/40 shrink-0" />
                            <span className="text-[9px] text-muted-foreground truncate">{a.label}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

const ActionItem = ({ entry }: { entry: ActionHistoryEntry }): ReactElement => {
    const revertable = canRevertAction(entry);

    return (
        <div className={`flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 last:border-0 ${entry.reverted ? 'opacity-40' : ''}`}>
            <User className="size-3 text-muted-foreground/50 shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground/80 truncate">{entry.label}</p>
                <p className="text-[9px] text-muted-foreground">{formatTimeAgo(entry.timestamp)}</p>
            </div>
            {entry.reverted ? (
                <span className="text-[8px] text-muted-foreground italic">undone</span>
            ) : revertable ? (
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void revertAction(entry.id)}
                    title="Revert this change"
                >
                    <Undo2 className="size-3 text-muted-foreground/50" />
                </Button>
            ) : null}
        </div>
    );
};

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
