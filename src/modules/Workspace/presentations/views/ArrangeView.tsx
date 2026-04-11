import {
    type ReactElement,
    type MouseEvent as ReactMouseEvent,
    type DragEvent,
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
} from 'react';
import { useStore } from '#/infra/store/useStore';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { timelineViewStore, setScrollX, markerStore, chordTrackStore } from '#/modules/Arrangement/stores';
import { addTrack, addClip, importMidiFile } from '#/modules/Arrangement/useCases';
import {
    TimelineSurface,
    TimelineMinimap,
    ArrangementBar,
    MarkerLane,
    BeatRulerBar,
    TimelineChromeSurface,
    TrackListView,
} from '#/modules/Arrangement/presentations/views';
import { useTracks } from '../hooks/useTracks';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { transportStore } from '#/modules/Transport/stores';
import { useWorkspaceState } from '#/modules/Workspace/presentations/hooks/useWorkspaceState';
import { setTrackListWidth } from '../../useCases/togglePanel/panelToggles/setTrackListWidth';
import { closeScratchPad } from '../../useCases/togglePanel/panelToggles/closeScratchPad';
import { ResizeHandle } from '#/modules/Workspace/presentations/components/ResizeHandle';
import { Piano, Upload, Headphones } from 'lucide-react';
import { ChordTrackLane } from './Timeline/ChordTrackLane';
import { ScratchPadView } from './Timeline/ScratchPadView';
import { ArrangeEmptyStateShell } from './ArrangeEmptyStateShell';
import { clamp } from '#/helpers/Math/clamp';

const TRACK_LIST_MIN = 120;
const TRACK_LIST_MAX = 400;

