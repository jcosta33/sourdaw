import { type ReactElement, type MouseEvent, useRef, useState } from 'react';

import { Plus, Check, Trash2, Layers, Scissors } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';

import { type Take, type CompRegion } from '../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';
import { addTake } from '../../useCases/comping/addTake';
import { addTakeLane } from '../../useCases/comping/addTakeLane';
import { flattenComp } from '../../useCases/comping/flattenComp';
import { getTakeLaneForTrack } from '../../useCases/comping/getTakeLaneForTrack';
import { removeCompRegion } from '../../useCases/comping/removeCompRegion';
import { selectTake } from '../../useCases/comping/selectTake';
import { setCompRegion } from '../../useCases/comping/setCompRegion';

const DEFAULT_LANE_STATE: TakeLaneStoreState = { lanes: [] };
const DEFAULT_TRACK_STATE: TrackStoreState = { tracks: [], selectedTrackId: null };

type CompRegionOverlayProps = {
    region: CompRegion;
    take: Take;
    laneWidthPx: number;
    minBeat: number;
    maxBeat: number;
    onRemove: () => void;
};

const CompRegionOverlay = ({
    region,
    take,
    laneWidthPx,
    minBeat,
    maxBeat,
    onRemove,
}: CompRegionOverlayProps): ReactElement | null => {
    const span = maxBeat - minBeat;
    if (span <= 0) {
        return null;
    }
    const left = ((region.startBeat - minBeat) / span) * laneWidthPx;
    const width = ((region.endBeat - region.startBeat) / span) * laneWidthPx;
    return (
        <Row
            justify="between"
            gap={1}
            className="absolute top-0 bottom-0 rounded-sm border border-[var(--color-accent-cyan)]/70 bg-[var(--color-accent-cyan)]/15 px-1.5 text-[9px] font-semibold text-[var(--color-accent-cyan)]"
            style={{ left, width: Math.max(8, width) }}
            title={`Comp: ${take.name} (${region.startBeat.toFixed(2)}–${region.endBeat.toFixed(2)})`}
        >
            <span className="truncate">{take.name}</span>
            <button
                type="button"
                className="shrink-0 rounded hover:bg-white/10"
                onClick={(event) => {
                    event.stopPropagation();
                    onRemove();
                }}
                aria-label={`Remove comp region ${take.name}`}
            >
                <Trash2 className="size-2.5" aria-hidden="true" />
            </button>
        </Row>
    );
};

type TakeRowDragState = {
    startBeat: number;
    endBeat: number;
};

type TakeRowProps = {
    take: Take;
    minBeat: number;
    maxBeat: number;
    isActive: boolean;
    onPromote: () => void;
    onCreateRegion: (startBeat: number, endBeat: number) => void;
};

