export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';

export type AutomationPoint = {
    id?: string;
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension: number; // -1.0 to +1.0: negative = log, positive = exp, 0 = linear
    stairSteps?: number; // For 'stairs' curve: number of steps (2–32, default 4)
    cp1?: { x: number; y: number }; // Normalized (0..1) bezier control point 1
    cp2?: { x: number; y: number }; // Normalized (0..1) bezier control point 2
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
    /** H2: Which properties are locally overridden on this instance. */
    overrides?: Record<string, boolean>;
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
    ghostPoints?: AutomationPoint[]; // F3.2: AI-suggested or inactive take points
    visible: boolean;
    enabled: boolean;
    collapsed: boolean; // Accordion state — collapsed shows sparkline
    linkedLaneId?: string; // F3.3: ID of another lane this one follows
    linkScale?: number; // F3.3: Scaling factor for linked automation (e.g., -1 for inversion)
    minValue: number;
    maxValue: number;
    viewMinValue?: number; // Per-lane Y-axis zoom (null = use minValue)
    viewMaxValue?: number; // Per-lane Y-axis zoom (null = use maxValue)
    color?: string; // Defaults to track color if unset
};

export function createAutomationLane(
    trackId: string,
    parameterId: string,
    parameterName: string,
    minValue = 0,
    maxValue = 1,
    clipId?: string
): AutomationLane {
    return {
        // Full UUID (not a 32-bit truncation) so lane ids stay unique across a
        // persisted/merged project regardless of how many lanes it accumulates.
        id: `auto-${crypto.randomUUID()}`,
        trackId,
        clipId,
        parameterId,
        parameterName,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue,
        maxValue,
    };
}
