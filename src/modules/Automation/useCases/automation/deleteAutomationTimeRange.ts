import { automationStore } from '../../stores/automationStore';

type DeleteAutomationTimeRangeInput = {
    startBeat: number;
    endBeat: number;
};

export function deleteAutomationTimeRange(input: DeleteAutomationTimeRangeInput): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const duration = input.endBeat - input.startBeat;
    automationStore.set({
        ...state,
        lanes: state.lanes.map((lane) => ({
            ...lane,
            points: lane.points
                .filter((point) => point.beat < input.startBeat || point.beat >= input.endBeat)
                .map((point) => (point.beat >= input.endBeat ? { ...point, beat: point.beat - duration } : point)),
        })),
    });
}
