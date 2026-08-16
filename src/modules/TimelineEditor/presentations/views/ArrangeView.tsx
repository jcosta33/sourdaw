import {
    type ReactElement,
    type MouseEvent as ReactMouseEvent,
    type DragEvent,
    useState,
    useRef,
    useLayoutEffect,
} from 'react';

import { Piano, Upload, Headphones } from 'lucide-react';

import { useStore } from '#/infra/store/useStore';
import {
    AdjustmentLayerStrip,
    TimelineSurface,
    TimelineMinimap,
    ArrangementBar,
    MarkerLane,
    BeatRulerBar,
    TimelineChromeSurface,
    TrackListView,
    ARRANGEMENT_BAR_HEIGHT,
    BEAT_RULER_HEIGHT,
    MARKER_LANE_HEIGHT,
    getAdjustmentLayerStripHeight,
} from '#/modules/Arrangement/presentations/views';
import { adjustmentLayerStore, timelineViewStore, markerStore } from '#/modules/Arrangement/stores';
import {
    addTrack,
    addClip,
    importMidiFile,
    setTimelineHorizontalScrollbarScrollX,
} from '#/modules/Arrangement/useCases';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { setTimelineMinimapHeight } from '#/modules/Preferences/useCases';
import { SessionView } from '#/modules/SessionLauncher/presentations/views';
import { transportStore } from '#/modules/Transport/stores';
import { closeScratchPad, setSessionViewWidth, setTrackListWidth } from '#/modules/WorkspaceShell/useCases';
import { clamp } from '#/utils/Math/clamp';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { normalizeTimelineMinimapHeight } from '#/utils/TimelineMinimap/timelineMinimapHeight';

import { ResizeHandle } from '../components/ResizeHandle';
import { useTracks } from '../hooks/useTracks';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { ArrangeEmptyStateShell } from './ArrangeEmptyStateShell';
import { ChordTrackLane, CHORD_TRACK_LANE_HEIGHT } from './Timeline/ChordTrackLane';
import { ScratchPadView } from './Timeline/ScratchPadView';
import { TimelineMinimapResizeHandle } from './TimelineMinimapResizeHandle';

const TRACK_LIST_MIN = 120;
const TRACK_LIST_MAX = 400;

const SESSION_VIEW_MIN = 200;
const SESSION_VIEW_MAX = 800;

