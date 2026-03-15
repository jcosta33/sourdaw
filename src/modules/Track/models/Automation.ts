export type AutomationPoint = {
    beat: number;
    value: number;
    curve: "linear" | "exponential" | "step";
};

export type AutomationLane = {
    id: string;
    trackId: string;
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
): AutomationLane => ({
    id: `auto-${nextLaneId++}`,
    trackId,
    parameterId,
    parameterName,
    points: [],
    visible: false,
    minValue,
    maxValue,
});