const TakeRow = ({ take, minBeat, maxBeat, isActive, onPromote, onCreateRegion }: TakeRowProps): ReactElement => {
    const rowRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<TakeRowDragState | null>(null);

    const beatFromPointer = (clientX: number): number => {
        const el = rowRef.current;
        if (!el) {
            return minBeat;
        }
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const span = maxBeat - minBeat;
        return minBeat + ratio * span;
    };

    const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
        if (event.button !== 0) {
            return;
        }
        const startBeat = beatFromPointer(event.clientX);
        setDrag({ startBeat, endBeat: startBeat });
    };

    const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
        if (!drag) {
            return;
        }
        const endBeat = beatFromPointer(event.clientX);
        setDrag({ startBeat: drag.startBeat, endBeat });
    };

    const handleMouseUp = (): void => {
        if (!drag) {
            return;
        }
        const startBeat = Math.min(drag.startBeat, drag.endBeat);
        const endBeat = Math.max(drag.startBeat, drag.endBeat);
        const minimumSpan = Math.max(0.1, (maxBeat - minBeat) * 0.02);
        if (endBeat - startBeat >= minimumSpan) {
            onCreateRegion(startBeat, endBeat);
        }
        setDrag(null);
    };

    const handleMouseLeave = (): void => {
        setDrag(null);
    };

    const takeExtentStyle = (): { left: number; width: number } | null => {
        const span = maxBeat - minBeat;
        if (span <= 0) {
            return null;
        }
        const left = ((take.startBeat - minBeat) / span) * 100;
        const width = ((take.endBeat - take.startBeat) / span) * 100;
        return { left, width };
    };

    const extent = takeExtentStyle();

    const dragPreview = (() => {
        if (!drag) {
            return null;
        }
        const span = maxBeat - minBeat;
        if (span <= 0) {
            return null;
        }
        const startBeat = Math.min(drag.startBeat, drag.endBeat);
        const endBeat = Math.max(drag.startBeat, drag.endBeat);
        const left = ((startBeat - minBeat) / span) * 100;
        const width = ((endBeat - startBeat) / span) * 100;
        return { left, width };
    })();

    return (
        <div
            className={cn(
                'flex items-center gap-2 border-t border-border-hairline px-2 py-1',
                isActive ? 'bg-[var(--color-accent-mint)]/10' : 'hover:bg-white/[0.03]'
            )}
        >
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            'size-4 shrink-0 rounded-full border transition-colors',
                            isActive
                                ? 'border-[var(--color-accent-mint)] bg-[var(--color-accent-mint)] text-black'
                                : 'border-border-hairline text-muted-foreground hover:border-[var(--color-accent-mint)]'
                        )}
                        aria-pressed={isActive}
                        aria-label={`Promote ${take.name} to main take`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onPromote();
                        }}
                    >
                        {isActive ? <Check className="size-2.5" aria-hidden="true" /> : null}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="right">{isActive ? 'Active take' : 'Promote to main'}</TooltipContent>
            </Tooltip>

            <span className="w-24 shrink-0 truncate text-[10px] text-foreground/90" title={take.name}>
                {take.name}
            </span>

            <span className="w-16 shrink-0 font-mono text-[9px] text-muted-foreground">
                {take.startBeat.toFixed(1)}–{take.endBeat.toFixed(1)}
            </span>

            <div
                ref={rowRef}
                role="presentation"
                className={cn(
                    'relative h-6 flex-1 rounded-sm border border-border-hairline bg-black/30 transition-colors',
                    drag ? 'cursor-grabbing' : 'cursor-crosshair'
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            >
                {extent ? (
                    <div
                        className={cn(
                            'absolute top-0 bottom-0 rounded-sm',
                            isActive
                                ? 'bg-[var(--color-accent-mint)]/25 border border-[var(--color-accent-mint)]/60'
                                : 'bg-white/[0.08] border border-white/[0.08]'
                        )}
                        style={{ left: `${extent.left}%`, width: `${extent.width}%` }}
                        aria-hidden="true"
                    />
                ) : null}
                {dragPreview ? (
                    <div
                        className="absolute top-0 bottom-0 rounded-sm border border-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/20"
                        style={{ left: `${dragPreview.left}%`, width: `${dragPreview.width}%` }}
                        aria-hidden="true"
                    />
                ) : null}
            </div>
        </div>
    );
};

type TakeLanePanelProps = {
    trackId: string;
    trackName: string;
    trackColor: string;
};

