import { type ReactElement, useSyncExternalStore } from 'react';
import { Separator } from '#/components/ui/separator';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { useTransportState } from '../hooks/useTransportState';
import { useUndoState } from '../hooks/useUndoState';
import { useProjectState } from '../hooks/useProjectState';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { type Track } from '../../useCases/workspaceViewActions';
import { TransportControls } from './transport/TransportControls';
import { AutoScrollToggle } from '../components/transport/AutoScrollToggle';
import { SoloModeSelector } from './transport/SoloModeSelector';
import { PlayheadDisplay } from '../components/transport/PlayheadDisplay';
import { UndoRedoButtons } from './transport/UndoRedoButtons';
import { VoiceButton } from '../components/transport/VoiceButton';
import { PanelToggles } from './transport/PanelToggles';
import { ProjectName } from './transport/ProjectName';
import { PromptBar } from './PromptBar';
import { ToolSelector } from './ToolSelector';
import { TempoEditor } from './TempoEditor';
import { RecentProjectsMenu } from '#/modules/Project/presentations/views/RecentProjectsMenu';
import { ArrangementSelector } from '#/modules/Project/presentations/views/ArrangementSelector';
import { toggleRippleEditing } from '../../useCases/rippleEditing';
import { Button } from '#/components/ui/button';

const subscribeTrackStore = (cb: () => void) => trackStore.subscribe(() => cb());
const getTrackStoreSnapshot = (): Track[] => trackStore.value?.tracks ?? [];

export const TransportBar = (): ReactElement => {
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        automationPanelOpen,
        chatPanelOpen,
        trackListOpen,
        soloMode,
        timeDisplayMode,
        rippleEditing,
    } = useWorkspaceState();
    const transport = useTransportState();
    const undoState = useUndoState();
    const project = useProjectState();

    const tracks = useSyncExternalStore(subscribeTrackStore, getTrackStoreSnapshot, getTrackStoreSnapshot);
    const anyTrackArmed = tracks.some((t) => t.armed);

    return (
        <header
            className="flex h-(--spacing-transport-height) shrink-0 items-center gap-1 border-b border-black bg-surface-app px-2"
            role="toolbar"
            aria-label="Transport controls"
        >
            {/* ── Left group: Project + Transport + Position ── */}
            <div className="flex items-center gap-1 shrink-0">
                <div className="flex items-center">
                    <ProjectName name={project.name} dirty={project.dirty} />
                    <RecentProjectsMenu />
                </div>

                <Separator orientation="vertical" className="mx-0.5 h-5" />

                <ArrangementSelector />

                <Separator orientation="vertical" className="mx-0.5 h-5" />

                <TransportControls
                    isPlaying={transport.isPlaying}
                    isRecording={transport.isRecording}
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

                <Separator orientation="vertical" className="mx-0.5 h-5" />

                <SoloModeSelector soloMode={soloMode} />

                <Separator orientation="vertical" className="mx-0.5 h-5" />

                <PlayheadDisplay
                    position={transport.playheadPosition}
                    tempo={transport.tempo}
                    numerator={transport.timeSignatureNumerator}
                    timeDisplayMode={timeDisplayMode}
                />

                <Separator orientation="vertical" className="mx-0.5 h-5" />

                <TempoEditor />
            </div>

            {/* ── Center group: Tools + Undo/Redo + Prompt ── */}
            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <ToolSelector />

            <Button
                variant={rippleEditing ? 'secondary' : 'ghost'}
                size="xs"
                onClick={toggleRippleEditing}
                className={rippleEditing ? 'text-orange-400 border-orange-400/30 px-1.5' : 'px-1.5'}
                aria-pressed={rippleEditing}
                aria-label="Toggle ripple editing"
                title="Ripple Editing (auto-shift clips on delete)"
            >
                <span className="text-[10px] font-bold">R</span>
            </Button>

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <div className="flex-1 min-w-0 flex items-center gap-1">
                <PromptBar />
                <VoiceButton />
            </div>

            {/* ── Right group: Panel toggles ── */}
            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <PanelToggles
                sidebarOpen={sidebarOpen}
                inspectorOpen={inspectorOpen}
                automationPanelOpen={automationPanelOpen}
                mixerOpen={mixerOpen}
                chatPanelOpen={chatPanelOpen}
                trackListOpen={trackListOpen}
            />
        </header>
    );
};
