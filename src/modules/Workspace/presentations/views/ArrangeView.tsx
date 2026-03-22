import { type ReactElement, type DragEvent, useSyncExternalStore, useState, useRef, useEffect } from 'react';
import { TimelineSurface } from '#/modules/Timeline/presentations/views/TimelineSurface';
import { TimelineMinimap } from '#/modules/Timeline/presentations/views/TimelineMinimap';
import { ArrangementBar } from '#/modules/Timeline/presentations/views/ArrangementBar';
import { MarkerLane } from '#/modules/Timeline/presentations/views/MarkerLane';
import { BeatRulerBar } from '#/modules/Timeline/presentations/views/BeatRulerBar';
import { timelineViewStore } from '#/modules/Timeline/stores/timelineViewStore';
import { TrackListView } from '#/modules/Track/presentations/views/TrackListView';
import { useTracks } from '../hooks/useTracks';
import { addTrack, addClip, decodeAudioFile, importMidiFile } from '../../useCases/workspaceViewActions';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { useWorkspaceState } from '#/modules/Workspace/presentations/hooks/useWorkspaceState';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { ResizeHandle } from '#/modules/Workspace/presentations/components/ResizeHandle';
import { Button } from '#/components/ui/button';
import { Music, Piano, Plus, Upload } from 'lucide-react';
import { ChordTrackLane } from './timeline/ChordTrackLane';
import { ScratchPadView } from './timeline/ScratchPadView';
import { chordTrackStore } from '#/modules/Track/stores/chordTrackStore';

const TRACK_LIST_MIN = 120;
const TRACK_LIST_MAX = 400;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export const ArrangeView = (): ReactElement => {
    const { tracks } = useTracks();
    const { trackListOpen, trackListWidth, scratchPadOpen, scratchPadHeight } = useWorkspaceState();

    const [localTrackListWidth, setLocalTrackListWidth] = useState(trackListWidth);
    const trackListWidthRef = useRef(localTrackListWidth);

    useEffect(() => {
        setLocalTrackListWidth(trackListWidth);
    }, [trackListWidth]);

    const handleTrackListResize = (delta: number): void => {
        setLocalTrackListWidth((prev) => {
            const next = clamp(prev + delta, TRACK_LIST_MIN, TRACK_LIST_MAX);
            trackListWidthRef.current = next;
            return next;
        });
    };

    const handleTrackListResizeEnd = (): void => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, trackListWidth: trackListWidthRef.current });
        }
    };

    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value,
        () => timelineViewStore.value
    );

    const markerState = useSyncExternalStore(
        (cb) => markerStore.subscribe(() => cb()),
        () => markerStore.value,
        () => markerStore.value
    );

    const chordState = useSyncExternalStore(
        (cb) => chordTrackStore.subscribe(cb),
        () => chordTrackStore.value,
        () => chordTrackStore.value
    );

    const hasMarkers = (markerState?.markers.length ?? 0) > 0;
    const hasChords = (chordState?.events.length ?? 0) > 0 || (chordState?.enabled ?? false);
    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;

    return (
        <div className="flex h-full">
            {trackListOpen && (
                <>
                    <TrackListView
                        style={{ width: localTrackListWidth }}
                        extraHeaderHeight={22 + (hasMarkers ? 20 : 0) + 28 + 22 + (hasChords ? 26 : 0)}
                    />
                    <ResizeHandle
                        direction="vertical"
                        onResize={handleTrackListResize}
                        onResizeEnd={handleTrackListResizeEnd}
                    />
                </>
            )}
            <div className="flex flex-1 flex-col overflow-hidden relative">
                <ArrangementBar pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
                {hasMarkers && <MarkerLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />}
                <TimelineMinimap />
                <BeatRulerBar />
                {hasChords && <ChordTrackLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />}
                <TimelineSurface />
                {tracks.length === 0 && <EmptyArrangeOverlay />}
                {scratchPadOpen && (
                    <ScratchPadView
                        height={scratchPadHeight}
                        onToggle={() => {
                            const ws = workspaceStore.value;
                            if (ws) {
                                workspaceStore.set({ ...ws, scratchPadOpen: false });
                            }
                        }}
                    />
                )}
            </div>
        </div>
    );
};

const EmptyArrangeOverlay = (): ReactElement => {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const currentBeat = 0;

        for (const file of files) {
            const ext = file.name.toLowerCase().split('.').pop() ?? '';
            if (['mid', 'midi'].includes(ext) || file.type === 'audio/midi') {
                await importMidiFile(file);
                continue;
            }

            const isAudio =
                file.type.startsWith('audio/') ||
                ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'aiff', 'aif'].includes(ext);
            if (!isAudio) {
                continue;
            }

            const newTrack = addTrack({ name: file.name.replace(/\.[^.]+$/, ''), kind: 'audio' });
            if (!newTrack) {
                continue;
            }

            try {
                const { id: bufferId, buffer } = await decodeAudioFile(file);
                const tempo = transportStore.value?.tempo ?? 120;
                const durationBeats = Math.max(4, Math.ceil((buffer.duration / 60) * tempo));

                addClip({
                    trackId: newTrack.id,
                    startBeat: currentBeat,
                    endBeat: currentBeat + durationBeats,
                    name: file.name.replace(/\.[^.]+$/, ''),
                    type: 'audio',
                    audioBufferId: bufferId,
                });
            } catch {
                document.dispatchEvent(
                    new CustomEvent('webdaw:notify', {
                        detail: {
                            message: `Failed to import "${file.name}" — unsupported format or corrupt file`,
                            level: 'error',
                        },
                    })
                );
            }
        }
    };

    return (
        <div
            className="absolute inset-0 flex items-center justify-center bg-surface-base/80 backdrop-blur-sm z-10 pointer-events-auto"
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setIsDragOver(true);
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDragOver(false);
                }
            }}
            onDrop={handleDrop}
        >
            <div
                className={`flex flex-col items-center gap-4 p-8 rounded-xl bg-surface-overlay/90 border shadow-[0_8px_32px_rgba(0,0,0,0.6)] max-w-sm transition-colors ${isDragOver ? 'border-primary border-2 bg-primary/5' : 'border-border-soft border-t-[var(--color-light-edge)]'}`}
            >
                <div className="flex items-center gap-2">
                    <Music className="size-6 text-muted-foreground" />
                    <h2 className="text-lg font-semibold text-foreground">Welcome to WebDAW</h2>
                </div>

                <p className="text-sm text-muted-foreground text-center">
                    Start by adding a track, dropping audio/MIDI files, or type a command.
                </p>

                <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => addTrack({ name: 'Audio 1', kind: 'audio' })}>
                        <Plus className="size-3.5 mr-1" />
                        Audio Track
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => addTrack({ name: 'MIDI 1', kind: 'midi' })}>
                        <Piano className="size-3.5 mr-1" />
                        MIDI Track
                    </Button>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground/80 mt-1">
                    <Upload className="size-3.5" />
                    <span>Drop audio or MIDI files here to get started</span>
                </div>

                <div className="text-[10px] text-muted-foreground/60 space-y-0.5 text-center">
                    <p>Space to play/pause · R to record · L to loop</p>
                    <p>⌘K for command palette · Hold V for voice</p>
                </div>
            </div>
        </div>
    );
};
