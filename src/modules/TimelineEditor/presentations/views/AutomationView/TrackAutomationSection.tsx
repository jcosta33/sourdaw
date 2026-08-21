import { type ReactElement, useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { setAutomationMode } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { addAutomationLane, getAutomationLaneCeiling, toggleLaneCollapsed } from '#/modules/Automation/useCases';
import { cn } from '#/utils/Styles/cn';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { type AutomationMode } from '../../../models/TrackViewTypes';
import { getAutomatableParams } from '../../helpers/automationViewHelpers';

import { AutomationAddLaneControl, AutomationModeControl } from './AutomationControls';
import { AutomationLaneRow } from './AutomationLaneRow';

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

type TrackAutomationState = {
    lanes: AutomationLane[];
};

const SPARKLINE_HEIGHT = 24;

/** Render a mini sparkline SVG for collapsed automation lanes. */
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

    // The same derived ceiling `AutomationLaneRow` draws against, not the stored
    // scalar: a gain lane saved before the fader widened still records
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

    const autoState = useStore<TrackAutomationState>(automationStore, { lanes: [] });

    const trackLanes = autoState.lanes.filter((length) => length.trackId === trackId && !length.clipId);
    const availableParams = getAutomatableParams(trackId, devices);
    const unusedParams = availableParams.filter((param) => !trackLanes.some((lane) => lane.parameterId === param.id));

    const handleAddLane = (paramId: string, paramName: string) => {
        addAutomationLane(trackId, paramId, paramName);
    };

    return (
        <div className="border-b border-border/30">
            <Row
                gap={2}
                className="px-2 h-8 bg-surface-raised/50 border-b border-border/20 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="size-2.5 rounded-sm" style={{ backgroundColor: trackColor }} />
                <ChevronDown
                    className={cn('size-3 text-muted-foreground transition-transform', !isExpanded && '-rotate-90')}
                />
                <span className="text-xs font-medium text-foreground truncate">{trackName}</span>

                {/* Automation mode badge */}
                <AutomationModeControl
                    automationMode={automationMode}
                    laneCount={trackLanes.length}
                    align="right"
                    className="ml-auto"
                    onModeChange={(mode) => setAutomationMode(trackId, mode)}
                />
            </Row>

            {isExpanded ? (
                <div>
                    {trackLanes.map((lane) =>
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
                    )}

                    <div className="bg-surface-base/30 px-2 py-1">
                        <AutomationAddLaneControl params={unusedParams} onAdd={handleAddLane} />
                    </div>
                </div>
            ) : null}
        </div>
    );
};
