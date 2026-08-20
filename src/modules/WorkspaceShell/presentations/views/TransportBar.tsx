import { type ReactElement } from 'react';

import { useStore } from '#/infra/store/useStore';
import { voiceStatusStore } from '#/modules/AiRuntime/stores';
import { isVoiceInputAvailable, toggleVoiceInput } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { RecentProjectsMenu, ArrangementSelector, MissingMediaPanel } from '#/modules/Project/presentations/views';
import { PunchRecordingControls } from '#/modules/PunchRecording/presentations/views';
import { TempoEditor } from '#/modules/TimelineEditor/presentations/views';

import { type Track } from '../../models/TrackViewTypes';
import { toggleRippleEditing } from '../../useCases/rippleEditing';
import { VoiceButton } from '../components/Transport/VoiceButton';
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

const getTracks = (state: { tracks: Track[] } | null): Track[] => state?.tracks ?? [];

/** Lit-edge separator that follows the NW light source model from the design system */
const Sep = (): ReactElement => <div className="mx-0.5 h-5 w-px shrink-0 daw-seam" />;

export const TransportBar = (): ReactElement => {
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
    const voiceInputAvailable = isVoiceInputAvailable();
    const anyTrackArmed = tracks.some((time) => time.armed);
    const anyMidiTrackArmed = tracks.some((time) => time.armed && time.kind === 'midi');

    const isRecording = transport.isRecording;

    return (
        <header
            className="flex flex-col h-(--spacing-transport-height) shrink-0 border-b border-black transition-colors duration-300 relative z-50"
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
                className="desktop-titlebar-region flex w-full flex-1 min-h-[40px] items-center px-2"
                data-testid="window-titlebar-region"
            >
                {/* Left wing (flex-1 basis-0 ensures the center is absolutely geometrically centered) */}
                <div className="flex flex-1 basis-0 justify-start items-center gap-1 min-w-0">
                    <ProjectName name={project.name} dirty={project.dirty} />
                    <RecentProjectsMenu />
                    <Sep />
                    <ArrangementSelector />
                    <MissingMediaPanel />
                </div>

                {/* Center stage */}
                <div className="flex shrink-0 justify-center items-center gap-1 w-[40vw] max-w-[800px] min-w-[300px]">
                    <PromptBar />
                    <VoiceButton
                        isAvailable={voiceInputAvailable}
                        isListening={voice.isListening}
                        isTranscribing={voice.transcribing}
                        onToggle={toggleVoiceInput}
                    />
                </div>

                {/* Right wing */}
                <div className="flex flex-1 basis-0 justify-end items-center gap-1 min-w-0">
                    <PanelToggles
                        sidebarOpen={sidebarOpen}
                        inspectorOpen={inspectorOpen}
                        mixerOpen={mixerOpen}
                        chatPanelOpen={chatPanelOpen}
                        trackListOpen={trackListOpen}
                        virtualKeyboardOpen={virtualKeyboardOpen}
                        dualViewOpen={dualViewOpen}
                    />
                </div>
            </div>

            {/* Visual Separator */}
            <div className="w-full h-px bg-black/40 shadow-[0_1px_0_rgba(255,255,255,0.02)] shrink-0" />

            {/* ── ROW 2: Action Layer (Transport, Tools, Chronology) ── */}
            <div
                className="flex w-full flex-1 min-h-[46px] items-center px-2"
                style={{
                    background: isRecording
                        ? 'radial-gradient(ellipse at top, rgba(255,64,50,0.1) 0%, transparent 80%)'
                        : 'none',
                }}
            >
                {/* Left wing: Time and Tempo */}
                <div className="flex flex-1 basis-0 justify-start items-center gap-1 min-w-0">
                    <PlayheadDisplay
                        tempo={transport.tempo}
                        numerator={transport.timeSignatureNumerator}
                        timeDisplayMode={timeDisplayMode}
                    />
                    <Sep />
                    <TempoEditor />
                    <Sep />
                    <PunchRecordingControls />
                </div>

                {/* Center stage: Core Transport */}
                <div className="flex shrink-0 justify-center items-center gap-1">
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
                    />
                </div>

                {/* Right wing: Editing Tools */}
                <div className="flex flex-1 basis-0 justify-end items-center gap-1 min-w-0">
                    <AutoScrollToggle />
                    <Sep />
                    <ToolSelector rippleEditing={rippleEditing} onToggleRipple={toggleRippleEditing} />
                    <Sep />
                    <SoloModeSelector soloMode={soloMode} />
                    <Sep />
                    <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />
                </div>
            </div>
        </header>
    );
};
