import { type ReactElement, type RefObject, type WheelEvent, useRef, useState, useLayoutEffect, useSyncExternalStore } from 'react';
import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { timelineViewStore, scrollTimeline } from '#/modules/Arrangement/stores/timelineViewStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { addAutomationLane } from '#/modules/Automation/useCases/automation/addAutomationLane';
import { toggleLaneCollapsed } from '#/modules/Automation/useCases/automation/toggleLaneCollapsed';
import { removeAutomationLane } from '#/modules/Automation/useCases/automation/removeAutomationLane';
import { setAutomationMode } from '#/modules/Arrangement/useCases/toggleTrackState/setAutomationMode';
import { AutomationLaneRow } from './AutomationView/AutomationLaneRow';
import { AutomationAddLaneControl, AutomationModeControl } from './AutomationView/AutomationControls';
import { getAutomatableParams, LANE_HEIGHT } from '../helpers/automationViewHelpers';
import { type AutomationLane } from '#/modules/Arrangement/useCases/trackQueries';
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { BeatRulerBar } from '#/modules/Arrangement/presentations/views/BeatRulerBar';

const SPARKLINE_HEIGHT = 24;

/** Reactively track an element's width via ResizeObserver */
function useContainerWidth(ref: RefObject<HTMLDivElement | null>): number {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const ro = new ResizeObserver(([entry]) => {
            if (entry) {
                setWidth(entry.contentRect.width);
            }
        });
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, [ref]);
    return width;
}

const LaneSparkline = ({
    lane,
    trackColor,
    width,
}: {
    lane: AutomationLane;
    trackColor: string;
    width: number;
}): ReactElement => {
    const color = lane.color ?? trackColor;
    const { points, minValue, maxValue } = lane;
    if (points.length < 2) {
        return <div style={{ height: SPARKLINE_HEIGHT }} className="bg-surface-base/20" />;
    }

    const range = maxValue - minValue;
    const pathData = points
        .map((p, i) => {
            const x = (p.beat / (points[points.length - 1]!.beat || 1)) * width;
            const y = SPARKLINE_HEIGHT - ((p.value - minValue) / (range || 1)) * (SPARKLINE_HEIGHT - 4) - 2;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        })
        .join(' ');

    return (
        <div
            style={{ height: SPARKLINE_HEIGHT }}
            className="relative bg-surface-base/20 cursor-pointer border-b border-border/10"
            onClick={() => toggleLaneCollapsed(lane.id)}
        >
            <div className="absolute top-0.5 left-1 flex items-center gap-1 z-10">
                <ChevronRight className="size-2.5 text-muted-foreground/50" />
                <span className="text-[8px] text-muted-foreground/60 truncate max-w-[80px]">{lane.parameterName}</span>
            </div>
            <svg width={width} height={SPARKLINE_HEIGHT} className="absolute inset-0">
                <path d={pathData} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.5} />
            </svg>
        </div>
    );
};

