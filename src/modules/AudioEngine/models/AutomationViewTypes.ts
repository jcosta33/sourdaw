/**
 * AudioEngine-local view shape of Automation's lane/point models
 * (AGENTS.md §95 — model isolation). Only the fields the scheduler consumes.
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

export type AutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    // F3.3 linked/inverted automation — offline follows these exactly as the
    // live path does (AU-3), via the shared #/utils/automationLaneLink resolver.
    linkedLaneId?: string;
    linkScale?: number;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
    trimPoints?: AutomationPoint[];
    enabled: boolean;
    minValue: number;
    maxValue: number;
};
