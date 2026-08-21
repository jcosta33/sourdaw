import { type ReactElement, type RefObject, type WheelEvent, useRef, useState, useLayoutEffect } from 'react';

import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { BeatRulerBar, TimelineChromeSurface } from '#/modules/Arrangement/presentations/views';
import { trackStore, timelineViewStore } from '#/modules/Arrangement/stores';
import { scrollTimelineViewportHorizontallyFromWheel, setAutomationMode } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    addAutomationLane,
    getAutomationLaneCeiling,
    toggleLaneCollapsed,
    removeAutomationLane,
} from '#/modules/Automation/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type EditingTool } from '../../models/EditingTool';
import { type Track } from '../../models/TrackViewTypes';
import { getAutomatableParams, LANE_HEIGHT } from '../helpers/automationViewHelpers';

import { AutomationAddLaneControl, AutomationModeControl } from './AutomationView/AutomationControls';
import { AutomationLaneRow } from './AutomationView/AutomationLaneRow';
import { AutomationSidebarCell } from './AutomationView/AutomationSidebarCell';

const SPARKLINE_HEIGHT = 24;

type AutomationPanelWorkspaceState = {
    activeTool: EditingTool;
    snapValue: number;
    trackListWidth: number;
    trackListOpen: boolean;
};

type AutomationPanelState = {
    lanes: AutomationLane[];
};

type AutomationTrackState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

type AutomationTimelineState = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
    autoScrollEnabled: boolean;
};

/** Reactively track an element's width via ResizeObserver */
function useContainerWidth(ref: RefObject<HTMLDivElement | null>): number {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return undefined;
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
    const { points, minValue } = lane;
    if (points.length < 2) {
        return <div style={{ height: SPARKLINE_HEIGHT }} className="bg-surface-base/20" />;
    }

    // The same derived ceiling the expanded lane row draws against, not the
    // stored scalar: a gain lane saved before the fader widened still records
    // `maxValue: 1`, and normalising by that would draw a point at 1.5 above the
    // top of this box while the expanded view of the same lane draws it inside.
    const range = getAutomationLaneCeiling(lane) - minValue;
    const pathData = points
        .map((param, index) => {
            const x = (param.beat / (points[points.length - 1]!.beat || 1)) * width;
            const y = SPARKLINE_HEIGHT - ((param.value - minValue) / (range || 1)) * (SPARKLINE_HEIGHT - 4) - 2;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        })
        .join(' ');

    return (
        <div
            style={{ height: SPARKLINE_HEIGHT }}
            className="relative bg-surface-base/20 cursor-pointer border-b border-border/10"
            onClick={() => toggleLaneCollapsed(lane.id)}
        >
            <Row gap={1} className="absolute top-0.5 left-1 z-10">
                <ChevronRight className="size-2.5 text-muted-foreground/50" />
                <span className="text-[8px] text-muted-foreground/60 truncate max-w-[80px]">{lane.parameterName}</span>
            </Row>
            <svg width={width} height={SPARKLINE_HEIGHT} className="absolute inset-0">
                <path d={pathData} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.5} />
            </svg>
        </div>
    );
};

