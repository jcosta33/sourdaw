import { type ReactElement, useRef } from 'react';

import { History, Users } from 'lucide-react';

import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawMeterBar } from '#/components/daw/DawMeterBar';
import { DawMetricCluster } from '#/components/daw/DawMetricCluster';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawStatusDot, getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { llmStatusStore, type LlmEngineStatus } from '#/modules/AiRuntime/stores';
import { renderQueueStore } from '#/modules/BrowserAi/stores';

import { toggleCollaborationPanel } from '../../useCases/togglePanel/panelToggles/toggleCollaborationPanel';
import { toggleUndoHistory } from '../../useCases/togglePanel/panelToggles/toggleUndoHistory';
import { useCollaborationState } from '../hooks/useCollaborationState';
import { useSelectionLabel } from '../hooks/useSelectionLabel';
import { useStatusBarMetrics } from '../hooks/useStatusBarMetrics';
import { useUndoState } from '../hooks/useUndoState';

import { CvOutputStatusBadge } from './CvOutputStatusBadge';
import { MidiStatusBadge } from './MidiStatusBadge';
import { MonitorStatusBadge } from './MonitorStatusBadge';

const DiscordIcon = ({ className }: { className?: string }): ReactElement => (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" className={className}>
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
);

export const StatusBar = (): ReactElement => {
    const undoState = useUndoState();
    const collab = useCollaborationState();
    const selectionLabel = useSelectionLabel();

    const llmStatus = useStore<LlmEngineStatus>(llmStatusStore, { state: 'idle' });
    const renderQueue = useStore(renderQueueStore, { entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
    const activeRenderCount = renderQueue.entries.filter(
        (event) => event.status === 'rendering-browser' || event.status === 'queued' || event.status === 'preparing'
    ).length;

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

    const renderIife_13 = () => {
        if (llmStatus.state === 'generating') {
            return (
                <span className="animate-pulse font-mono text-[10px] text-[var(--color-accent-lavender)]">active</span>
            );
        } else {
            if (llmStatus.state === 'loading') {
                return (
                    <span className="font-mono text-[10px] text-[var(--color-state-warning)]">
                        {Math.round(llmStatus.progress * 100)}%
                    </span>
                );
            } else {
                if (llmStatus.state === 'ready') {
                    return <span className="font-mono text-[10px] text-[var(--color-state-success)]/70">ready</span>;
                } else {
                    return <span className="font-mono text-[10px] text-muted-foreground/50">idle</span>;
                }
            }
        }
    };

    return (
        // A plain <footer aria-label> is a contentinfo landmark — reachable on demand,
        // silent otherwise. role="status" here made the whole subtree an aria-live
        // region while useStatusBarMetrics rewrites CPU / memory / latency / master-level
        // text nodes at animation-frame rate, so a screen reader narrated meter noise
        // continuously during playback. role="status" is now scoped to the one readout
        // that changes at human pace and carries meaning: the clip-selection label.
        <footer aria-label="Application status">
            <DawControlStrip className="h-6 justify-between rounded-none border-t border-black/50 px-3">
                <div className="flex items-center gap-3">
                    {/*
                     * "UI CPU", not bare "CPU": this is a main-thread busyness
                     * estimate from requestIdleCallback and frame overrun, and
                     * it says nothing about audio-thread load. It sits beside
                     * the engine dot, whose tooltip now carries real
                     * audio-thread health (missed render deadlines), so an
                     * unqualified "CPU" here invites reading one as the other.
                     *
                     * The word "CPU" stays in the label so the existing e2e
                     * selectors (`getByText('CPU')`, substring by default) keep
                     * matching; the qualifier is what carries the meaning.
                     */}
                    <DawMetricCluster
                        aria-hidden="true"
                        label="UI CPU"
                        title="Main-thread load estimate (idle time and frame overrun). Not audio-thread load — see the engine dot for missed render deadlines."
                        meter={<DawMeterBar className="w-10" fillRef={cpuBarRef} />}
                        value={
                            <span
                                ref={cpuTextRef}
                                className="w-7 text-right font-mono text-[10px] text-muted-foreground"
                            >
                                0%
                            </span>
                        }
                    />

                    <DawMetricCluster
                        ref={memContainerRef}
                        aria-hidden="true"
                        label="MEM"
                        style={{ display: 'none' }}
                        value={
                            <span ref={memTextRef} className="font-mono text-[10px] text-muted-foreground">
                                0 MB
                            </span>
                        }
                    />

                    {/*
                     * "AI Model", not "GPU": this readout is the local LLM engine's
                     * state (idle / loading % / ready / generating) from llmStatusStore.
                     * Nothing in the status bar reports GPU utilisation, and the old
                     * label invited reading a model-load percentage as one. No e2e
                     * selector matched the "GPU" text, so the rename is free.
                     */}
                    <DawMetricCluster
                        label="AI Model"
                        title="Local AI model state — not GPU utilisation."
                        value={renderIife_13()}
                    />

                    {activeRenderCount > 0 ? (
                        <DawMetricCluster
                            label="AI Render"
                            value={
                                <span className="animate-pulse font-mono text-[10px] text-[var(--color-accent-cyan)]">
                                    {String(activeRenderCount)} active
                                </span>
                            }
                        />
                    ) : null}

                    {/* Not aria-hidden, unlike the meters above: the device sample
                        rate is fixed for the session and output latency changes
                        rarely, `updateTextNode` writes only on change, and this is
                        the only place either value is exposed anywhere in the app. */}
                    <DawReadoutRow
                        label="Rate"
                        value={
                            <span
                                ref={sampleRateRef}
                                className="font-mono tabular-nums text-[10px] text-muted-foreground"
                            >
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

                    <DawMetricCluster
                        aria-hidden="true"
                        label="Out"
                        meter={
                            <DawMeterBar
                                className="w-16"
                                fillRef={masterLevelBarRef}
                                fillClassName="h-full rounded-full bg-[var(--color-state-success)] transition-[width] duration-75"
                            />
                        }
                        value={
                            <span
                                ref={masterLevelTextRef}
                                className="w-10 text-right font-mono text-[10px] text-muted-foreground"
                            >
                                {/* Pre-tick placeholder. The engine has not wired a meter tap yet,
                                    so it has no level to report — "-∞ dB" here would claim silence
                                    before anything was measured. useStatusBarMetrics overwrites
                                    this on the first animation frame. */}
                                n/a
                            </span>
                        }
                    />
                </div>

                <span role="status" className="text-[10px] text-muted-foreground">
                    {selectionLabel}
                </span>

                <div className="flex items-center gap-3">
                    {undoState.lastAction ? (
                        <span className="text-[10px] text-muted-foreground/60">Last: {undoState.lastAction.label}</span>
                    ) : null}
                    <MidiStatusBadge />
                    <MonitorStatusBadge />
                    <CvOutputStatusBadge />
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
                        data-testid="toggle-collaboration"
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
