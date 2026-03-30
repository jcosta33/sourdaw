import { type ReactElement, useSyncExternalStore, useState } from 'react';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { History, Undo2, Trash2, ChevronDown, ChevronRight, X, Bot, User } from 'lucide-react';
import {
    aiActionHistoryStore,
    toggleAiHistoryPanel,
    clearAiHistory,
    type AiActionGroup,
} from '#/modules/AiRuntime/stores/aiActionHistoryStore';
import { undoStore } from '#/modules/Command/stores/undoStore';
import { type UndoEntry } from '#/modules/Command/models/UndoEntry';
import { revertAiActionGroup } from '#/modules/AiRuntime/useCases/aiHistoryActions';
import { undo } from '#/modules/Command/useCases/undoRedo';

const defaultAiState = { groups: [] as AiActionGroup[], panelOpen: false };
const defaultUndoState = { past: [] as UndoEntry[], future: [] as UndoEntry[] };

type HistoryItem = { kind: 'ai'; group: AiActionGroup } | { kind: 'user'; entry: UndoEntry };

/**
 * Unified Action History — shows both user actions and AI actions
 * in chronological order. AI actions are tagged with a bot icon.
 */
export const AiActionHistoryPanel = (): ReactElement | null => {
    const aiState = useSyncExternalStore(
        (cb) => aiActionHistoryStore.subscribe(cb),
        () => aiActionHistoryStore.value ?? defaultAiState
    );
    const undoState = useSyncExternalStore(
        (cb) => undoStore.subscribe(cb),
        () => undoStore.value ?? defaultUndoState
    );

    if (!aiState.panelOpen) {
        return null;
    }

    // Build unified timeline: AI groups + user undo entries, sorted by time
    const items: HistoryItem[] = [];

    for (const group of aiState.groups) {
        items.push({ kind: 'ai', group });
    }

    // User actions from undo store (exclude AI-sourced to avoid duplicates)
    for (const entry of undoState.past) {
        if (entry.source !== 'ai') {
            items.push({ kind: 'user', entry });
        }
    }

    items.sort((a, b) => {
        const ta = a.kind === 'ai' ? a.group.timestamp : a.entry.timestamp;
        const tb = b.kind === 'ai' ? b.group.timestamp : b.entry.timestamp;
        return tb - ta;
    });

    const visibleItems = items.slice(0, 50);

    return (
        <div className="fixed right-4 bottom-16 z-50 w-80 max-h-[60vh] rounded-lg border border-border bg-surface-raised shadow-xl flex flex-col animate-in slide-in-from-right-5">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <History className="size-3.5 text-[var(--color-accent-lavender)]" />
                <span className="text-xs font-medium text-foreground flex-1">Action History</span>
                {aiState.groups.length > 0 ? (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={clearAiHistory}
                        title="Clear AI history"
                        aria-label="Clear AI action history"
                    >
                        <Trash2 className="size-3" />
                    </Button>
                ) : null}
                <Button variant="ghost" size="icon-xs" onClick={toggleAiHistoryPanel} aria-label="Close action history">
                    <X className="size-3" />
                </Button>
            </div>
            <ScrollArea className="flex-1 max-h-[50vh]">
                {visibleItems.length === 0 ? (
                    <p className="px-3 py-6 text-center text-[10px] text-muted-foreground">
                        No actions yet. Changes you make will appear here.
                    </p>
                ) : (
                    visibleItems.map((item, idx) =>
                        item.kind === 'ai' ? (
                            <AiGroupItem key={`ai-${item.group.id}`} group={item.group} />
                        ) : (
                            <UserActionItem key={`user-${item.entry.id}-${idx}`} entry={item.entry} />
                        )
                    )
                )}
            </ScrollArea>
        </div>
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

const UserActionItem = ({ entry }: { entry: UndoEntry }): ReactElement => (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 last:border-0">
        <User className="size-3 text-muted-foreground/50 shrink-0" />
        <div className="flex-1 min-w-0">
            <p className="text-[11px] text-foreground/80 truncate">{entry.label}</p>
            <p className="text-[9px] text-muted-foreground">{formatTimeAgo(entry.timestamp)}</p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={() => undo()} title="Undo">
            <Undo2 className="size-3 text-muted-foreground/50" />
        </Button>
    </div>
);

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
