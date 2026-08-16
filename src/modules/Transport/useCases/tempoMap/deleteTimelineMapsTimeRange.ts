import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

type DeleteTimelineMapsTimeRangeInput = {
    startBeat: number;
    endBeat: number;
};

export function deleteTimelineMapsTimeRange(input: DeleteTimelineMapsTimeRangeInput): void {
    // Mirrors `prepareTimelineMapTimeOperation`'s `isValidOperation`, which
    // requires a finite non-negative `startBeat`, a finite `endBeat`, and
    // `endBeat > startBeat`. NaN fails every direct comparison silently — a
    // NaN `startBeat` would otherwise pass `endBeat <= startBeat` as false and
    // delete every change below `endBeat` while rewriting the rest to
    // `beat: NaN`. A negative or infinite bound is equally not a real range.
    // All three no-op rather than guess a clamped or swapped range.
    if (
        !Number.isFinite(input.startBeat) ||
        input.startBeat < 0 ||
        !Number.isFinite(input.endBeat) ||
        input.endBeat <= input.startBeat
    ) {
        return;
    }

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
