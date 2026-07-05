import { automationStore } from '../../stores/automationStore';

type ShiftAutomationAfterBeatInput = {
    atBeat: number;
    deltaBeats: number;
};

export function shiftAutomationAfterBeat(input: ShiftAutomationAfterBeatInput): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        ...state,
        lanes: state.lanes.map((lane) => ({
            ...lane,
            points: lane.points.map((point) =>
                point.beat >= input.atBeat ? { ...point, beat: point.beat + input.deltaBeats } : point
            ),
        })),
    });
}
