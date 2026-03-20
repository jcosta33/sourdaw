import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { addAutomationLane } from '../../../useCases/workspaceViewActions';
import { Plus, ChevronDown } from 'lucide-react';
import { AutomationLaneRow } from './AutomationLaneRow';
import { getAutomatableParams } from './automationViewHelpers';

type TrackAutomationSectionProps = {
    trackId: string;
    trackName: string;
    trackColor: string;
    devices: { type: string; name: string }[];
    pixelsPerBeat: number;
    scrollX: number;
    containerWidth: number;
};

export const TrackAutomationSection = ({
    trackId,
    trackName,
    trackColor,
    devices,
    pixelsPerBeat,
    scrollX,
    containerWidth,
}: TrackAutomationSectionProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [showParamPicker, setShowParamPicker] = useState(false);

    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(() => cb()),
        () => automationStore.value,
        () => automationStore.value
    );

    const trackLanes = (autoState?.lanes ?? []).filter((l) => l.trackId === trackId && !l.clipId);
    const availableParams = getAutomatableParams(trackId, devices);

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
                <span className="text-[9px] text-muted-foreground ml-auto">
                    {trackLanes.length} lane{trackLanes.length !== 1 ? 's' : ''}
                </span>
            </div>

            {isExpanded && (
                <div>
                    {trackLanes.map((lane) => (
                        <AutomationLaneRow
                            key={lane.id}
                            lane={lane}
                            pixelsPerBeat={pixelsPerBeat}
                            scrollX={scrollX}
                            containerWidth={containerWidth}
                        />
                    ))}

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