export const TakeLanePanel = ({ trackId, trackName, trackColor }: TakeLanePanelProps): ReactElement => {
    const laneState = useStore(takeLaneStore, DEFAULT_LANE_STATE);
    const trackState = useStore(trackStore, DEFAULT_TRACK_STATE);
    const lane = laneState.lanes.find((entry) => entry.trackId === trackId) ?? null;
    const track = trackState.tracks.find((entry) => entry.id === trackId);

    const [laneWidthPx, setLaneWidthPx] = useState<number>(0);
    const laneStripRef = useRef<HTMLDivElement>(null);

    if (!track) {
        return <div className="px-3 py-2 text-[10px] text-muted-foreground">Track not found.</div>;
    }

    const handleStripMount = (element: HTMLDivElement | null): void => {
        laneStripRef.current = element;
        if (element) {
            setLaneWidthPx(element.getBoundingClientRect().width);
        }
    };

    const clips = track.clips;
    const clipSpan = clips.reduce(
        (acc, clip) => ({
            min: Math.min(acc.min, clip.startBeat),
            max: Math.max(acc.max, clip.endBeat),
        }),
        { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
    );
    const hasClips = Number.isFinite(clipSpan.min) && Number.isFinite(clipSpan.max);
    const minBeat = hasClips ? Math.max(0, clipSpan.min) : 0;
    const maxBeat = hasClips ? Math.max(clipSpan.max, minBeat + 4) : 16;

    const takes: Take[] = lane?.takes ?? [];
    const activeCompRegions: CompRegion[] = lane?.activeCompRegions ?? [];

    const handleAddLane = (): void => {
        addTakeLane(trackId);
    };

    const handleAddTakeFromClips = (): void => {
        const currentLane = getTakeLaneForTrack(trackId);
        if (!currentLane) {
            addTakeLane(trackId);
        }
        const fallbackStart = minBeat;
        const fallbackEnd = Math.max(minBeat + 4, maxBeat);
        const sourceClip = clips[0];
        if (sourceClip) {
            addTake(trackId, sourceClip.id, `Take ${takes.length + 1}`, sourceClip.startBeat, sourceClip.endBeat);
            return;
        }
        addTake(trackId, `${trackId}-synthetic`, `Take ${takes.length + 1}`, fallbackStart, fallbackEnd);
    };

    const handleCreateRegion = (take: Take, startBeat: number, endBeat: number): void => {
        setCompRegion(trackId, { startBeat, endBeat, takeId: take.id });
    };

    const handleFlatten = (): void => {
        flattenComp(trackId);
    };

    const handlePromote = (take: Take): void => {
        selectTake(trackId, take.id);
    };

    return (
        <div className="border-l-2 border-[var(--color-accent-mint)]/40 bg-surface-well/60 pb-1">
            <Row gap={2} className="px-2 py-1 text-[10px]">
                <Layers className="size-3 shrink-0 text-[var(--color-accent-mint)]" aria-hidden="true" />
                <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: trackColor }}
                    aria-hidden="true"
                />
                <span className="font-semibold uppercase tracking-wide text-foreground/80">Takes · {trackName}</span>
                <span className="text-muted-foreground">
                    {takes.length} take{takes.length === 1 ? '' : 's'} · {activeCompRegions.length} comp region
                    {activeCompRegions.length === 1 ? '' : 's'}
                </span>

                <Row gap={1} className="ml-auto">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="xs"
                                aria-label="Add take"
                                data-testid="take-lane-add"
                                onClick={handleAddTakeFromClips}
                            >
                                <Plus className="size-3" aria-hidden="true" />
                                <span className="ml-1">Take</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Add a new take from the first clip on this track</TooltipContent>
                    </Tooltip>
                    {lane ? null : (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    aria-label="Initialize take lane"
                                    onClick={handleAddLane}
                                >
                                    <Plus className="size-3" aria-hidden="true" />
                                    <span className="ml-1">Lane</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Initialize a take lane for this track</TooltipContent>
                        </Tooltip>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="xs"
                                aria-label="Flatten comp"
                                disabled={!lane}
                                onClick={handleFlatten}
                            >
                                <Scissors className="size-3" aria-hidden="true" />
                                <span className="ml-1">Flatten</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Flatten comp regions and remove take lane</TooltipContent>
                    </Tooltip>
                </Row>
            </Row>

            {takes.length === 0 ? (
                <div className="px-3 pb-2 text-[10px] italic text-muted-foreground">
                    No takes yet. Add takes to compose alternative recordings, then drag on a row to select a comp
                    region.
                </div>
            ) : (
                <div ref={handleStripMount} className="relative">
                    {activeCompRegions.length > 0 && laneWidthPx > 0 ? (
                        <div
                            className="relative mx-2 mb-1 h-3 rounded-sm border border-border-hairline bg-black/30"
                            aria-label="Active comp regions"
                        >
                            {activeCompRegions.map((region) => {
                                const take = takes.find((entry) => entry.id === region.takeId);
                                if (!take) {
                                    return null;
                                }
                                return (
                                    <CompRegionOverlay
                                        key={`${region.startBeat}-${region.endBeat}-${region.takeId}`}
                                        region={region}
                                        take={take}
                                        laneWidthPx={laneWidthPx - 16}
                                        minBeat={minBeat}
                                        maxBeat={maxBeat}
                                        onRemove={() => removeCompRegion(trackId, region.startBeat)}
                                    />
                                );
                            })}
                        </div>
                    ) : null}

                    {takes.map((take) => (
                        <TakeRow
                            key={take.id}
                            take={take}
                            minBeat={minBeat}
                            maxBeat={maxBeat}
                            isActive={take.selected}
                            onPromote={() => handlePromote(take)}
                            onCreateRegion={(startBeat, endBeat) => handleCreateRegion(take, startBeat, endBeat)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export const TakeLanesView = (): ReactElement => {
    const laneState = useStore(takeLaneStore, DEFAULT_LANE_STATE);
    const trackState = useStore(trackStore, DEFAULT_TRACK_STATE);
    const activeTracks = trackState.tracks.filter(
        (track) => track.showVariationLanes === true && track.kind !== 'master' && track.kind !== 'folder'
    );

    if (activeTracks.length === 0) {
        const laneCount = laneState.lanes.length;
        void laneCount;
        return (
            <div className="p-4 text-[10px] italic text-muted-foreground">
                Toggle "Variation Lanes" on a track header to reveal take rows for comping.
            </div>
        );
    }

    return (
        <Stack className="h-full overflow-y-auto">
            {activeTracks.map((track) => (
                <TakeLanePanel key={track.id} trackId={track.id} trackName={track.name} trackColor={track.color} />
            ))}
        </Stack>
    );
};
