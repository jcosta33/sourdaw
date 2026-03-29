import { type ReactElement, type RefObject, type WheelEvent, useRef, useState, useEffect, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { timelineViewStore, scrollTimeline } from '#/modules/Arrangement/stores/timelineViewStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { addAutomationLane } from '#/modules/Automation/useCases/automation/addAutomationLane';
import { toggleLaneCollapsed } from '#/modules/Automation/useCases/automation/toggleLaneCollapsed';
import { removeAutomationLane } from '#/modules/Automation/useCases/automation/removeAutomationLane';
import { setAutomationMode } from '#/modules/Arrangement/useCases/toggleTrackState/setAutomationMode';
import { AutomationLaneRow } from './AutomationView/AutomationLaneRow';
import { getAutomatableParams, AUTOMATION_MODE_CONFIG, LANE_HEIGHT } from '../helpers/automationViewHelpers';
import { type AutomationMode } from '#/modules/Arrangement/useCases/trackQueries';
import { type AutomationLane } from '#/modules/Arrangement/useCases/trackQueries';
import { Plus, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { BeatRulerBar } from '#/modules/Arrangement/presentations/views/BeatRulerBar';

const MODE_OPTIONS: { value: AutomationMode; label: string }[] = [
    { value: 'read', label: 'Read' },
    { value: 'touch', label: 'Touch' },
    { value: 'latch', label: 'Latch' },
    { value: 'write', label: 'Write' },
    { value: 'off', label: 'Off' },
];

const SPARKLINE_HEIGHT = 24;

/** Reactively track an element's width via ResizeObserver */
function useContainerWidth(ref: RefObject<HTMLDivElement | null>): number {
    const [width, setWidth] = useState(0);
    useEffect(() => {
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
    const [showParamPicker, setShowParamPicker] = useState(false);
    const [showModePicker, setShowModePicker] = useState(false);

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
    const modeConfig = AUTOMATION_MODE_CONFIG[automationMode];
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
        setShowParamPicker(false);
    };

    const handleRemoveLane = (laneId: string) => {
        removeAutomationLane(laneId);
    };

    if (!selectedTrack) {
        return (
            <div className="flex h-full items-center justify-center bg-surface-base/50">
                <div className="text-center space-y-1">
                    <p className="text-sm text-muted-foreground">No track selected</p>
                    <p className="text-[10px] text-muted-foreground/60">
                        Select a track to view and edit its automation
                    </p>
                </div>
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
                    <div className="flex items-center gap-2 px-2 h-7 bg-surface-raised/50 border-b border-border/20 shrink-0">
                        <div className="size-2.5 rounded-sm" style={{ backgroundColor: trackColor }} />
                        <span className="text-xs font-medium text-foreground truncate flex-1">{selectedTrack.name}</span>
                    </div>

                    {/* Automation mode selector */}
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/20 shrink-0 relative">
                        <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Mode</span>
                        <button
                            type="button"
                            className={cn(
                                'px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider transition-colors',
                                automationMode === 'write' && 'animate-pulse'
                            )}
                            style={{
                                backgroundColor: `${modeConfig.color}20`,
                                color: modeConfig.textColor,
                                border: `1px solid ${modeConfig.color}40`,
                            }}
                            onClick={() => setShowModePicker(!showModePicker)}
                            aria-label={`Automation mode: ${automationMode}`}
                        >
                            {modeConfig.label}
                        </button>

                        {showModePicker ? (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowModePicker(false)}
                                />
                                <div className="absolute left-2 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-xl py-1 min-w-[100px]">
                                    {MODE_OPTIONS.map((opt) => {
                                        const cfg = AUTOMATION_MODE_CONFIG[opt.value];
                                        return (
                                            <button
                                                type="button"
                                                key={opt.value}
                                                className={cn(
                                                    'w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2',
                                                    automationMode === opt.value && 'font-medium'
                                                )}
                                                onClick={() => {
                                                    setAutomationMode(selectedTrackId!, opt.value);
                                                    setShowModePicker(false);
                                                }}
                                            >
                                                <span
                                                    className="size-2 rounded-full"
                                                    style={{ backgroundColor: cfg.color }}
                                                />
                                                <span
                                                    style={{
                                                        color: automationMode === opt.value ? cfg.textColor : undefined,
                                                    }}
                                                >
                                                    {opt.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        ) : null}

                        <span className="text-[9px] text-muted-foreground ml-auto">
                            {trackLanes.length} lane{trackLanes.length !== 1 ? 's' : ''}
                        </span>
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
                    <div className="flex flex-col shrink-0 relative">
                        {showParamPicker ? (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowParamPicker(false)} />
                                <div className="relative z-50 bg-surface-raised border-b border-border/20">
                                    <div className="px-2 py-1 text-[8px] text-muted-foreground/60 uppercase tracking-wider">
                                        Add parameter
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {unusedParams.map((param) => (
                                            <button
                                                type="button"
                                                key={param.id}
                                                className="w-full text-left px-2.5 py-1.5 text-[10px] text-foreground hover:bg-accent/50 transition-colors flex items-center gap-1.5"
                                                onClick={() => handleAddLane(param.id, param.name)}
                                            >
                                                <Plus className="size-2.5 text-muted-foreground/50" />
                                                {param.name}
                                            </button>
                                        ))}
                                        {unusedParams.length === 0 ? (
                                            <div className="px-2.5 py-2 text-[10px] text-muted-foreground/50 italic">
                                                All parameters have lanes
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <button
                                type="button"
                                className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-base/50 transition-colors"
                                onClick={() => setShowParamPicker(true)}
                            >
                                <Plus className="size-3" />
                                Add Lane
                                {unusedParams.length > 0 ? (
                                    <span className="text-[8px] text-muted-foreground/40 ml-auto">
                                        {unusedParams.length} available
                                    </span>
                                ) : null}
                            </button>
                        )}
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
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center space-y-2">
                                <p className="text-xs text-muted-foreground">No automation lanes</p>
                                <p className="text-[10px] text-muted-foreground/60">
                                    Click "Add Lane" to add Volume, Pan, or device parameter automation
                                </p>
                            </div>
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