export const ArrangeView = (): ReactElement => {
    const { tracks } = useTracks();
    const { trackListOpen, trackListWidth, scratchPadOpen, scratchPadHeight } = useWorkspaceState();

    const hasUserTracks = tracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder').length > 0;

    const [localTrackListWidth, setLocalTrackListWidth] = useState(trackListWidth);
    const trackListWidthRef = useRef(localTrackListWidth);
    const timelineContainerRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(window.innerWidth);

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

    useLayoutEffect(() => {
        const el = timelineContainerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(() => {
            setViewportWidth(el.clientWidth);
        });
        observer.observe(el);
        setViewportWidth(el.clientWidth);
        return () => observer.disconnect();
        // Re-run when hasUserTracks flips so the observer attaches once the
        // timeline container div is mounted (absent during the empty-state path).
    }, [hasUserTracks]); // eslint-disable-line react-hooks/exhaustive-deps

    const viewState = useStore(timelineViewStore, {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    });

    const markerState = useStore(markerStore, { markers: [], sections: [] });

    const chordState = useStore(chordTrackStore, { enabled: false, events: [] });

    const hasMarkers = (markerState?.markers.length ?? 0) > 0;
    const hasChords = (chordState?.events.length ?? 0) > 0 || (chordState?.enabled ?? false);
    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;

    // Welcome screen — clean, no timeline chrome
    if (!hasUserTracks) {
        return (
            <div className="flex h-full relative">
                <EmptyArrangeOverlay />
            </div>
        );
    }

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
            <div ref={timelineContainerRef} className="flex flex-1 flex-col overflow-hidden relative">
                <ArrangementBar pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
                {hasMarkers ? <MarkerLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                <TimelineMinimap />
                <BeatRulerBar />
                {hasChords ? <ChordTrackLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                <TimelineSurface />
                <TimelineHScrollbar
                    scrollX={scrollX}
                    pixelsPerBeat={pixelsPerBeat}
                    tracks={tracks}
                    viewportWidth={viewportWidth}
                />
                {scratchPadOpen ? <ScratchPadView height={scratchPadHeight} onToggle={closeScratchPad} /> : null}
            </div>
        </div>
    );
};

type HScrollbarTrack = { clips: { endBeat: number }[] };

const TimelineHScrollbar = ({
    scrollX,
    pixelsPerBeat,
    tracks,
    viewportWidth,
}: {
    scrollX: number;
    pixelsPerBeat: number;
    tracks: HScrollbarTrack[];
    viewportWidth: number;
}): ReactElement | null => {
    const maxEndBeat = tracks.reduce((max, t) => {
        const trackMax = t.clips.reduce((m, c) => (c.endBeat > m ? c.endBeat : m), max);
        return trackMax;
    }, 256);
    const totalContentWidth = maxEndBeat * pixelsPerBeat;

    // Only show when content actually overflows the viewport
    if (totalContentWidth <= viewportWidth) {
        return null;
    }

    const maxScrollX = totalContentWidth - viewportWidth;
    const thumbWidth = Math.max(40, (viewportWidth / totalContentWidth) * viewportWidth);
    const trackWidth = viewportWidth - thumbWidth;
    const thumbLeft = Math.min(trackWidth, maxScrollX > 0 ? (scrollX / maxScrollX) * trackWidth : 0);

    const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
        e.preventDefault();
        const startClientX = e.clientX;
        const startScrollX = scrollX;

        const onMouseMove = (ev: MouseEvent): void => {
            const delta = ev.clientX - startClientX;
            const scrollDelta = trackWidth > 0 ? (delta / trackWidth) * maxScrollX : 0;
            setScrollX(Math.max(0, Math.min(maxScrollX, startScrollX + scrollDelta)));
        };

        const onMouseUp = (): void => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    return (
        <TimelineChromeSurface tone="subtle" className="select-none" style={{ height: 10 }}>
            <div
                className="daw-scrollbar-thumb absolute rounded-full"
                style={{
                    top: 2,
                    bottom: 2,
                    left: thumbLeft,
                    width: thumbWidth,
                    cursor: 'grab',
                }}
                onMouseDown={handleMouseDown}
            />
        </TimelineChromeSurface>
    );
};

const EmptyArrangeOverlay = (): ReactElement => {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
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
        <div
            className="absolute inset-0 flex items-center justify-center z-10 pointer-events-auto"
            style={{
                background:
                    'radial-gradient(ellipse at 50% 40%, rgba(217,119,6,0.05) 0%, rgba(0,0,0,0) 55%), var(--color-surface-base)',
            }}
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
            <ArrangeEmptyStateShell active={isDragOver}>
                <p className="text-xs font-medium text-muted-foreground/60">Add your first track</p>

                {/* Track type buttons */}
                <div className="grid grid-cols-2 gap-2 w-full">
                    <button
                        type="button"
                        className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-border/30 bg-surface-base/50 hover:bg-[var(--color-accent-cyan)]/10 hover:border-[var(--color-accent-cyan)]/30 transition-all cursor-pointer"
                        onClick={() => addTrack({ name: 'Audio 1', kind: 'audio' })}
                    >
                        <div className="size-8 rounded-lg bg-[var(--color-accent-cyan)]/15 flex items-center justify-center group-hover:bg-[var(--color-accent-cyan)]/25 transition-colors">
                            <Headphones className="size-4 text-[var(--color-accent-cyan)]" aria-hidden="true" />
                        </div>
                        <div className="text-center">
                            <span className="text-[11px] font-medium text-foreground/80 block">Audio</span>
                            <span className="text-[9px] text-muted-foreground/40">Record or import</span>
                        </div>
                    </button>

                    <button
                        type="button"
                        className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-border/30 bg-surface-base/50 hover:bg-[var(--color-accent-lavender)]/10 hover:border-[var(--color-accent-lavender)]/30 transition-all cursor-pointer"
                        onClick={() => addTrack({ name: 'MIDI 1', kind: 'midi' })}
                    >
                        <div className="size-8 rounded-lg bg-[var(--color-accent-lavender)]/15 flex items-center justify-center group-hover:bg-[var(--color-accent-lavender)]/25 transition-colors">
                            <Piano className="size-4 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                        </div>
                        <div className="text-center">
                            <span className="text-[11px] font-medium text-foreground/80 block">MIDI</span>
                            <span className="text-[9px] text-muted-foreground/40">Keys &amp; synths</span>
                        </div>
                    </button>
                </div>

                {/* Drop hint */}
                <div
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed transition-all w-full justify-center ${
                        isDragOver
                            ? 'border-[var(--color-accent-orange)] text-[var(--color-accent-orange)]'
                            : 'border-border/25 text-muted-foreground/35'
                    }`}
                >
                    <Upload className="size-3" aria-hidden="true" />
                    <span className="text-[10px]">Drop audio or MIDI files here</span>
                </div>
            </ArrangeEmptyStateShell>
        </div>
    );
};