export const AutomationBottomPanel = (): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);

    const containerWidth = useContainerWidth(containerRef);

    const trackState = useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value,
        () => trackStore.value
    );

    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(() => cb()),
        () => automationStore.value,
        () => automationStore.value
    );

    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value,
        () => timelineViewStore.value
    );

    const ws = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(() => cb()),
        () => workspaceStore.value,
        () => workspaceStore.value
    );

    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const selectedTrack = trackState?.tracks.find((t) => t.id === selectedTrackId) ?? null;
    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;
    const trackListWidth = ws?.trackListWidth ?? 176;
    const trackListOpen = ws?.trackListOpen ?? true;

    const trackLanes = selectedTrackId
        ? (autoState?.lanes ?? []).filter((l) => l.trackId === selectedTrackId && !l.clipId)
        : [];

    const availableParams = selectedTrack
        ? getAutomatableParams(selectedTrack.id, selectedTrack.devices.map((d) => ({ type: d.type, name: d.name })))
        : [];

    // Filter out params that already have lanes
    const unusedParams = availableParams.filter((p) => !trackLanes.some((l) => l.parameterId === p.id));

    const automationMode = selectedTrack?.automationMode ?? 'read';
    const trackColor = selectedTrack?.color ?? 'var(--color-palette-steel)';

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            scrollTimeline(event.deltaX || event.deltaY);
        }
    };

    const handleAddLane = (paramId: string, paramName: string) => {
        if (!selectedTrackId) {
            return;
        }
        addAutomationLane(selectedTrackId, paramId, paramName);
    };

    const handleRemoveLane = (laneId: string) => {
        removeAutomationLane(laneId);
    };

    if (!selectedTrack) {
        return (
            <div className="flex h-full items-center justify-center bg-surface-base/60">
                <DawBlockedState
                    compact
                    eyebrow="Automation"
                    className="mx-4 w-full max-w-sm"
                    title="No track selected"
                    description="Select a track to shape its automation curves."
                    summary="Automation lanes attach to a track and expose its volume, pan, and device parameters."
                />
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden bg-surface-base/50">
            {/* Left panel — fixed width matching track list */}
            {trackListOpen ? (
                <div
                    className="flex flex-col shrink-0 border-r border-border/30 bg-surface-well overflow-y-auto"
                    style={{ width: trackListWidth }}
                >
                    {/* Track info header */}
                    <DawHeaderBand className="h-7 gap-2 px-2" compact>
                        <div className="size-2.5 rounded-sm" style={{ backgroundColor: trackColor }} />
                        <span className="text-xs font-medium text-foreground truncate flex-1">{selectedTrack.name}</span>
                    </DawHeaderBand>

                    {/* Automation mode selector */}
                    <div className="shrink-0 border-b border-border/20 px-2 py-1.5">
                        <AutomationModeControl
                            automationMode={automationMode}
                            laneCount={trackLanes.length}
                            onModeChange={(mode) => setAutomationMode(selectedTrackId!, mode)}
                        />
                    </div>

                    {/* Lane labels with collapse toggle and delete */}
                    {trackLanes.map((lane) => (
                        <div
                            key={lane.id}
                            className="flex items-center gap-1 px-1.5 border-b border-border/10 shrink-0 group"
                            style={{ height: lane.collapsed ? SPARKLINE_HEIGHT : LANE_HEIGHT }}
                        >
                            <button
                                type="button"
                                className="size-3.5 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
                                onClick={() => toggleLaneCollapsed(lane.id)}
                                aria-label={lane.collapsed ? 'Expand lane' : 'Collapse lane'}
                            >
                                {lane.collapsed ? (
                                    <ChevronRight className="size-2.5" />
                                ) : (
                                    <ChevronDown className="size-2.5" />
                                )}
                            </button>
                            <div className="size-2 rounded-full shrink-0" style={{ backgroundColor: lane.color ?? trackColor }} />
                            <span className="text-[9px] text-muted-foreground truncate flex-1">{lane.parameterName}</span>
                            <button
                                type="button"
                                className="size-3.5 flex items-center justify-center text-muted-foreground/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                onClick={() => handleRemoveLane(lane.id)}
                                aria-label={`Remove ${lane.parameterName} lane`}
                            >
                                <Trash2 className="size-2.5" />
                            </button>
                        </div>
                    ))}

                    {/* Add lane — inline or picker */}
                    <div className="shrink-0 px-2 py-1.5 hover:bg-surface-base/50">
                        <AutomationAddLaneControl
                            params={unusedParams}
                            onAdd={handleAddLane}
                            showAvailableCount
                        />
                    </div>
                </div>
            ) : null}

            {/* Right panel — automation lanes aligned with timeline */}
            <div className="flex-1 flex flex-col overflow-hidden" ref={containerRef}>
                {/* Beat ruler for alignment */}
                <BeatRulerBar />

                {/* Lanes area */}
                <div className="flex-1 overflow-y-auto" onWheel={handleWheel}>
                    {containerWidth > 0 && trackLanes.length === 0 ? (
                        <div className="flex h-full items-center justify-center p-4">
                            <DawEmptyState
                                compact
                                className="w-full max-w-sm"
                                title="No automation lanes yet"
                                description='Click "Add Lane" to shape volume, pan, or device parameters over time.'
                            />
                        </div>
                    ) : containerWidth > 0 ? (
                        trackLanes.map((lane) =>
                            lane.collapsed ? (
                                <LaneSparkline key={lane.id} lane={lane} trackColor={trackColor} width={containerWidth} />
                            ) : (
                                <AutomationLaneRow
                                    key={lane.id}
                                    lane={lane}
                                    trackColor={trackColor}
                                    pixelsPerBeat={pixelsPerBeat}
                                    scrollX={scrollX}
                                    containerWidth={containerWidth}
                                />
                            )
                        )
                    ) : null}
                </div>
            </div>
        </div>
    );
};
