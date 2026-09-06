import { type MouseEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { Ellipsis } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { useStore } from '#/infra/store/useStore';
import { voiceInputAvailabilityStore, voiceStatusStore } from '#/modules/AiRuntime/stores';
import { toggleVoiceInput } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { RecentProjectsMenu, ArrangementSelector, MissingMediaPanel } from '#/modules/Project/presentations/views';
import { PunchRecordingControls } from '#/modules/PunchRecording/presentations/views';
import { TempoEditor } from '#/modules/TimelineEditor/presentations/views';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../models/TrackViewTypes';
import { toggleRippleEditing } from '../../useCases/rippleEditing';
import { windowChromeControls } from '../../useCases/windowChrome';
import { VoiceButton } from '../components/Transport/VoiceButton';
import { TITLEBAR_NO_DRAG_SELECTOR } from '../helpers/titlebarDragRegion';
import { useAudioRecordingState } from '../hooks/useAudioRecordingState';
import { useProjectState } from '../hooks/useProjectState';
import { useTransportState } from '../hooks/useTransportState';
import { useUndoState } from '../hooks/useUndoState';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { PromptBar } from './PromptBar';
import { ToolSelector } from './ToolSelector';
import { AutoScrollToggle } from './Transport/AutoScrollToggle';
import { PanelToggles } from './Transport/PanelToggles';
import { PlayheadDisplay } from './Transport/PlayheadDisplay';
import { ProjectName } from './Transport/ProjectName';
import { SoloModeSelector } from './Transport/SoloModeSelector';
import { TransportControls } from './Transport/TransportControls';
import { UndoRedoButtons } from './Transport/UndoRedoButtons';
import { WindowControls } from './Transport/WindowControls';

const getTracks = (state: { tracks: Track[] } | null): Track[] => state?.tracks ?? [];
const COMPACT_TRANSPORT_MAX_WIDTH = 1199;
const isCompactLayoutViewport = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }
    const width = window.innerWidth;
    return width > 0 && width <= COMPACT_TRANSPORT_MAX_WIDTH;
};

/** Lit-edge separator that follows the NW light source model from the design system */
const Sep = (): ReactElement => <div className="mx-0.5 h-5 w-px shrink-0 daw-seam" />;

const findOpenNestedTrigger = (surface: HTMLElement): HTMLElement | null => {
    const trigger = surface.querySelector('button[aria-haspopup][aria-expanded="true"]');
    return trigger instanceof HTMLElement ? trigger : null;
};

