import { type ReactElement, useRef, useSyncExternalStore } from 'react';
import { useUndoState } from '../hooks/useUndoState';
import { useCollaborationState } from '../hooks/useCollaborationState';
import { useStatusBarMetrics } from '../hooks/useStatusBarMetrics';
import { useSelectionLabel } from '../hooks/useSelectionLabel';
import { toggleCollaborationPanel } from '../../useCases/togglePanel/panelToggles';
import { toggleUndoHistory } from '../../useCases/togglePanel/panelToggles';
import { cn } from '#/helpers/Styles/cn';
import { llmStatusStore } from '#/modules/AiRuntime/stores/llmStatusStore';
import { History, Users } from 'lucide-react';
import { Button } from '#/components/ui/button';

export const StatusBar = (): ReactElement => {
    const undoState = useUndoState();
    const collab = useCollaborationState();
    const selectionLabel = useSelectionLabel();

    const llmStatus = useSyncExternalStore(
        (cb) => llmStatusStore.subscribe(() => cb()),
        () => llmStatusStore.value
    );

    // ── Metric refs (written at 60 fps by useStatusBarMetrics) ───────────
    const cpuBarRef = useRef<HTMLDivElement>(null);
    const cpuTextRef = useRef<HTMLSpanElement>(null);
    const memContainerRef = useRef<HTMLDivElement>(null);
    const memTextRef = useRef<HTMLSpanElement>(null);
    const sampleRateRef = useRef<HTMLSpanElement>(null);
    const latencyRef = useRef<HTMLSpanElement>(null);
    const masterLevelBarRef = useRef<HTMLDivElement>(null);
    const masterLevelTextRef = useRef<HTMLSpanElement>(null);
    const engineStateRef = useRef<HTMLSpanElement>(null);

    useStatusBarMetrics({
        cpuBar: cpuBarRef,
        cpuText: cpuTextRef,
        memContainer: memContainerRef,
        memText: memTextRef,
        sampleRate: sampleRateRef,
        latency: latencyRef,
        masterLevelBar: masterLevelBarRef,
        masterLevelText: masterLevelTextRef,
        engineState: engineStateRef,
    });

    return (
        <footer
            className="flex h-6 shrink-0 items-center justify-between border-t border-black/50 bg-surface-tray shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] px-3"
            role="status"
            aria-label="Application status"
        >
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">CPU:</span>
                    <div className="h-2 w-10 rounded-full bg-muted/30 overflow-hidden">
                        <div
                            ref={cpuBarRef}
                            className="h-full rounded-full transition-[width] duration-150 bg-[var(--color-state-success)]"
                            style={{ width: '0%' }}
                        />
                    </div>
                    <span ref={cpuTextRef} className="text-[10px] font-mono text-muted-foreground w-7 text-right">
                        0%
                    </span>
                </div>

                <div ref={memContainerRef} className="flex items-center gap-1" style={{ display: 'none' }}>
                    <span className="text-[10px] text-muted-foreground">MEM:</span>
                    <span ref={memTextRef} className="text-[10px] font-mono text-muted-foreground">
                        0 MB
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">GPU:</span>
                    {llmStatus?.state === 'generating' ? (
                        <span className="text-[10px] font-mono text-[var(--color-accent-lavender)] animate-pulse">
                            active
                        </span>
                    ) : llmStatus?.state === 'loading' ? (
                        <span className="text-[10px] font-mono text-[var(--color-state-warning)]">
                            {Math.round(llmStatus.progress * 100)}%
                        </span>
                    ) : llmStatus?.state === 'ready' ? (
                        <span className="text-[10px] font-mono text-[var(--color-state-success)]/70">ready</span>
                    ) : (
                        <span className="text-[10px] font-mono text-muted-foreground/50">idle</span>
                    )}
                </div>

                <span ref={sampleRateRef} className="text-[10px] font-mono tabular-nums text-muted-foreground">
                    0kHz
                </span>
                <span ref={latencyRef} className="text-[10px] font-mono tabular-nums text-muted-foreground">
                    0.0ms
                </span>

                <div className="flex items-center gap-1">
                    <div className="h-2 w-16 rounded-full bg-muted/30 overflow-hidden">
                        <div
                            ref={masterLevelBarRef}
                            className="h-full rounded-full bg-[var(--color-state-success)] transition-[width] duration-75"
                            style={{ width: '0%' }}
                        />
                    </div>
                    <span
                        ref={masterLevelTextRef}
                        className="text-[10px] font-mono text-muted-foreground w-10 text-right"
                    >
                        -∞ dB
                    </span>
                </div>
            </div>

            {selectionLabel ? <span className="text-[10px] text-muted-foreground">{selectionLabel}</span> : null}

            <div className="flex items-center gap-3">
                {undoState.lastAction ? (
                    <span className="text-[10px] text-muted-foreground/60">Last: {undoState.lastAction.label}</span>
                ) : null}
                <Button
                    variant="ghost"
                    size="xs"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground h-5"
                    onClick={toggleCollaborationPanel}
                    aria-label="Toggle collaboration panel"
                    title="Collaboration"
                >
                    <span
                        className={cn(
                            'size-1.5 rounded-full',
                            collab.connectionStatus === 'connected'
                                ? 'bg-[var(--color-state-success)]'
                                : 'bg-muted-foreground/50'
                        )}
                    />
                    <Users className="size-3" />
                    {collab.isEnabled ? collab.peers.length : 0}
                </Button>
                <Button
                    variant="ghost"
                    size="xs"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground h-5"
                    onClick={toggleUndoHistory}
                    aria-label="Toggle undo history panel"
                    title="Undo history"
                >
                    <History className="size-3" />
                    {undoState.undoCount} undo{undoState.undoCount !== 1 ? 's' : ''}
                </Button>
                <span
                    ref={engineStateRef}
                    className="size-1.5 rounded-full bg-muted-foreground/50"
                    title="Engine: suspended"
                />
            </div>
        </footer>
    );
};