export const AutomationBottomPanel = (): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);

    const containerWidth = useContainerWidth(containerRef);

    const trackState = useStore<AutomationTrackState>(trackStore, { tracks: [], selectedTrackId: null });
    const autoState = useStore<AutomationPanelState>(automationStore, { lanes: [] });
    const viewState = useStore<AutomationTimelineState>(timelineViewStore, {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    });
    const ws = useStore<AutomationPanelWorkspaceState>(workspaceStore, defaultWorkspaceState);

    const selectedTrackId = trackState.selectedTrackId;
    const selectedTrack = trackState.tracks.find((time) => time.id === selectedTrackId) ?? null;
    const pixelsPerBeat = viewState.pixelsPerBeat;
    const scrollX = viewState.scrollX;
    const trackListWidth = ws.trackListWidth;
    const trackListOpen = ws.trackListOpen;

    const trackLanes = selectedTrackId
        ? autoState.lanes.filter((length) => length.trackId === selectedTrackId && !length.clipId)
        : [];

    const availableParams = selectedTrack
        ? getAutomatableParams(
              selectedTrack.id,
              selectedTrack.devices.map((data) => ({ type: data.type, name: data.name }))
          )
        : [];

    // Filter out params that already have lanes
    const unusedParams = availableParams.filter(
        (param) => !trackLanes.some((length) => length.parameterId === param.id)
    );

    const automationMode = selectedTrack?.automationMode ?? 'read';
    const trackColor = selectedTrack?.color ?? 'var(--color-palette-steel)';

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        scrollTimelineViewportHorizontallyFromWheel({
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            shiftKey: event.shiftKey,
        });
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
            <Row justify="center" className="h-full bg-surface-base/60">
                <DawBlockedState
                    compact
                    eyebrow="Automation"
                    className="mx-4 w-full max-w-sm"
                    title="No track selected"
                    description="Select a track to shape its automation curves."
                    summary="Automation lanes attach to a track and expose its volume, pan, and device parameters."
                />
            </Row>
        );
    }

    const laneRows = (() => {
        if (containerWidth > 0 && trackLanes.length === 0) {
            return (
                <Row justify="center" className="h-full p-4">
                    <DawEmptyState
                        compact
                        className="w-full max-w-sm"
                        title="No automation lanes yet"
                        description='Click "Add Lane" to shape volume, pan, or device parameters over time.'
                    />
                </Row>
            );
        } else {
            if (containerWidth > 0) {
                return trackLanes.map((lane) =>
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
                );
            } else {
                return null;
            }
        }
    })();
    const renderIife_7 = () => {
        if (trackListOpen) {
            return (
                <div
                    className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
                    style={{
                        gridTemplateColumns: `${trackListWidth}px minmax(0,1fr)`,
                        gridTemplateRows: 'auto auto minmax(0,1fr)',
                    }}
                >
                    {/* Left panel — fixed width matching track list */}
                    <AutomationSidebarCell>
                        {/* Track info header */}
                        <DawHeaderBand className="h-7 gap-2 px-2" compact>
                            <div className="size-2.5 rounded-sm" style={{ backgroundColor: trackColor }} />
                            <span className="text-xs font-medium text-foreground truncate flex-1">
                                {selectedTrack.name}
                            </span>
                        </DawHeaderBand>
                    </AutomationSidebarCell>
                    {/* Spacer: same height as track header so row 2 lines up across columns */}
                    <TimelineChromeSurface tone="subtle" className="h-7" aria-hidden />
                    {/* Automation mode selector */}
                    <AutomationSidebarCell className="shrink-0 border-b border-border/20 px-2 py-1.5">
                        <AutomationModeControl
                            automationMode={automationMode}
                            laneCount={trackLanes.length}
                            onModeChange={(mode) => setAutomationMode(selectedTrackId!, mode)}
                        />
                    </AutomationSidebarCell>
                    {/* Beat ruler for alignment — flex filler below matches mode row height */}
                    <Stack className="h-full min-w-0 border-b border-border/20">
                        <BeatRulerBar />
                        <div className="min-h-0 flex-1" aria-hidden />
                    </Stack>
                    {/* Lane labels with collapse toggle and delete */}
                    <AutomationSidebarCell className="min-h-0 overflow-y-auto">
                        {trackLanes.map((lane) => (
                            <Row
                                gap={1}
                                shrink={false}
                                className="px-1.5 border-b border-border/10 group"
                                key={lane.id}
                                style={{ height: lane.collapsed ? SPARKLINE_HEIGHT : LANE_HEIGHT }}
                            >
                                <Row grow gap={1} className="self-start">
                                    <Button
                                        variant="bare"
                                        size="bare"
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
                                    </Button>
                                    <div
                                        className="size-2 rounded-full shrink-0"
                                        style={{ backgroundColor: lane.color ?? trackColor }}
                                    />
                                    <span className="text-[9px] text-muted-foreground truncate flex-1">
                                        {lane.parameterName}
                                    </span>
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        type="button"
                                        className="size-3.5 flex items-center justify-center text-muted-foreground/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                        onClick={() => handleRemoveLane(lane.id)}
                                        aria-label={`Remove ${lane.parameterName} lane`}
                                    >
                                        <Trash2 className="size-2.5" />
                                    </Button>
                                </Row>
                            </Row>
                        ))}

                        {/* Add lane — inline or picker */}
                        <div className="shrink-0 px-2 py-1.5 hover:bg-surface-base/50">
                            <AutomationAddLaneControl params={unusedParams} onAdd={handleAddLane} showAvailableCount />
                        </div>
                    </AutomationSidebarCell>
                    {/* Right panel — automation lanes aligned with timeline */}
                    <Stack className="min-w-0 overflow-hidden" ref={containerRef}>
                        {/* Lanes area */}
                        <div className="min-h-0 flex-1 overflow-y-auto" onWheel={handleWheel}>
                            {laneRows}
                        </div>
                    </Stack>
                </div>
            );
        } else {
            return (
                <Stack grow className="min-w-0 overflow-hidden" ref={containerRef}>
                    {/* Right panel — automation lanes aligned with timeline */}
                    {/* Beat ruler for alignment */}
                    <BeatRulerBar />
                    {/* Lanes area */}
                    <div className="min-h-0 flex-1 overflow-y-auto" onWheel={handleWheel}>
                        {laneRows}
                    </div>
                </Stack>
            );
        }
    };

    return (
        <DawPanelSurface className="flex flex-row min-h-0 overflow-hidden bg-surface-base/50">
            {renderIife_7()}
        </DawPanelSurface>
    );
};
