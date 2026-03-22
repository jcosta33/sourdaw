import { type ReactElement, useState, useRef, useSyncExternalStore } from 'react';
import { useTracks } from '../hooks/useTracks';
import { Button } from '#/components/ui/button';
import { setWorkspaceMode } from '../../useCases/setWorkspaceMode';
import { workspaceStore } from '../../stores/workspaceStore';

import { PianoRoll } from './ClipView/PianoRoll';
import { WaveformEditor } from './ClipView/WaveformEditor';
import { AutomationLane } from './ClipView/AutomationLane';

const GRID_BEATS = 32;

export const ClipView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    // beatWidth is reported by PianoRoll when its zoom changes
    const [pianoRollBeatWidth, setPianoRollBeatWidth] = useState(40);
    const automationScrollRef = useRef<HTMLDivElement>(null);

    const wsState = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(() => cb()),
        () => workspaceStore.value,
        () => workspaceStore.value
    );

    if (!selectedTrack) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3">
                <p className="text-sm text-muted-foreground">Select a track to edit clips</p>
                <Button variant="outline" size="sm" onClick={() => setWorkspaceMode('arrange')}>
                    Back to Arrange
                </Button>
            </div>
        );
    }

    const selectedClip =
        selectedTrack.clips.find((c) => c.id === wsState?.selectedClipId) ?? selectedTrack.clips[0] ?? null;

    const selectClip = (clipId: string) => {
        if (!wsState) {
            return;
        }
        workspaceStore.set({ ...wsState, selectedClipId: clipId });
    };

    const contentWidth = GRID_BEATS * pianoRollBeatWidth;

    const handlePianoRollScroll = (sl: number) => {
        // Sync automation lane scroll
        if (automationScrollRef.current) {
            automationScrollRef.current.scrollLeft = sl;
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
                <span className="text-xs font-medium text-foreground">{selectedTrack.name}</span>
                {selectedClip && <span className="text-xs text-muted-foreground">— {selectedClip.name}</span>}
                {selectedTrack.clips.length > 1 && (
                    <div className="flex items-center gap-1 ml-2">
                        {selectedTrack.clips.map((clip) => (
                            <Button
                                key={clip.id}
                                variant={clip.id === selectedClip?.id ? 'secondary' : 'ghost'}
                                size="icon-xs"
                                className="h-5 w-auto px-1.5 text-[9px]"
                                onClick={() => selectClip(clip.id)}
                            >
                                {clip.name}
                            </Button>
                        ))}
                    </div>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="xs" onClick={() => setWorkspaceMode('arrange')}>
                    Back
                </Button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {selectedTrack.kind === 'midi' && selectedClip ? (
                    <PianoRoll
                        clipId={selectedClip.id}
                        trackId={selectedTrack.id}
                        selectedNoteIds={selectedNoteIds}
                        onSelectedNoteIdsChange={setSelectedNoteIds}
                        onScrollChange={handlePianoRollScroll}
                        onBeatWidthChange={setPianoRollBeatWidth}
                    />
                ) : selectedClip ? (
                    <WaveformEditor clipId={selectedClip.audioBufferId ?? selectedClip.id} />
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <p className="text-xs text-muted-foreground">No clips on this track. Add a clip first.</p>
                    </div>
                )}
            </div>

            <div className="h-28 border-t border-border/50">
                <AutomationLane
                    clipId={selectedClip?.id ?? null}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={pianoRollBeatWidth}
                    contentWidth={contentWidth}
                    scrollRef={automationScrollRef}
                />
            </div>
        </div>
    );
};