export const TransportBar = (): ReactElement => {
    const moreContainerRef = useRef<HTMLElement>(null);
    const moreTriggerRef = useRef<HTMLButtonElement>(null);
    const moreSurfaceRef = useRef<HTMLDivElement>(null);
    const moreOpenRef = useRef(false);
    const restoreFocusAfterModeChangeRef = useRef(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [compactMode, setCompactMode] = useState(isCompactLayoutViewport);
    const compactModeRef = useRef(compactMode);
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        chatPanelOpen,
        trackListOpen,
        timeDisplayMode,
        rippleEditing,
        virtualKeyboardOpen,
        dualViewOpen,
        soloMode,
    } = useWorkspaceState();
    const transport = useTransportState();
    const audioState = useAudioRecordingState();
    const undoState = useUndoState();
    const project = useProjectState();

    const tracks = getTracks(useStore(trackStore, { tracks: [], selectedTrackId: null }));
    const voice = useStore(voiceStatusStore, { isListening: false, transcribing: false });
    const voiceInputAvailable = useStore(voiceInputAvailabilityStore, {
        hasVerifiedLocalModel: false,
    }).hasVerifiedLocalModel;
    const anyTrackArmed = tracks.some((time) => time.armed);
    const anyMidiTrackArmed = tracks.some((time) => time.armed && time.kind === 'midi');

    const isRecording = transport.isRecording;

    // Frameless chrome (Linux): the title row is the drag region, so a
    // double-click on its empty stretches toggles maximize — unless it landed
    // on something the row hands its clicks back to, which keeps its own
    // double-click meaning. Overlay chrome (macOS): the native traffic lights
    // sit over the same band, so the row is inset past them by the modifier
    // class, and the OS itself answers a double-click on what remains.
    const { frameless: framelessChrome, windowControlsOverlay: overlayChrome } = windowChromeControls();
    const toggleMaximizeOnTitlebarDoubleClick = (event: MouseEvent<HTMLElement>): void => {
        if (!framelessChrome) {
            return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest(TITLEBAR_NO_DRAG_SELECTOR) !== null) {
            return;
        }
        void windowChromeControls().toggleMaximize();
    };

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }
        const syncCompactMode = (): void => {
            const nextCompactMode = isCompactLayoutViewport();
            if (nextCompactMode === compactModeRef.current) {
                return;
            }
            compactModeRef.current = nextCompactMode;
            if (moreOpenRef.current) {
                moreOpenRef.current = false;
                setMoreOpen(false);
            }
            restoreFocusAfterModeChangeRef.current = true;
            setCompactMode(nextCompactMode);
        };
        window.addEventListener('resize', syncCompactMode);
        syncCompactMode();
        return () => {
            window.removeEventListener('resize', syncCompactMode);
        };
    }, []);

    useEffect(() => {
        if (!restoreFocusAfterModeChangeRef.current) {
            return;
        }
        restoreFocusAfterModeChangeRef.current = false;
        if (document.activeElement !== document.body) {
            return;
        }
        moreContainerRef.current?.querySelector<HTMLElement>('[aria-label="Stop"]')?.focus();
    }, [compactMode]);

    const setMorePopoverOpen = (open: boolean): void => {
        moreOpenRef.current = open;
        setMoreOpen(open);
    };

    useEffect(() => {
        if (!moreOpen) {
            return undefined;
        }
        const closeNestedDisclosureOrMoreOnEscape = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || !(event.target instanceof Element)) {
                return;
            }
            const moreSurface = moreSurfaceRef.current;
            if (moreSurface === null) {
                return;
            }
            const openNestedTrigger = findOpenNestedTrigger(moreSurface);
            if (openNestedTrigger !== null) {
                event.preventDefault();
                event.stopPropagation();
                openNestedTrigger.click();
                openNestedTrigger.focus();
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
        return () => {
            window.removeEventListener('keydown', closeNestedDisclosureOrMoreOnEscape, true);
        };
    }, [moreOpen]);

    return (
        <Stack
            as="header"
            ref={moreContainerRef}
            shrink={false}
            className="transport-bar h-(--spacing-transport-height) border-b border-black transition-colors duration-300 relative z-50"
            style={{
                background: isRecording
                    ? 'linear-gradient(180deg, rgba(255,64,50,0.06) 0%, rgba(10,10,10,1) 40%)'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(10,10,10,1) 30%)',
                boxShadow: isRecording
                    ? 'inset 0 -1px 3px rgba(0,0,0,0.3), 0 1px 0 rgba(255,64,50,0.08), inset 0 1px 0 rgba(255,64,50,0.06)'
                    : 'inset 0 -1px 3px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03)',
                borderTop: isRecording ? '1px solid rgba(255,64,50,0.12)' : '1px solid rgba(255,255,255,0.04)',
            }}
            role="toolbar"
            aria-label="Transport controls"
        >
            {/* ── ROW 1: Meta Layer (Project, AI Copilot, Layout) ── */}
            <div
                className={cn(
                    'transport-bar__title-row desktop-titlebar-region min-h-[40px] px-2',
                    framelessChrome && 'desktop-titlebar-region--frameless',
                    overlayChrome && 'desktop-titlebar-region--overlay'
                )}
                data-testid="window-titlebar-region"
                onDoubleClick={toggleMaximizeOnTitlebarDoubleClick}
            >
                <Row gap={1} className="transport-bar__title-project min-w-0">
                    <Row
                        gap={0}
                        shrink={false}
                        className="transport-bar__project-menu-control"
                        data-testid="project-menu-control"
                    >
                        <ProjectName name={project.name} dirty={project.dirty} />
                        <RecentProjectsMenu />
                        {compactMode ? (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" aria-label="Project controls">
                                        <Ellipsis className="size-3.5" aria-hidden="true" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" aria-label="Project controls">
                                    <div className="space-y-2">
                                        <ArrangementSelector />
                                        <MissingMediaPanel />
                                    </div>
                                </PopoverContent>
                            </Popover>
                        ) : null}
                    </Row>
                    {!compactMode ? (
                        <>
                            <Sep />
                            <ArrangementSelector />
                            <MissingMediaPanel />
                        </>
                    ) : null}
                </Row>

                <Row justify="center" gap={1} className="transport-bar__title-prompt min-w-0">
                    <PromptBar />
                    <VoiceButton
                        isAvailable={voiceInputAvailable}
                        isListening={voice.isListening}
                        isTranscribing={voice.transcribing}
                        onToggle={toggleVoiceInput}
                    />
                </Row>

                <Row justify="end" gap={1} className="transport-bar__title-panels">
                    <PanelToggles
                        sidebarOpen={sidebarOpen}
                        inspectorOpen={inspectorOpen}
                        mixerOpen={mixerOpen}
                        chatPanelOpen={chatPanelOpen}
                        trackListOpen={trackListOpen}
                        virtualKeyboardOpen={virtualKeyboardOpen}
                        dualViewOpen={dualViewOpen}
                        compact={compactMode}
                    />
                    {framelessChrome ? (
                        <>
                            <Sep />
                            <WindowControls />
                        </>
                    ) : null}
                </Row>
            </div>

            {/* Visual Separator */}
            <div className="w-full h-px bg-black/40 shadow-[0_1px_0_rgba(255,255,255,0.02)] shrink-0" />

            {/* ── ROW 2: Action Layer (Transport, Tools, Chronology) ── */}
            <div
                className="transport-bar__action-row min-h-[46px] px-2"
                style={{
                    background: isRecording
                        ? 'radial-gradient(ellipse at top, rgba(255,64,50,0.1) 0%, transparent 80%)'
                        : 'none',
                }}
            >
                <Row gap={1} className="transport-bar__action-left min-w-0">
                    <span className="transport-bar__playhead">
                        <PlayheadDisplay
                            tempo={transport.tempo}
                            numerator={transport.timeSignatureNumerator}
                            timeDisplayMode={timeDisplayMode}
                        />
                    </span>
                    {!compactMode ? (
                        <span className="transport-bar__action-detail">
                            <Sep />
                            <TempoEditor />
                            <Sep />
                            <PunchRecordingControls compact />
                        </span>
                    ) : null}
                </Row>

                <TransportControls
                    isPlaying={transport.isPlaying}
                    isRecording={transport.isRecording}
                    isAudioRecording={audioState.isRecording}
                    isLooping={transport.isLooping}
                    overdubEnabled={transport.overdubEnabled}
                    showOverdub={anyMidiTrackArmed}
                    anyTrackArmed={anyTrackArmed}
                    metronomeEnabled={transport.metronomeEnabled}
                    metronomeVolume={transport.metronomeVolume}
                    punchInEnabled={transport.punchInEnabled}
                    countInEnabled={transport.countInEnabled}
                    countInBars={transport.countInBars}
                    compact={compactMode}
                />

                {!compactMode ? (
                    <Row justify="end" gap={1} className="transport-bar__action-right">
                        <AutoScrollToggle />
                        <Sep />
                        <ToolSelector rippleEditing={rippleEditing} onToggleRipple={toggleRippleEditing} />
                        <Sep />
                        <SoloModeSelector soloMode={soloMode} />
                        <Sep />
                        <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />
                    </Row>
                ) : (
                    <div className="transport-bar__action-more">
                        <Popover open={moreOpen} onOpenChange={setMorePopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    ref={moreTriggerRef}
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="More transport controls"
                                >
                                    <Ellipsis className="size-3.5" aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent ref={moreSurfaceRef} align="end" aria-label="More transport controls">
                                <div className="space-y-2">
                                    <TempoEditor />
                                    <PunchRecordingControls compact />
                                    <div className="flex items-center gap-1 border-t border-border-soft pt-2">
                                        <AutoScrollToggle />
                                        <ToolSelector
                                            rippleEditing={rippleEditing}
                                            onToggleRipple={toggleRippleEditing}
                                            compact
                                        />
                                        <SoloModeSelector soloMode={soloMode} compact />
                                        <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                )}
            </div>
        </Stack>
    );
};
