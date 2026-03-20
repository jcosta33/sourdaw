import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { addAutomationLane, toggleLaneCollapsed } from '#/modules/Track/useCases/automationUseCases';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { AutomationLaneRow } from './AutomationLaneRow';
import { getAutomatableParams, AUTOMATION_MODE_CONFIG } from './automationViewHelpers';
import { type AutomationMode } from '#/modules/Track/models/Track';
import { type AutomationLane } from '#/modules/Track/models/Automation';
import { setAutomationMode } from '#/modules/Track/useCases/toggleTrackState';

type TrackAutomationSectionProps = {
    trackId: string;
    trackName: string;
    trackColor: string;
    automationMode: AutomationMode;
    devices: { type: string; name: string }[];
    pixelsPerBeat: number;
    scrollX: number;
    containerWidth: number;
};

const MODE_OPTIONS: { value: AutomationMode; label: string }[] = [
    { value: 'read', label: 'Read' },
    { value: 'touch', label: 'Touch' },
    { value: 'latch', label: 'Latch' },
    { value: 'write', label: 'Write' },
    { value: 'off', label: 'Off' },
];

const SPARKLINE_HEIGHT = 24;

/** Render a mini sparkline SVG for collapsed automation lanes. */
const LaneSparkline = ({ lane, trackColor, width }: { lane: AutomationLane; trackColor: string; width: number }): ReactElement => {
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
                <span className="text-[8px] text-muted-foreground/60 truncate max-w-[80px]">
                    {lane.parameterName}
                </span>
            </div>
            <svg width={width} height={SPARKLINE_HEIGHT} className="absolute inset-0">
                <path d={pathData} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.5} />
            </svg>
        </div>
    );
};

export const TrackAutomationSection = ({
    trackId,
    trackName,
    trackColor,
    automationMode,
    devices,
    pixelsPerBeat,
    scrollX,
    containerWidth,
}: TrackAutomationSectionProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [showParamPicker, setShowParamPicker] = useState(false);
    const [showModePicker, setShowModePicker] = useState(false);

    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(() => cb()),
        () => automationStore.value,
        () => automationStore.value
    );

    const trackLanes = (autoState?.lanes ?? []).filter((l) => l.trackId === trackId && !l.clipId);
    const availableParams = getAutomatableParams(trackId, devices);
    const modeConfig = AUTOMATION_MODE_CONFIG[automationMode];

    const handleAddLane = (paramId: string, paramName: string) => {
        addAutomationLane(trackId, paramId, paramName);
        setShowParamPicker(false);
    };

    return (
        <div className="border-b border-border/30">
            <div
                className="flex items-center gap-2 px-2 h-8 bg-surface-raised/50 border-b border-border/20 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="size-2.5 rounded-sm" style={{ backgroundColor: trackColor }} />
                <ChevronDown
                    className={cn('size-3 text-muted-foreground transition-transform', !isExpanded && '-rotate-90')}
                />
                <span className="text-xs font-medium text-foreground truncate">{trackName}</span>

                {/* Automation mode badge */}
                <div className="relative ml-auto flex items-center gap-1.5">
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
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowModePicker(!showModePicker);
                        }}
                        aria-label={`Automation mode: ${automationMode}`}
                    >
                        {modeConfig.label}
                    </button>

                    {showModePicker && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowModePicker(false); }} />
                            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-xl py-1 min-w-[100px]">
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
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setAutomationMode(trackId, opt.value);
                                                setShowModePicker(false);
                                            }}
                                        >
                                            <span className="size-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                                            <span style={{ color: automationMode === opt.value ? cfg.textColor : undefined }}>
                                                {opt.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    <span className="text-[9px] text-muted-foreground">
                        {trackLanes.length} lane{trackLanes.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {isExpanded && (
                <div>
                    {trackLanes.map((lane) =>
                        lane.collapsed ? (
                            <LaneSparkline
                                key={lane.id}
                                lane={lane}
                                trackColor={trackColor}
                                width={containerWidth}
                            />
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
                    )}

                    <div className="flex items-center gap-1 px-2 py-1 bg-surface-base/30">
                        <div className="relative">
                            <button
                                type="button"
                                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => setShowParamPicker(!showParamPicker)}
                            >
                                <Plus className="size-3" />
                                Add Lane
                            </button>

                            {showParamPicker && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowParamPicker(false)} />
                                    <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-xl py-1 min-w-[200px] max-h-[300px] overflow-y-auto">
                                        {availableParams
                                            .filter((p) => !trackLanes.some((l) => l.parameterId === p.id))
                                            .map((param) => (
                                                <button
                                                    type="button"
                                                    key={param.id}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                                    onClick={() => handleAddLane(param.id, param.name)}
                                                >
                                                    {param.name}
                                                </button>
                                            ))}
                                        {availableParams.filter((p) => !trackLanes.some((l) => l.parameterId === p.id))
                                            .length === 0 && (
                                            <div className="px-3 py-2 text-[10px] text-muted-foreground italic">
                                                All parameters have lanes
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
