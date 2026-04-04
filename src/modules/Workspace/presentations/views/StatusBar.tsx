import { type ReactElement, useRef, useSyncExternalStore } from 'react';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawMeterBar } from '#/components/daw/DawMeterBar';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawStatusDot, getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import { useUndoState } from '../hooks/useUndoState';
import { useCollaborationState } from '../hooks/useCollaborationState';
import { useStatusBarMetrics } from '../hooks/useStatusBarMetrics';
import { useSelectionLabel } from '../hooks/useSelectionLabel';
import { toggleCollaborationPanel } from '../../useCases/togglePanel/panelToggles';
import { toggleUndoHistory } from '../../useCases/togglePanel/panelToggles';
import { llmStatusStore } from '#/modules/AiRuntime/stores/llmStatusStore';
import { History, Users } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

const DiscordIcon = ({ className }: { className?: string }): ReactElement => (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" className={className}>
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
);

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
        <footer role="status" aria-label="Application status">
            <DawControlStrip className="h-6 justify-between rounded-none border-t border-black/50 px-3">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <DawEyebrowLabel size="sm" className="text-muted-foreground">CPU</DawEyebrowLabel>
                        <DawMeterBar className="w-10" fillRef={cpuBarRef} />
                        <span ref={cpuTextRef} className="w-7 text-right font-mono text-[10px] text-muted-foreground">
                            0%
                        </span>
                    </div>

                    <div ref={memContainerRef} className="flex items-center gap-1" style={{ display: 'none' }}>
                        <DawEyebrowLabel size="sm" className="text-muted-foreground">MEM</DawEyebrowLabel>
                        <span ref={memTextRef} className="font-mono text-[10px] text-muted-foreground">
                            0 MB
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <DawEyebrowLabel size="sm" className="text-muted-foreground">GPU</DawEyebrowLabel>
                        {llmStatus?.state === 'generating' ? (
                            <span className="animate-pulse font-mono text-[10px] text-[var(--color-accent-lavender)]">
                                active
                            </span>
                        ) : llmStatus?.state === 'loading' ? (
                            <span className="font-mono text-[10px] text-[var(--color-state-warning)]">
                                {Math.round(llmStatus.progress * 100)}%
                            </span>
                        ) : llmStatus?.state === 'ready' ? (
                            <span className="font-mono text-[10px] text-[var(--color-state-success)]/70">ready</span>
                        ) : (
                            <span className="font-mono text-[10px] text-muted-foreground/50">idle</span>
                        )}
                    </div>

                    <DawReadoutRow
                        label="Rate"
                        value={
                            <span ref={sampleRateRef} className="font-mono tabular-nums text-[10px] text-muted-foreground">
                                0kHz
                            </span>
                        }
                        className="gap-1.5"
                        labelClassName="text-muted-foreground/70"
                    />
                    <DawReadoutRow
                        label="Latency"
                        value={
                            <span ref={latencyRef} className="font-mono tabular-nums text-[10px] text-muted-foreground">
                                0.0ms
                            </span>
                        }
                        className="gap-1.5"
                        labelClassName="text-muted-foreground/70"
                    />

                    <div className="flex items-center gap-1">
                        <DawMeterBar
                            className="w-16"
                            fillRef={masterLevelBarRef}
                            fillClassName="h-full rounded-full bg-[var(--color-state-success)] transition-[width] duration-75"
                        />
                        <span
                            ref={masterLevelTextRef}
                            className="w-10 text-right font-mono text-[10px] text-muted-foreground"
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
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="xs"
                                className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                                onClick={() => window.open('https://discord.gg/bJHmmfY4', '_blank')}
                                aria-label="Help and Feedback"
                            >
                                <DiscordIcon className="size-3" />
                                Talk to us
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Join the Bakery (Discord) - Report a Health Code Violation</TooltipContent>
                    </Tooltip>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={toggleCollaborationPanel}
                        aria-label="Toggle collaboration panel"
                        title="Collaboration"
                    >
                        <DawStatusDot tone={collab.connectionStatus === 'connected' ? 'success' : 'muted'} />
                        <Users className="size-3" />
                        {collab.isEnabled ? collab.peers.length : 0}
                    </Button>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={toggleUndoHistory}
                        aria-label="Toggle undo history panel"
                        title="Undo history"
                    >
                        <History className="size-3" />
                        {undoState.undoCount} undo{undoState.undoCount !== 1 ? 's' : ''}
                    </Button>
                    <span ref={engineStateRef} className={getDawStatusDotClassName()} title="Engine: suspended" />
                </div>
            </DawControlStrip>
        </footer>
    );
};
