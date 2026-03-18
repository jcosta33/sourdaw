export type AutomationPoint = {
    beat: number;
    value: number;
    curve: 'linear' | 'exponential' | 'step' | 's-curve';
    tension: number; // 0 = linear, 0.5 = default smooth, 1 = hard curve
};

export type AutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
    visible: boolean;
    minValue: number;
    maxValue: number;
};

let nextLaneId = 1;

export const createAutomationLane = (
    trackId: string,
    parameterId: string,
    parameterName: string,
    minValue = 0,
    maxValue = 1,
    clipId?: string
): AutomationLane => ({
    id: `auto-${nextLaneId++}`,
    trackId,
    clipId,
    parameterId,
    parameterName,
    points: [],
    visible: false,
    minValue,
    maxValue,
});
