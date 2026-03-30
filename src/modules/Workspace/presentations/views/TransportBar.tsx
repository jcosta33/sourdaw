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
import { SoloModeSelector } from './Transport/SoloModeSelector';
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
    <div
        className="w-px h-5 mx-0.5 shrink-0"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)' }}
    />
);

export const TransportBar = (): ReactElement => {
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        chatPanelOpen,
        trackListOpen,
        soloMode,
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

    const isRecording = transport.isRecording;

    return (
        <header
            className="flex h-(--spacing-transport-height) shrink-0 items-center gap-1 border-b border-black px-2 transition-colors duration-300"
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
            {/* ── Left group: Project + Transport + Position ── */}
            <div className="flex items-center gap-1 shrink-0">
                <div className="flex items-center">
                    <ProjectName name={project.name} dirty={project.dirty} />
                    <RecentProjectsMenu />
                </div>

                <Sep />

                <ArrangementSelector />

                <Sep />

                <TransportControls
                    isPlaying={transport.isPlaying}
                    isRecording={transport.isRecording}
                    isAudioRecording={audioState.isRecording}
                    isLooping={transport.isLooping}
                    overdubEnabled={transport.overdubEnabled}
                    metronomeEnabled={transport.metronomeEnabled}
                    metronomeVolume={transport.metronomeVolume}
                    punchInEnabled={transport.punchInEnabled}
                    countInEnabled={transport.countInEnabled}
                    preRollEnabled={transport.preRollEnabled}
                    anyTrackArmed={anyTrackArmed}
                />

                <AutoScrollToggle />

                <Sep />

                <SoloModeSelector soloMode={soloMode} />

                <Sep />

                <PlayheadDisplay
                    tempo={transport.tempo}
                    numerator={transport.timeSignatureNumerator}
                    timeDisplayMode={timeDisplayMode}
                />

                <Sep />

                <TempoEditor />
            </div>

            {/* ── Center group: Tools + Undo/Redo + Prompt ── */}
            <Sep />

            <ToolSelector rippleEditing={rippleEditing} onToggleRipple={toggleRippleEditing} />

            <Sep />

            <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />

            <Sep />

            <div className="flex-1 min-w-0 flex items-center gap-1">
                <PromptBar />
                <VoiceButton />
            </div>

            {/* ── Right group: Panel toggles ── */}
            <Sep />

            <PanelToggles
                sidebarOpen={sidebarOpen}
                inspectorOpen={inspectorOpen}
                mixerOpen={mixerOpen}
                chatPanelOpen={chatPanelOpen}
                trackListOpen={trackListOpen}
                virtualKeyboardOpen={virtualKeyboardOpen}
            />
        </header>
    );
};
