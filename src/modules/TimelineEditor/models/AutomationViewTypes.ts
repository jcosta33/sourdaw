/**
 * Workspace-local view shape of Automation's lane/point/curve models
 * (AGENTS.md §95 — model isolation). These are NOT re-exports.
 */

export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';

export type AutomationPoint = {
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension: number;
    stairSteps?: number;
    /** Normalized (0..1) bezier control point 1 relative to the segment bounds */
    cp1?: { x: number; y: number };
    /** Normalized (0..1) bezier control point 2 relative to the segment bounds */
    cp2?: { x: number; y: number };
};

export type ClipAutomationMode = 'additive' | 'multiplicative';

export type AutomationObject = {
    id: string;
    laneId: string;
    startBeat: number;
    endBeat: number;
    points: AutomationPoint[];
    poolId?: string;
    loopLength?: number;
    name: string;
};

export type AutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    clipAutomationMode?: ClipAutomationMode;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
    trimPoints?: AutomationPoint[];
    objects: AutomationObject[];
    visible: boolean;
    enabled: boolean;
    collapsed: boolean;
    minValue: number;
    maxValue: number;
    viewMinValue?: number;
    viewMaxValue?: number;
    color?: string;
};
