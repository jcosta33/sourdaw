import { type ReactElement, useSyncExternalStore } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { History, Undo2, Trash2, ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import {
    aiActionHistoryStore,
    markGroupReverted,
    toggleAiHistoryPanel,
    clearAiHistory,
    type AiActionGroup,
} from "#/modules/AiRuntime/stores/aiActionHistoryStore";
import { undoStore } from "#/modules/Command/stores/undoStore";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";

const defaultState = { groups: [] as AiActionGroup[], panelOpen: false };

const revertGroup = async (group: AiActionGroup) => {
    const state = undoStore.value;
    if (!state) return;

    const groupEntries = state.past.filter((e) => e.groupId === group.groupId);
    for (let i = groupEntries.length - 1; i >= 0; i--) {
        const entry = groupEntries[i]!;
        if (entry.kind === "callback") {
            entry.undo();
        } else if (entry.inverseAction) {
            await executeAppAction(entry.inverseAction);
        }
    }

    undoStore.set({
        past: state.past.filter((e) => e.groupId !== group.groupId),
        future: [...groupEntries, ...state.future],
    });

    markGroupReverted(group.groupId);
};

const ActionGroupItem = ({ group }: { group: AiActionGroup }): ReactElement => {
    const [expanded, setExpanded] = useState(false);
    const timeAgo = formatTimeAgo(group.timestamp);

    return (
        <div className={`border-b border-border/50 last:border-0 ${group.reverted ? "opacity-40" : ""}`}>
            <div className="flex items-center gap-1.5 px-3 py-2">
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={expanded ? "Collapse" : "Expand"}
                >
                    {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate" title={group.prompt}>
                        {group.prompt}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                        {group.actions.length} action{group.actions.length !== 1 ? "s" : ""} · {timeAgo}
                    </p>
                </div>
                {!group.reverted && (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void revertGroup(group)}
                        title="Revert all actions in this group"
                        aria-label={`Revert: ${group.prompt}`}
                    >
                        <Undo2 className="size-3" />
                    </Button>
                )}
                {group.reverted && (
                    <span className="text-[9px] text-muted-foreground italic">reverted</span>
                )}
            </div>
            {expanded && (
                <div className="px-3 pb-2 pl-7 space-y-0.5">
                    {group.actions.map((a, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                            <span className="size-1 rounded-full bg-muted-foreground/40 shrink-0" />
                            <span className="text-[10px] text-muted-foreground truncate">{a.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const AiActionHistoryPanel = (): ReactElement | null => {
    const state = useSyncExternalStore(
        (cb) => aiActionHistoryStore.subscribe(cb),
        () => aiActionHistoryStore.value ?? defaultState,
    );

    if (!state.panelOpen) return null;

    const reversedGroups = [...state.groups].reverse();

    return (
        <div className="fixed right-4 bottom-16 z-50 w-80 max-h-[60vh] rounded-lg border border-border bg-surface-raised shadow-xl flex flex-col animate-in slide-in-from-right-5">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <History className="size-3.5 text-purple-400" />
                <span className="text-xs font-medium text-foreground flex-1">AI Action History</span>
                {state.groups.length > 0 && (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={clearAiHistory}
                        title="Clear history"
                        aria-label="Clear AI action history"
                    >
                        <Trash2 className="size-3" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleAiHistoryPanel}
                    aria-label="Close AI action history"
                >
                    <X className="size-3" />
                </Button>
            </div>
            <ScrollArea className="flex-1 max-h-[50vh]">
                {reversedGroups.length === 0 ? (
                    <p className="px-3 py-6 text-center text-[10px] text-muted-foreground">
                        No AI actions yet. Use the prompt bar to get started.
                    </p>
                ) : (
                    reversedGroups.map((group) => (
                        <ActionGroupItem key={group.id} group={group} />
                    ))
                )}
            </ScrollArea>
        </div>
    );
};

function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}
