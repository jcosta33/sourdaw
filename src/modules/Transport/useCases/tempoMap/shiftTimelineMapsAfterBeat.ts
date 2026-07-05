import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

type ShiftTimelineMapsAfterBeatInput = {
    atBeat: number;
    deltaBeats: number;
};

export function shiftTimelineMapsAfterBeat(input: ShiftTimelineMapsAfterBeatInput): void {
    const tempoState = tempoMapStore.value;
    if (tempoState) {
        tempoMapStore.set({
            ...tempoState,
            changes: tempoState.changes.map((context) =>
                context.beat >= input.atBeat ? { ...context, beat: context.beat + input.deltaBeats } : context
            ),
        });
    }

    const timeSigState = timeSignatureMapStore.value;
    if (timeSigState) {
        timeSignatureMapStore.set({
            ...timeSigState,
            changes: timeSigState.changes.map((context) =>
                context.beat >= input.atBeat ? { ...context, beat: context.beat + input.deltaBeats } : context
            ),
        });
    }
}
