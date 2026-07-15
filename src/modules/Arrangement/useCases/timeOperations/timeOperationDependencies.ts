type ShiftTimelineMapsAfterBeatInput = {
    atBeat: number;
    deltaBeats: number;
};

export type TimeOperationDependencies = {
    shiftTimelineMapsAfterBeat: (input: ShiftTimelineMapsAfterBeatInput) => void;
    deleteTimelineMapsTimeRange: (input: { startBeat: number; endBeat: number }) => void;
};

export let timeOperationDependencies: TimeOperationDependencies | null = null;

export function setTimeOperationDependencies(deps: TimeOperationDependencies | null): void {
    timeOperationDependencies = deps;
}
