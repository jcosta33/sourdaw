import { type ReactElement, type DragEvent, useSyncExternalStore, useState, useRef, useEffect } from 'react';
import { TimelineSurface } from '#/modules/Arrangement/presentations/views/TimelineSurface';
import { TimelineMinimap } from '#/modules/Arrangement/presentations/views/TimelineMinimap';
import { ArrangementBar } from '#/modules/Arrangement/presentations/views/ArrangementBar';
import { MarkerLane } from '#/modules/Arrangement/presentations/views/MarkerLane';
import { BeatRulerBar } from '#/modules/Arrangement/presentations/views/BeatRulerBar';
import { timelineViewStore } from '#/modules/Arrangement/stores/timelineViewStore';
import { TrackListView } from '#/modules/Arrangement/presentations/views/TrackListView';
import { useTracks } from '../hooks/useTracks';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { decodeAudioFile } from '#/modules/Arrangement/useCases/trackViewActions';
import { importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { useWorkspaceState } from '#/modules/Workspace/presentations/hooks/useWorkspaceState';
import { setTrackListWidth } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { closeScratchPad } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { ResizeHandle } from '#/modules/Workspace/presentations/components/ResizeHandle';
import { Button } from '#/components/ui/button';
import { Music, Piano, Plus, Upload, LayoutTemplate } from 'lucide-react';
import { ChordTrackLane } from './Timeline/ChordTrackLane';
import { ScratchPadView } from './Timeline/ScratchPadView';
import { chordTrackStore } from '#/modules/Arrangement/stores/chordTrackStore';
import { TemplateChooser } from '#/modules/Project/presentations/views/TemplateChooser';
import { clamp } from '#/helpers/Math/clamp';

const TRACK_LIST_MIN = 120;
const TRACK_LIST_MAX = 400;

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
        setTrackListWidth(trackListWidthRef.current);
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
            {trackListOpen ? (
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
            ) : null}
            <div className="flex flex-1 flex-col overflow-hidden relative">
                <ArrangementBar pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
                {hasMarkers ? <MarkerLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                <TimelineMinimap />
                <BeatRulerBar />
                {hasChords ? <ChordTrackLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                <TimelineSurface />
                {tracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder').length === 0 ? (
                    <EmptyArrangeOverlay />
                ) : null}
                {scratchPadOpen ? <ScratchPadView height={scratchPadHeight} onToggle={closeScratchPad} /> : null}
            </div>
        </div>
    );
};

const EmptyArrangeOverlay = (): ReactElement => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
    const [templateChooserCategory, setTemplateChooserCategory] = useState<
        import('#/modules/Project/useCases/projectTemplates').TemplateCategory | 'all'
    >('all');

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
                notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
            }
        }
    };

    return (
        <>
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
                    className={`flex flex-col items-center gap-4 p-8 rounded-xl bg-surface-overlay/90 border shadow-[0_8px_32px_rgba(0,0,0,0.6)] max-w-md transition-colors ${isDragOver ? 'border-primary border-2 bg-primary/5' : 'border-border-soft border-t-[var(--color-light-edge)]'}`}
                >
                    <div className="flex items-center gap-2">
                        <Music className="size-6 text-muted-foreground" />
                        <h2 className="text-lg font-semibold text-foreground">Welcome to Sourdaw</h2>
                    </div>

                    <p className="text-sm text-muted-foreground text-center">
                        Start by adding a track, dropping audio/MIDI files, or explore our demo projects.
                    </p>

                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => addTrack({ name: 'Audio 1', kind: 'audio' })}
                        >
                            <Plus className="size-3.5 mr-1" />
                            Audio Track
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => addTrack({ name: 'MIDI 1', kind: 'midi' })}
                        >
                            <Piano className="size-3.5 mr-1" />
                            MIDI Track
                        </Button>
                    </div>

                    <div className="w-full border-t border-border-soft my-1" />

                    <div className="flex gap-2 w-full">
                        <Button
                            variant="default"
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                                setTemplateChooserCategory('demo');
                                setTemplateChooserOpen(true);
                            }}
                        >
                            <Music className="size-3.5 mr-1" />
                            Load Demo Project
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                                setTemplateChooserCategory('all');
                                setTemplateChooserOpen(true);
                            }}
                        >
                            <LayoutTemplate className="size-3.5 mr-1" />
                            New from Template
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
            <TemplateChooser
                open={templateChooserOpen}
                initialCategory={templateChooserCategory}
                onClose={() => setTemplateChooserOpen(false)}
            />
        </>
    );
};
