import { type ReactElement, useState, useRef } from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { clipSelectionStore, defaultClipSelectionState } from '#/modules/Arrangement/stores';
import { selectClip } from '#/modules/Arrangement/useCases';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { setWorkspaceMode } from '#/modules/WorkspaceShell/useCases';

import { useTracks } from '../hooks/useTracks';

import { ClipEditorTray } from './ClipEditorTray';
import { AutomationLane } from './ClipView/AutomationLane';
import { KneadEditor } from './ClipView/KneadEditor';
import { PianoRoll } from './ClipView/PianoRoll';
import { WaveformEditor } from './ClipView/WaveformEditor';

export const ClipView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((time) => time.id === selectedTrackId);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    // beatWidth is reported by PianoRoll when its zoom changes
    const [pianoRollBeatWidth, setPianoRollBeatWidth] = useState(40);
    const [pianoRollContentWidth, setPianoRollContentWidth] = useState(0);
    const automationScrollRef = useRef<HTMLDivElement>(null);
    const [audioEditMode, setAudioEditMode] = useState<'waveform' | 'pitch'>('waveform');

    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);

    // Hooks must precede the no-track early return; the selected-clip
    // derivation is pure, so it moves up with them.
    const selectedClip =
        selectedTrack?.clips.find((context) => context.id === clipSelection.selectedClipId) ??
        selectedTrack?.clips[0] ??
        null;

    // Live note count for the selected MIDI clip — the dock's only DOM
    // readout of clip content, so recording and editing flows are observable
    // outside the canvas.
    const selectedClipNoteCount = useStoreSelector(midiStore, (state: MidiStoreState | null) =>
        selectedClip?.type === 'midi' ? (state?.notesByClipId[selectedClip.id]?.length ?? 0) : 0
    );

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

    // A9: collect all selected MIDI clip IDs across all tracks for multi-clip editing
    const openedClipIds: string[] | undefined = (() => {
        const ids = clipSelection.selectedClipIds;
        if (ids.length <= 1) {
            return undefined;
        }
        const midiClipIds = ids.filter((id) =>
            tracks.some((time) => time.kind === 'midi' && time.clips.some((context) => context.id === id))
        );
        return midiClipIds.length > 1 ? midiClipIds : undefined;
    })();

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
    const renderIife_8 = () => {
        if (selectedTrack.kind === 'audio' && selectedClip) {
            return (
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
            );
        } else {
            return null;
        }
    };
    const renderIife_9 = () => {
        if (selectedTrack.kind === 'midi' && selectedClip) {
            return (
                <PianoRoll
                    clipId={selectedClip.id}
                    trackId={selectedTrack.id}
                    openedClipIds={openedClipIds}
                    selectedNoteIds={selectedNoteIds}
                    onSelectedNoteIdsChange={setSelectedNoteIds}
                    onScrollChange={handlePianoRollScroll}
                    onBeatWidthChange={setPianoRollBeatWidth}
                    onContentWidthChange={setPianoRollContentWidth}
                />
            );
        } else {
            if (selectedClip && audioEditMode === 'pitch') {
                return <KneadEditor trackId={selectedTrack.id} clipId={selectedClip.id} />;
            } else {
                if (selectedClip) {
                    return <WaveformEditor clipId={selectedClip.id} audioBufferId={selectedClip.audioBufferId} />;
                } else {
                    return (
                        <div className="flex flex-1 p-4">
                            <DawEmptyState
                                compact
                                className="flex-1"
                                title="No clips on this track"
                                description="Add or record a clip in Arrange view, then return here to edit it."
                            />
                        </div>
                    );
                }
            }
        }
    };

    return (
        <DawPanelSurface>
            <DawControlStrip className="px-3 py-1.5">
                <span className="text-xs font-medium text-foreground">{selectedTrack.name}</span>
                {selectedClip ? <span className="text-xs text-muted-foreground">— {selectedClip.name}</span> : null}
                {selectedClip ? (
                    <span
                        className="text-[10px] text-muted-foreground/60"
                        data-testid="selected-clip-start-beat"
                        aria-label={`Selected clip starts at beat ${selectedClip.startBeat}`}
                    >
                        @ {selectedClip.startBeat} beats
                    </span>
                ) : null}
                <span
                    className="text-[10px] text-muted-foreground/60"
                    data-testid="selected-track-clip-count"
                    aria-label={`${selectedTrack.clips.length} clips on ${selectedTrack.name}`}
                >
                    {selectedTrack.clips.length} clip{selectedTrack.clips.length === 1 ? '' : 's'}
                </span>
                {selectedClip?.type === 'midi' ? (
                    <span
                        className="text-[10px] text-muted-foreground/60"
                        data-testid="selected-clip-note-count"
                        aria-label={`${selectedClipNoteCount} notes in ${selectedClip.name}`}
                    >
                        {selectedClipNoteCount} note{selectedClipNoteCount === 1 ? '' : 's'}
                    </span>
                ) : null}
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
                {renderIife_8()}
            </DawControlStrip>
            <div className="flex flex-1 overflow-hidden">{renderIife_9()}</div>
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
