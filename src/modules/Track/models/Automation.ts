export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth';

export type AutomationPoint = {
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension: number; // -1.0 to +1.0: negative = log, positive = exp, 0 = linear
    stairSteps?: number; // For 'stairs' curve: number of steps (2–32, default 4)
};

export type ClipAutomationMode = 'additive' | 'multiplicative';

export type AutomationObject = {
    id: string;
    laneId: string;
    startBeat: number;
    endBeat: number;
    points: AutomationPoint[];
    poolId?: string; // Shared ID for linked/pooled copies
    loopLength?: number; // If set, object content loops at this length
    name: string;
};

export type AutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    clipAutomationMode?: ClipAutomationMode; // Only for clip-level lanes
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
    trimPoints?: AutomationPoint[]; // Trim offset curves for non-destructive mixing rides
    objects: AutomationObject[]; // Bounded reusable automation containers
    visible: boolean;
    enabled: boolean;
    collapsed: boolean; // Accordion state — collapsed shows sparkline
    virginTerritory: boolean; // When true, gaps between points defer to manual control
    minValue: number;
    maxValue: number;
    viewMinValue?: number; // Per-lane Y-axis zoom (null = use minValue)
    viewMaxValue?: number; // Per-lane Y-axis zoom (null = use maxValue)
    color?: string; // Defaults to track color if unset
};



export const createAutomationLane = (
    trackId: string,
    parameterId: string,
    parameterName: string,
    minValue = 0,
    maxValue = 1,
    clipId?: string
): AutomationLane => ({
    id: `auto-${crypto.randomUUID().slice(0, 8)}`,
    trackId,
    clipId,
    parameterId,
    parameterName,
    points: [],
    objects: [],
    visible: false,
    enabled: true,
    collapsed: false,
    virginTerritory: true,
    minValue,
    maxValue,
});

export const createAutomationObject = (
    laneId: string,
    startBeat: number,
    endBeat: number,
    points: AutomationPoint[] = [],
    name = 'Untitled'
): AutomationObject => ({
    id: `auto-obj-${crypto.randomUUID().slice(0, 8)}`,
    laneId,
    startBeat,
    endBeat,
    points,
    name,
});
