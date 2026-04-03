import { type ReactElement, useSyncExternalStore } from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { useTransportState } from '../hooks/useTransportState';
import { useAudioRecordingState } from '../hooks/useAudioRecordingState';
import { useUndoState } from '../hooks/useUndoState';
import { useProjectState } from '../hooks/useProjectState';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';
import { TransportControls } from './Transport/TransportControls';
import { AutoScrollToggle } from './Transport/AutoScrollToggle';
import { PlayheadDisplay } from './Transport/PlayheadDisplay';
import { UndoRedoButtons } from './Transport/UndoRedoButtons';
import { VoiceButton } from '../components/Transport/VoiceButton';
import { PanelToggles } from './Transport/PanelToggles';
import { ProjectName } from './Transport/ProjectName';
import { PromptBar } from './PromptBar';
import { ToolSelector } from './ToolSelector';
import { TempoEditor } from './TempoEditor';
import { RecentProjectsMenu } from '#/modules/Project/presentations/views/RecentProjectsMenu';
import { ArrangementSelector } from '#/modules/Project/presentations/views/ArrangementSelector';
import { toggleRippleEditing } from '../../useCases/rippleEditing';

const subscribeTrackStore = (cb: () => void) => trackStore.subscribe(() => cb());
const getTrackStoreSnapshot = (): Track[] => trackStore.value?.tracks ?? [];

/** Lit-edge separator that follows the NW light source model from the design system */
const Sep = (): ReactElement => (
    <div className="mx-0.5 h-5 w-px shrink-0 daw-seam" />
);

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
    } = useWorkspaceState();
    const transport = useTransportState();
    const audioState = useAudioRecordingState();
    const undoState = useUndoState();
    const project = useProjectState();

    const tracks = useSyncExternalStore(subscribeTrackStore, getTrackStoreSnapshot, getTrackStoreSnapshot);
    const anyTrackArmed = tracks.some((t) => t.armed);
    const anyMidiTrackArmed = tracks.some((t) => t.armed && t.kind === 'midi');

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
                borderTop: isRecording
                    ? '1px solid rgba(255,64,50,0.12)'
                    : '1px solid rgba(255,255,255,0.04)',
            }}
            role="toolbar"
            aria-label="Transport controls"
        >
            {/* ── ROW 1: Meta Layer (Project, AI Copilot, Layout) ── */}
            <div className="flex w-full flex-1 min-h-[40px] items-center px-2">
                {/* Left wing (flex-1 basis-0 ensures the center is absolutely geometrically centered) */}
                <div className="flex flex-1 basis-0 justify-start items-center gap-1 min-w-0">
                    <ProjectName name={project.name} dirty={project.dirty} />
                    <RecentProjectsMenu />
                    <Sep />
                    <ArrangementSelector />
                </div>

                {/* Center stage */}
                <div className="flex shrink-0 justify-center items-center gap-1 w-[40vw] max-w-[800px] min-w-[300px]">
                    <PromptBar />
                    <VoiceButton />
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
                    />
                </div>
            </div>

            {/* Visual Separator */}
            <div className="w-full h-px bg-black/40 shadow-[0_1px_0_rgba(255,255,255,0.02)] shrink-0" />

            {/* ── ROW 2: Action Layer (Transport, Tools, Chronology) ── */}
            <div className="flex w-full flex-1 min-h-[46px] items-center px-2"
                 style={{
                     background: isRecording 
                        ? 'radial-gradient(ellipse at top, rgba(255,64,50,0.1) 0%, transparent 80%)' 
                        : 'none'
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
                    <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />
                </div>
            </div>
        </header>
    );
};
