/**
 * AudioEngine-local view shape of Automation's lane/point models
 * (AGENTS.md §95 — model isolation). Only the fields the scheduler consumes.
 */

export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth';

export type AutomationPoint = {
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension: number;
    stairSteps?: number;
};

export type AutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
    trimPoints?: AutomationPoint[];
    enabled: boolean;
    minValue: number;
    maxValue: number;
};