export const ArrangeView = (): ReactElement => {
    const { tracks } = useTracks();
    const { trackListOpen, trackListWidth, scratchPadOpen, scratchPadHeight, dualViewOpen, sessionViewWidth } =
        useWorkspaceState();

    const hasUserTracks = tracks.filter((time) => time.kind !== 'master' && time.kind !== 'folder').length > 0;

    const [localTrackListWidth, setLocalTrackListWidth] = useState(trackListWidth);
    const trackListWidthRef = useRef(localTrackListWidth);
    const prevTrackListWidth = useRef(trackListWidth);
    if (prevTrackListWidth.current !== trackListWidth) {
        prevTrackListWidth.current = trackListWidth;
        setLocalTrackListWidth(trackListWidth);
    }

    const [localSessionWidth, setLocalSessionWidth] = useState(sessionViewWidth);
    const sessionWidthRef = useRef(localSessionWidth);
    const prevSessionViewWidth = useRef(sessionViewWidth);
    if (prevSessionViewWidth.current !== sessionViewWidth) {
        prevSessionViewWidth.current = sessionViewWidth;
        setLocalSessionWidth(sessionViewWidth);
    }

    const timelineContainerRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(window.innerWidth);

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

    const handleSessionResize = (delta: number): void => {
        setLocalSessionWidth((prev) => {
            const next = clamp(prev + delta, SESSION_VIEW_MIN, SESSION_VIEW_MAX);
            sessionWidthRef.current = next;
            return next;
        });
    };

    const handleSessionResizeEnd = (): void => {
        setSessionViewWidth(sessionWidthRef.current);
    };

    useLayoutEffect(() => {
        const el = timelineContainerRef.current;
        if (!el) {
            return undefined;
        }
        const observer = new ResizeObserver(() => {
            setViewportWidth(el.clientWidth);
        });
        observer.observe(el);
        setViewportWidth(el.clientWidth);
        return () => observer.disconnect();
        // Re-run when hasUserTracks flips so the observer attaches once the
        // timeline container div is mounted (absent during the empty-state path).
    }, [hasUserTracks]);

    const viewState = useStore(timelineViewStore, {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    });

    const markerState = useStore(markerStore, { markers: [], sections: [] });

    const chordState = useStore(chordTrackStore, { enabled: false, events: [] });

    const adjustmentState = useStore(adjustmentLayerStore, { layers: [] });
    const preferences = useStore(preferencesStore);

    const showMinimap = preferences.showMinimap;
    const persistedMinimapHeight = normalizeTimelineMinimapHeight(preferences.timelineMinimapHeight);
    const [minimapResizeState, setMinimapResizeState] = useState({
        persistedHeight: persistedMinimapHeight,
        visible: showMinimap,
        previewHeight: null as number | null,
    });
    const minimapTruthChanged =
        minimapResizeState.persistedHeight !== persistedMinimapHeight || minimapResizeState.visible !== showMinimap;
    if (minimapTruthChanged) {
        setMinimapResizeState({
            persistedHeight: persistedMinimapHeight,
            visible: showMinimap,
            previewHeight: null,
        });
    }

    let activeMinimapHeight = minimapResizeState.previewHeight ?? persistedMinimapHeight;
    if (minimapTruthChanged) {
        activeMinimapHeight = persistedMinimapHeight;
    }

    const handleMinimapResizePreview = (height: number): void => {
        setMinimapResizeState((current) => ({
            ...current,
            previewHeight: normalizeTimelineMinimapHeight(height),
        }));
    };

    const handleMinimapResizeCommit = (height: number): void => {
        const normalizedHeight = normalizeTimelineMinimapHeight(height);
        setMinimapResizeState((current) => ({
            ...current,
            previewHeight: normalizedHeight,
        }));
        setTimelineMinimapHeight(normalizedHeight);
    };

    const handleMinimapResizeCancel = (): void => {
        setMinimapResizeState((current) => ({
            ...current,
            previewHeight: null,
        }));
    };

    const hasMarkers = (markerState?.markers.length ?? 0) > 0;
    const hasChords = (chordState?.events.length ?? 0) > 0 || (chordState?.enabled ?? false);
    const adjustmentLayerCount = adjustmentState?.layers.length ?? 0;
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
            {dualViewOpen ? (
                <>
                    <div
                        className="flex flex-col border-r border-border/20 bg-surface-base"
                        style={{ width: localSessionWidth }}
                    >
                        <SessionView />
                    </div>
                    <ResizeHandle
                        direction="vertical"
                        onResize={handleSessionResize}
                        onResizeEnd={handleSessionResizeEnd}
                    />
                </>
            ) : null}
            {trackListOpen ? (
                <>
                    <TrackListView
                        style={{ width: localTrackListWidth }}
                        extraHeaderHeight={
                            ARRANGEMENT_BAR_HEIGHT +
                            getAdjustmentLayerStripHeight(adjustmentLayerCount) +
                            (hasMarkers ? MARKER_LANE_HEIGHT : 0) +
                            (showMinimap ? activeMinimapHeight : 0) +
                            BEAT_RULER_HEIGHT +
                            (hasChords ? CHORD_TRACK_LANE_HEIGHT : 0)
                        }
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
                <AdjustmentLayerStrip pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
                {hasMarkers ? <MarkerLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                {showMinimap ? (
                    <div className="relative shrink-0" style={{ height: activeMinimapHeight }}>
                        <TimelineMinimap height={activeMinimapHeight} />
                        <TimelineMinimapResizeHandle
                            height={activeMinimapHeight}
                            persistedHeight={persistedMinimapHeight}
                            onPreview={handleMinimapResizePreview}
                            onCommit={handleMinimapResizeCommit}
                            onCancel={handleMinimapResizeCancel}
                        />
                    </div>
                ) : null}
                <BeatRulerBar />
                {hasChords ? (
                    <ChordTrackLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} viewportWidth={viewportWidth} />
                ) : null}
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
    // Reduce rather than `Math.max(256, ...allEndBeats)`: a project with enough
    // clips blows the engine's call-argument limit and throws
    // `RangeError: Maximum call stack size exceeded` instead of computing a width.
    const maxEndBeat = tracks.reduce(
        (outerMax, track) => track.clips.reduce((innerMax, clip) => Math.max(innerMax, clip.endBeat), outerMax),
        256
    );
    const totalContentWidth = maxEndBeat * pixelsPerBeat;

    // Only show when content actually overflows the viewport
    if (totalContentWidth <= viewportWidth) {
        return null;
    }

    const maxScrollX = totalContentWidth - viewportWidth;
    const thumbWidth = Math.max(40, (viewportWidth / totalContentWidth) * viewportWidth);
    const trackWidth = viewportWidth - thumbWidth;
    const thumbLeft = Math.min(trackWidth, maxScrollX > 0 ? (scrollX / maxScrollX) * trackWidth : 0);

    const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const startClientX = event.clientX;
        const startScrollX = scrollX;

        // Coalesce the high-frequency (~60Hz) mousemove writes through a
        // single requestAnimationFrame so each frame fans out at most one
        // Arrangement scroll use case to every track row/ruler/marker/adjustment strip,
        // instead of one store write per native mousemove event.
        let pendingScrollX: number | null = null;
        let rafId: number | null = null;

        const flush = (): void => {
            rafId = null;
            if (pendingScrollX !== null) {
                setTimelineHorizontalScrollbarScrollX({ scrollX: pendingScrollX, maxScrollX });
                pendingScrollX = null;
            }
        };

        const onMouseMove = (ev: MouseEvent): void => {
            const delta = ev.clientX - startClientX;
            const scrollDelta = trackWidth > 0 ? (delta / trackWidth) * maxScrollX : 0;
            pendingScrollX = startScrollX + scrollDelta;
            if (rafId === null) {
                rafId = requestAnimationFrame(flush);
            }
        };

        const onMouseUp = (): void => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            // Commit the final position synchronously so the thumb settles
            // exactly where the pointer was released even if no frame ran.
            if (pendingScrollX !== null) {
                setTimelineHorizontalScrollbarScrollX({ scrollX: pendingScrollX, maxScrollX });
                pendingScrollX = null;
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    return (
        <TimelineChromeSurface
            tone="subtle"
            className="select-none"
            style={{ height: 10 }}
            aria-label="Timeline horizontal scrollbar"
        >
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

    const handleDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(event.dataTransfer.files);
        const currentBeat = 0;

        // Decode/import every file in parallel, but commit state mutations
        // (addTrack/addClip) afterward in the original drop order so clip
        // placement order is preserved. Decoding before any addTrack also
        // means a decode failure never leaves an orphan empty track behind.
        const imports = await Promise.all(
            files.map(async (file) => {
                const ext = file.name.toLowerCase().split('.').pop() ?? '';

                if (['mid', 'midi'].includes(ext) || file.type === 'audio/midi') {
                    return { kind: 'midi' as const, file };
                }

                const isAudio =
                    file.type.startsWith('audio/') ||
                    ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'aiff', 'aif'].includes(ext);
                if (!isAudio) {
                    return { kind: 'skip' as const };
                }

                try {
                    const { id: bufferId, buffer } = await decodeAudioFile(file);
                    return { kind: 'audio' as const, file, bufferId, buffer };
                } catch {
                    return { kind: 'error' as const, file };
                }
            })
        );

        for (const result of imports) {
            if (result.kind === 'skip') {
                continue;
            }

            if (result.kind === 'error') {
                notifyUser(`Failed to import "${result.file.name}" — unsupported format or corrupt file`, 'error');
                continue;
            }

            if (result.kind === 'midi') {
                try {
                    await importMidiFile(result.file);
                } catch {
                    notifyUser(`Failed to import "${result.file.name}" — unsupported format or corrupt file`, 'error');
                }
                continue;
            }

            const newTrack = addTrack({ name: result.file.name.replace(/\.[^.]+$/, ''), kind: 'audio' });
            if (!newTrack) {
                continue;
            }

            const tempo = transportStore.value?.tempo ?? 120;
            const durationBeats = Math.max(4, Math.ceil((result.buffer.duration / 60) * tempo));

            addClip({
                trackId: newTrack.id,
                startBeat: currentBeat,
                endBeat: currentBeat + durationBeats,
                name: result.file.name.replace(/\.[^.]+$/, ''),
                type: 'audio',
                audioBufferId: result.bufferId,
            });
        }
    };

    return (
        <div
            className="absolute inset-0 flex items-center justify-center z-10 pointer-events-auto"
            style={{
                background:
                    'radial-gradient(ellipse at 50% 40%, rgba(217,119,6,0.05) 0%, rgba(0,0,0,0) 55%), var(--color-surface-base)',
            }}
            onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setIsDragOver(true);
            }}
            onDragLeave={(event) => {
                if (
                    event.currentTarget === event.target ||
                    !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
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
