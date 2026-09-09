import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Bug, Code2, Ellipsis, History, Link2, MessageCircle, Scale, Users } from 'lucide-react';

import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawMeterBar } from '#/components/daw/DawMeterBar';
import { DawMetricCluster } from '#/components/daw/DawMetricCluster';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawStatusDot, getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
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
import { PROJECT_LINKS } from '../projectLinks';

import { CvOutputStatusBadge } from './CvOutputStatusBadge';
import { MidiStatusBadge } from './MidiStatusBadge';
import { MonitorStatusBadge } from './MonitorStatusBadge';

// The expanded footer needed 1,191 CSS px to contain its active monitor/CV
// controls in the exact 575px reproduction. Match the transport's established
// 1,199px admission boundary so those controls have a small real layout margin.
const COMPACT_STATUS_BAR_MAX_WIDTH = 1199;

const isCompactStatusBarViewport = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }
    const width = window.innerWidth;
    return width > 0 && width <= COMPACT_STATUS_BAR_MAX_WIDTH;
};

export const StatusBar = (): ReactElement => {
    const undoState = useUndoState();
    const collab = useCollaborationState();
    const selectionLabel = useSelectionLabel();
    const footerRef = useRef<HTMLElement>(null);
    const moreTriggerRef = useRef<HTMLButtonElement>(null);
    const moreSurfaceRef = useRef<HTMLDivElement>(null);
    const moreOpenRef = useRef(false);
    const projectLinksTriggerRef = useRef<HTMLButtonElement>(null);
    const projectLinksContentRef = useRef<HTMLDivElement>(null);
    const projectLinksOpenRef = useRef(false);
    const compactModeRef = useRef(isCompactStatusBarViewport());
    const restoreFocusAfterModeChangeRef = useRef<'compact' | 'expanded' | null>(null);
    const [moreOpen, setMoreOpen] = useState(false);
    const [projectLinksOpen, setProjectLinksOpen] = useState(false);
    const [compactMode, setCompactMode] = useState(isCompactStatusBarViewport);

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

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }
        const syncCompactMode = (): void => {
            const nextCompactMode = isCompactStatusBarViewport();
            if (nextCompactMode === compactModeRef.current) {
                return;
            }
            const activeElement = document.activeElement;
            const footerOwnsFocus = activeElement instanceof Node && footerRef.current?.contains(activeElement);
            const moreOwnsFocus = activeElement instanceof Node && moreSurfaceRef.current?.contains(activeElement);
            const projectLinksOwnFocus =
                activeElement instanceof Node && projectLinksContentRef.current?.contains(activeElement);
            if (footerOwnsFocus || moreOwnsFocus || projectLinksOwnFocus) {
                restoreFocusAfterModeChangeRef.current = nextCompactMode ? 'compact' : 'expanded';
            }
            compactModeRef.current = nextCompactMode;
            if (moreOpenRef.current) {
                moreOpenRef.current = false;
                setMoreOpen(false);
            }
            projectLinksOpenRef.current = false;
            setProjectLinksOpen(false);
            setCompactMode(nextCompactMode);
        };
        window.addEventListener('resize', syncCompactMode);
        syncCompactMode();
        return () => window.removeEventListener('resize', syncCompactMode);
    }, []);

    useEffect(() => {
        const target = restoreFocusAfterModeChangeRef.current;
        if (target === null) {
            return;
        }
        restoreFocusAfterModeChangeRef.current = null;
        const selector =
            target === 'compact'
                ? 'button[aria-label="More application status"]'
                : 'button[aria-label="Project links"]';
        window.requestAnimationFrame(() => {
            footerRef.current?.querySelector<HTMLElement>(selector)?.focus();
        });
    }, [compactMode]);

    const setMorePopoverOpen = (open: boolean): void => {
        moreOpenRef.current = open;
        if (!open) {
            projectLinksOpenRef.current = false;
            setProjectLinksOpen(false);
        }
        setMoreOpen(open);
    };

    const setProjectLinksPopoverOpen = (open: boolean): void => {
        projectLinksOpenRef.current = open;
        setProjectLinksOpen(open);
    };

    useEffect(() => {
        if (!moreOpen) {
            return undefined;
        }
        const closeNestedDisclosureOrMoreOnEscape = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') {
                return;
            }
            const moreSurface = moreSurfaceRef.current;
            if (moreSurface === null) {
                return;
            }
            if (projectLinksOpenRef.current) {
                event.preventDefault();
                event.stopPropagation();
                projectLinksOpenRef.current = false;
                setProjectLinksOpen(false);
                window.requestAnimationFrame(() => projectLinksTriggerRef.current?.focus());
                return;
            }
            if (!(event.target instanceof Element)) {
                return;
            }
            const nestedTrigger = event.target.closest('button[aria-haspopup]');
            if (nestedTrigger === null || !moreSurface.contains(nestedTrigger)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            moreOpenRef.current = false;
            setMoreOpen(false);
            window.requestAnimationFrame(() => moreTriggerRef.current?.focus());
        };
        window.addEventListener('keydown', closeNestedDisclosureOrMoreOnEscape, true);
        return () => window.removeEventListener('keydown', closeNestedDisclosureOrMoreOnEscape, true);
    }, [moreOpen]);

    const renderAiModelValue = (): ReactElement => {
        if (llmStatus.state === 'generating') {
            return (
                <span className="animate-pulse font-mono text-[10px] text-[var(--color-accent-lavender)]">active</span>
            );
        }
        if (llmStatus.state === 'loading') {
            return (
                <span className="font-mono text-[10px] text-[var(--color-state-warning)]">
                    {Math.round(llmStatus.progress * 100)}%
                </span>
            );
        }
        if (llmStatus.state === 'ready') {
            return <span className="font-mono text-[10px] text-[var(--color-state-success)]/70">ready</span>;
        }
        return <span className="font-mono text-[10px] text-muted-foreground/50">idle</span>;
    };

    const renderMeterMetrics = (): ReactElement => (
        <>
            {/* UI CPU is a main-thread busyness estimate. The adjacent engine dot
                carries audio-thread deadline health, so this stays explicitly qualified. */}
            <DawMetricCluster
                aria-hidden="true"
                className="shrink-0 whitespace-nowrap"
                label="UI CPU"
                title="Main-thread load estimate (idle time and frame overrun). Not audio-thread load — see the engine dot for missed render deadlines."
                meter={<DawMeterBar className="w-10" fillRef={cpuBarRef} />}
                value={
                    <span ref={cpuTextRef} className="w-7 text-right font-mono text-[10px] text-muted-foreground">
                        0%
                    </span>
                }
            />
            <DawMetricCluster
                ref={memContainerRef}
                aria-hidden="true"
                className="shrink-0 whitespace-nowrap"
                label="MEM"
                style={{ display: 'none' }}
                value={
                    <span ref={memTextRef} className="font-mono text-[10px] text-muted-foreground">
                        0 MB
                    </span>
                }
            />
            {/* This is the local LLM engine state, not GPU utilisation. */}
            <DawMetricCluster
                className="shrink-0 whitespace-nowrap"
                label="AI Model"
                title="Local AI model state — not GPU utilisation."
                value={renderAiModelValue()}
            />
            {activeRenderCount > 0 ? (
                <DawMetricCluster
                    className="shrink-0 whitespace-nowrap"
                    label="AI Render"
                    value={
                        <span className="animate-pulse font-mono text-[10px] text-[var(--color-accent-cyan)]">
                            {String(activeRenderCount)} active
                        </span>
                    }
                />
            ) : null}
            <DawMetricCluster
                aria-hidden="true"
                className="shrink-0 whitespace-nowrap"
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
                        {/* Before the first meter tick, no output level has been measured. */}
                        n/a
                    </span>
                }
            />
        </>
    );

    const renderDeviceReadouts = (): ReactElement => (
        <>
            {/* Rate and latency change rarely and are the only exposed device readouts. */}
            <DawReadoutRow
                label="Rate"
                value={
                    <span ref={sampleRateRef} className="font-mono tabular-nums text-[10px] text-muted-foreground">
                        0kHz
                    </span>
                }
                className="shrink-0 gap-1.5"
                labelClassName="whitespace-nowrap text-muted-foreground/70"
            />
            <DawReadoutRow
                label="Latency"
                value={
                    <span ref={latencyRef} className="font-mono tabular-nums text-[10px] text-muted-foreground">
                        0.0ms
                    </span>
                }
                className="shrink-0 gap-1.5"
                labelClassName="whitespace-nowrap text-muted-foreground/70"
            />
        </>
    );

    const renderProjectLinks = (insideMore: boolean): ReactElement => (
        <Tooltip>
            <DropdownMenu
                modal={!insideMore}
                open={insideMore ? projectLinksOpen : undefined}
                onOpenChange={insideMore ? setProjectLinksPopoverOpen : undefined}
            >
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <Button
                            ref={insideMore ? projectLinksTriggerRef : undefined}
                            variant="ghost"
                            size="xs"
                            className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                            aria-label="Project links"
                        >
                            <Link2 className="size-3" aria-hidden="true" />
                            Links
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <DropdownMenuContent ref={projectLinksContentRef} align="end" side="top">
                    <DropdownMenuLabel>Sourdaw</DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                        <a href={PROJECT_LINKS.source} target="_blank" rel="noopener noreferrer">
                            <Code2 aria-hidden="true" />
                            Source
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <a href={PROJECT_LINKS.discussions} target="_blank" rel="noopener noreferrer">
                            <MessageCircle aria-hidden="true" />
                            Discussions
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <a href={PROJECT_LINKS.issues} target="_blank" rel="noopener noreferrer">
                            <Bug aria-hidden="true" />
                            Report a bug
                        </a>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>Project links</TooltipContent>
        </Tooltip>
    );

    const renderActions = (insideMore: boolean): ReactElement => (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => window.open('/legal/THIRD-PARTY-NOTICES.md', '_blank')}
                        aria-label="Third-party licenses"
                    >
                        <Scale className="size-3" aria-hidden="true" />
                        Legal
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Third-party licenses and source</TooltipContent>
            </Tooltip>
            {renderProjectLinks(insideMore)}
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
        </>
    );

    const renderSelection = (): ReactElement => (
        <span
            role="status"
            className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
            title={selectionLabel}
        >
            {selectionLabel}
        </span>
    );

    const renderCriticalStatus = (): ReactElement => (
        <>
            <span ref={engineStateRef} className={`shrink-0 ${getDawStatusDotClassName()}`} title="Engine: suspended" />
            <span className="shrink-0">
                <MonitorStatusBadge />
            </span>
            <span className="shrink-0">
                <CvOutputStatusBadge />
            </span>
        </>
    );

    const renderDeferredContent = (): ReactElement => (
        <div className="space-y-2">
            <Row gap={3} wrap className="min-w-0">
                {renderMeterMetrics()}
            </Row>
            <Row gap={3} wrap className="min-w-0 border-t border-border-soft pt-2">
                {undoState.lastAction ? (
                    <span className="max-w-full break-words text-[10px] text-muted-foreground/60">
                        Last: {undoState.lastAction.label}
                    </span>
                ) : null}
                <MidiStatusBadge />
                {renderActions(true)}
            </Row>
        </div>
    );

    return (
        // A plain <footer aria-label> is a contentinfo landmark — reachable on demand,
        // silent otherwise. role="status" here made the whole subtree an aria-live
        // region while useStatusBarMetrics rewrites CPU / memory / latency / master-level
        // text nodes at animation-frame rate, so a screen reader narrated meter noise
        // continuously during playback. role="status" is now scoped to the one readout
        // that changes at human pace and carries meaning: the clip-selection label.
        <footer ref={footerRef} aria-label="Application status">
            {compactMode ? (
                <DawControlStrip className="h-6 rounded-none border-t border-black/50 px-3">
                    <Row gap={2} className="min-w-0 flex-1">
                        {renderCriticalStatus()}
                        {renderDeviceReadouts()}
                        {renderSelection()}
                    </Row>
                    <Popover open={moreOpen} onOpenChange={setMorePopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                ref={moreTriggerRef}
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0"
                                aria-label="More application status"
                            >
                                <Ellipsis className="size-3.5" aria-hidden="true" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            ref={moreSurfaceRef}
                            align="end"
                            side="top"
                            aria-label="More application status"
                        >
                            {renderDeferredContent()}
                        </PopoverContent>
                    </Popover>
                </DawControlStrip>
            ) : (
                <DawControlStrip className="h-6 justify-between rounded-none border-t border-black/50 px-3">
                    <Row gap={3} className="min-w-0 shrink-0">
                        {renderMeterMetrics()}
                        {renderDeviceReadouts()}
                    </Row>
                    {renderSelection()}
                    <Row gap={3} className="min-w-0 shrink-0">
                        {undoState.lastAction ? (
                            <span className="max-w-56 truncate text-[10px] text-muted-foreground/60">
                                Last: {undoState.lastAction.label}
                            </span>
                        ) : null}
                        <MidiStatusBadge />
                        {renderCriticalStatus()}
                        {renderActions(false)}
                    </Row>
                </DawControlStrip>
            )}
        </footer>
    );
};
