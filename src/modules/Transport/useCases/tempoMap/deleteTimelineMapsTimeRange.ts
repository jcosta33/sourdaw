import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

type DeleteTimelineMapsTimeRangeInput = {
    startBeat: number;
    endBeat: number;
};

export function deleteTimelineMapsTimeRange(input: DeleteTimelineMapsTimeRangeInput): void {
    const duration = input.endBeat - input.startBeat;

    const tempoState = tempoMapStore.value;
    if (tempoState) {
        tempoMapStore.set({
            ...tempoState,
            changes: tempoState.changes
                .filter((change) => change.beat < input.startBeat || change.beat >= input.endBeat)
                .map((change) => (change.beat >= input.endBeat ? { ...change, beat: change.beat - duration } : change)),
        });
    }

    const timeSignatureState = timeSignatureMapStore.value;
    if (timeSignatureState) {
        timeSignatureMapStore.set({
            ...timeSignatureState,
            changes: timeSignatureState.changes
                .filter((change) => change.beat < input.startBeat || change.beat >= input.endBeat)
                .map((change) => (change.beat >= input.endBeat ? { ...change, beat: change.beat - duration } : change)),
        });
    }
}
