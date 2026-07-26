/**
 * Arrangement-local view shape of Automation's lane/point/curve models
 * (AGENTS.md §95 — model isolation). These are NOT re-exports.
 */

export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';

export type AutomationPoint = {
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension: number;
    stairSteps?: number;
    cp1?: { x: number; y: number };
    cp2?: { x: number; y: number };
};

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
