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
import { Piano, Upload, LayoutTemplate, Sparkles, Headphones } from 'lucide-react';
import { SourdawLogo } from '../components/SourdawLogo';
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

    const hasUserTracks = tracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder').length > 0;

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
            <div className="flex flex-1 flex-col overflow-hidden relative">
                <ArrangementBar pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
                {hasMarkers ? <MarkerLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                <TimelineMinimap />
                <BeatRulerBar />
                {hasChords ? <ChordTrackLane pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} /> : null}
                <TimelineSurface />
                {scratchPadOpen ? <ScratchPadView height={scratchPadHeight} onToggle={closeScratchPad} /> : null}
            </div>
        </div>
    );
};

const BREAD_TAGLINES = [
    'Fresh beats, zero preservatives.',
    'Let it rise. Then drop it.',
    'Knead it. Proof it. Ship it.',
    'The best thing since sliced tracks.',
    'Baked from scratch, mixed to perfection.',
    'Your starter is ready.',
    'Good music takes time to proof.',
    'Roll up your sleeves.',
    'From raw dough to golden master.',
];

const EmptyArrangeOverlay = (): ReactElement => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
    const [templateChooserCategory, setTemplateChooserCategory] = useState<
        import('#/modules/Project/useCases/projectTemplates').TemplateCategory | 'all'
    >('all');
    const [tagline] = useState(() => BREAD_TAGLINES[Math.floor(Math.random() * BREAD_TAGLINES.length)]);

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
                className="absolute inset-0 flex items-center justify-center z-10 pointer-events-auto overflow-hidden"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 40%, rgba(217,119,6,0.08) 0%, rgba(0,0,0,0) 60%), var(--color-surface-base)',
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
                {/* Ambient floating particles */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                    <div
                        className="absolute size-64 rounded-full bg-[var(--color-accent-orange)]/[0.03] blur-3xl top-[15%] left-[20%] animate-pulse"
                        style={{ animationDuration: '6s' }}
                    />
                    <div
                        className="absolute size-48 rounded-full bg-[var(--color-accent-lavender)]/[0.04] blur-3xl top-[60%] right-[15%] animate-pulse"
                        style={{ animationDuration: '8s', animationDelay: '2s' }}
                    />
                    <div
                        className="absolute size-32 rounded-full bg-[var(--color-accent-cyan)]/[0.03] blur-3xl bottom-[20%] left-[40%] animate-pulse"
                        style={{ animationDuration: '7s', animationDelay: '4s' }}
                    />
                </div>

                <div
                    className={`relative flex flex-col items-center gap-5 p-10 rounded-2xl border shadow-[0_16px_64px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)] max-w-lg w-full mx-4 transition-all duration-300 ${
                        isDragOver
                            ? 'border-[var(--color-accent-orange)] border-2 bg-[var(--color-accent-orange)]/5 scale-[1.02]'
                            : 'border-border-soft/50 bg-surface-overlay/80 backdrop-blur-xl'
                    }`}
                >
                    {/* Logo + Title */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-[var(--color-accent-orange)]/20 blur-xl scale-150" />
                            <SourdawLogo className="relative h-24 drop-shadow-[0_4px_12px_rgba(217,119,6,0.3)]" />
                        </div>
                        <div className="text-center">
                            <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-[var(--color-accent-orange)] via-amber-300 to-[var(--color-accent-peach)] bg-clip-text text-transparent">
                                Sourdaw
                            </h2>
                            <p className="text-sm text-muted-foreground/70 mt-1 italic">{tagline}</p>
                        </div>
                    </div>

                    {/* Quick start grid */}
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <button
                            type="button"
                            className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border/30 bg-surface-base/50 hover:bg-[var(--color-accent-cyan)]/10 hover:border-[var(--color-accent-cyan)]/30 transition-all cursor-pointer"
                            onClick={() => addTrack({ name: 'Audio 1', kind: 'audio' })}
                        >
                            <div className="size-9 rounded-lg bg-[var(--color-accent-cyan)]/15 flex items-center justify-center group-hover:bg-[var(--color-accent-cyan)]/25 transition-colors">
                                <Headphones className="size-4.5 text-[var(--color-accent-cyan)]" />
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-medium text-foreground/90 block">Audio Track</span>
                                <span className="text-[9px] text-muted-foreground/50">Record or import</span>
                            </div>
                        </button>

                        <button
                            type="button"
                            className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border/30 bg-surface-base/50 hover:bg-[var(--color-accent-lavender)]/10 hover:border-[var(--color-accent-lavender)]/30 transition-all cursor-pointer"
                            onClick={() => addTrack({ name: 'MIDI 1', kind: 'midi' })}
                        >
                            <div className="size-9 rounded-lg bg-[var(--color-accent-lavender)]/15 flex items-center justify-center group-hover:bg-[var(--color-accent-lavender)]/25 transition-colors">
                                <Piano className="size-4.5 text-[var(--color-accent-lavender)]" />
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-medium text-foreground/90 block">MIDI Track</span>
                                <span className="text-[9px] text-muted-foreground/50">Keys & synths</span>
                            </div>
                        </button>

                        <button
                            type="button"
                            className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border/30 bg-surface-base/50 hover:bg-[var(--color-accent-peach)]/10 hover:border-[var(--color-accent-peach)]/30 transition-all cursor-pointer"
                            onClick={() => {
                                setTemplateChooserCategory('demo');
                                setTemplateChooserOpen(true);
                            }}
                        >
                            <div className="size-9 rounded-lg bg-[var(--color-accent-peach)]/15 flex items-center justify-center group-hover:bg-[var(--color-accent-peach)]/25 transition-colors">
                                <Sparkles className="size-4.5 text-[var(--color-accent-peach)]" />
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-medium text-foreground/90 block">Demo Project</span>
                                <span className="text-[9px] text-muted-foreground/50">Hear what's cooking</span>
                            </div>
                        </button>

                        <button
                            type="button"
                            className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border/30 bg-surface-base/50 hover:bg-[var(--color-accent-orange)]/10 hover:border-[var(--color-accent-orange)]/30 transition-all cursor-pointer"
                            onClick={() => {
                                setTemplateChooserCategory('all');
                                setTemplateChooserOpen(true);
                            }}
                        >
                            <div className="size-9 rounded-lg bg-[var(--color-accent-orange)]/15 flex items-center justify-center group-hover:bg-[var(--color-accent-orange)]/25 transition-colors">
                                <LayoutTemplate className="size-4.5 text-[var(--color-accent-orange)]" />
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-medium text-foreground/90 block">From Template</span>
                                <span className="text-[9px] text-muted-foreground/50">Pre-baked recipes</span>
                            </div>
                        </button>
                    </div>

                    {/* Drop zone hint */}
                    <div
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed transition-all w-full justify-center ${
                            isDragOver
                                ? 'border-[var(--color-accent-orange)] bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)]'
                                : 'border-border/30 text-muted-foreground/50 hover:border-border/50 hover:text-muted-foreground/70'
                        }`}
                    >
                        <Upload className="size-3.5" />
                        <span className="text-xs">Drop audio or MIDI files anywhere to get started</span>
                    </div>

                    {/* Keyboard shortcuts */}
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground/40">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-surface-base border border-border/30 text-[9px] font-mono">
                                Space
                            </kbd>
                            Play
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-surface-base border border-border/30 text-[9px] font-mono">
                                R
                            </kbd>
                            Record
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-surface-base border border-border/30 text-[9px] font-mono">
                                L
                            </kbd>
                            Loop
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 py-0.5 rounded bg-surface-base border border-border/30 text-[9px] font-mono leading-none">
                                &#8984;K
                            </kbd>
                            Commands
                        </span>
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
