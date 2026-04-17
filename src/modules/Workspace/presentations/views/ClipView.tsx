import { type ReactElement, useState, useRef } from 'react';
import { useTracks } from '../hooks/useTracks';
import { Button } from '#/components/ui/button';
import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { setWorkspaceMode } from '../../useCases/setWorkspaceMode';
import { selectClip } from '../../useCases/togglePanel/panelToggles/selectClip';
import { workspaceStore } from '../../stores/workspaceStore';
import { useStore } from '#/infra/store/useStore';
import { defaultWorkspaceState } from '../../models/WorkspaceState';

import { PianoRoll } from './ClipView/PianoRoll';
import { WaveformEditor } from './ClipView/WaveformEditor';
import { AutomationLane } from './ClipView/AutomationLane';
import { KneadEditor } from './ClipView/KneadEditor';
import { ClipEditorTray } from './ClipEditorTray';

export const ClipView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    // beatWidth is reported by PianoRoll when its zoom changes
    const [pianoRollBeatWidth, setPianoRollBeatWidth] = useState(40);
    const [pianoRollContentWidth, setPianoRollContentWidth] = useState(0);
    const automationScrollRef = useRef<HTMLDivElement>(null);
    const [audioEditMode, setAudioEditMode] = useState<'waveform' | 'pitch'>('waveform');

    const wsState = useStore(workspaceStore, defaultWorkspaceState);

    if (!selectedTrack) {
        return (
            <div className="flex h-full p-4">
                <DawBlockedState
                    eyebrow="Clip Editor"
                    className="flex-1"
                    title="Select a track to edit clips"
                    description="Choose a track in the arrangement, then return here to edit notes, audio, and clip automation."
                    summary="The editor follows the currently selected arrange track and opens its clips inline."
                    action={
                        <Button variant="outline" size="sm" onClick={() => setWorkspaceMode('arrange')}>
                            Back to Arrange
                        </Button>
                    }
                />
            </div>
        );
    }

    const selectedClip =
        selectedTrack.clips.find((c) => c.id === wsState?.selectedClipId) ?? selectedTrack.clips[0] ?? null;

    const handleSelectClip = (clipId: string): void => {
        selectClip(clipId);
    };

    const contentWidth = pianoRollContentWidth;

    const handlePianoRollScroll = (sl: number) => {
        // Sync automation lane scroll
        if (automationScrollRef.current) {
            automationScrollRef.current.scrollLeft = sl;
        }
    };

    return (
        <DawPanelSurface>
            <DawControlStrip className="px-3 py-1.5">
                <span className="text-xs font-medium text-foreground">{selectedTrack.name}</span>
                {selectedClip ? <span className="text-xs text-muted-foreground">— {selectedClip.name}</span> : null}
                {selectedTrack.clips.length > 1 ? (
                    <div className="flex items-center gap-1 ml-2">
                        {selectedTrack.clips.map((clip) => (
                            <Button
                                key={clip.id}
                                variant={clip.id === selectedClip?.id ? 'secondary' : 'ghost'}
                                size="icon-xs"
                                className="h-5 w-auto px-1.5 text-[9px]"
                                onClick={() => handleSelectClip(clip.id)}
                            >
                                {clip.name}
                            </Button>
                        ))}
                    </div>
                ) : null}
                {selectedTrack.kind === 'audio' && selectedClip ? (
                    <div className="flex items-center gap-1 ml-4 bg-muted/50 p-0.5 rounded-md">
                        <Button
                            variant={audioEditMode === 'waveform' ? 'secondary' : 'ghost'}
                            size="xs"
                            className="h-5 px-2 text-[10px]"
                            onClick={() => setAudioEditMode('waveform')}
                        >
                            Waveform
                        </Button>
                        <Button
                            variant={audioEditMode === 'pitch' ? 'secondary' : 'ghost'}
                            size="xs"
                            className="h-5 px-2 text-[10px]"
                            onClick={() => setAudioEditMode('pitch')}
                        >
                            Knead (Pitch)
                        </Button>
                    </div>
                ) : null}
            </DawControlStrip>

            <div className="flex flex-1 overflow-hidden">
                {selectedTrack.kind === 'midi' && selectedClip ? (
                    <PianoRoll
                        clipId={selectedClip.id}
                        trackId={selectedTrack.id}
                        selectedNoteIds={selectedNoteIds}
                        onSelectedNoteIdsChange={setSelectedNoteIds}
                        onScrollChange={handlePianoRollScroll}
                        onBeatWidthChange={setPianoRollBeatWidth}
                        onContentWidthChange={setPianoRollContentWidth}
                    />
                ) : selectedClip && audioEditMode === 'pitch' ? (
                    <KneadEditor trackId={selectedTrack.id} clipId={selectedClip.id} />
                ) : selectedClip ? (
                    <WaveformEditor clipId={selectedClip.audioBufferId ?? selectedClip.id} />
                ) : (
                    <div className="flex flex-1 p-4">
                        <DawEmptyState
                            compact
                            className="flex-1"
                            title="No clips on this track"
                            description="Add or record a clip in Arrange view, then return here to edit it."
                        />
                    </div>
                )}
            </div>

            <ClipEditorTray className="h-28">
                <AutomationLane
                    clipId={selectedClip?.id ?? null}
                    trackId={selectedTrack.id}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={pianoRollBeatWidth}
                    contentWidth={contentWidth}
                    scrollRef={automationScrollRef}
                />
            </ClipEditorTray>
        </DawPanelSurface>
    );
};
