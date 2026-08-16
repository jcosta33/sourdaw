import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

type ShiftTimelineMapsAfterBeatInput = {
    atBeat: number;
    deltaBeats: number;
};

// A negative `deltaBeats` can push a shifted beat below zero. Tempo and
// time-signature changes govern every beat from their own beat forward, so a
// negative beat would not just be out of range — it would be permanently in
// effect, ahead of the project's own start. Clamp at 0 instead of leaving it
// negative. This can coincide with an untouched change already sitting at
// beat 0 (below `atBeat`); a same-beat collision from clamping is preferable
// to a change that is always active, and is resolved like any other
// same-beat duplicate — last write wins for that beat.
//
// A non-finite `deltaBeats` (e.g. NaN) would otherwise write `beat: NaN` and
// corrupt the map. Unlike a large negative shift, there is no sensible
// clamped position to fall back to, so leave the beat unchanged — the
// conservative no-op — rather than guess one.
function clampShiftedBeat(beat: number, deltaBeats: number): number {
    const shifted = beat + deltaBeats;
    if (!Number.isFinite(shifted)) {
        return beat;
    }
    return Math.max(0, shifted);
}

export function shiftTimelineMapsAfterBeat(input: ShiftTimelineMapsAfterBeatInput): void {
    const tempoState = tempoMapStore.value;
    if (tempoState) {
        tempoMapStore.set({
            ...tempoState,
            changes: tempoState.changes.map((context) =>
                context.beat >= input.atBeat
                    ? { ...context, beat: clampShiftedBeat(context.beat, input.deltaBeats) }
                    : context
            ),
        });
    }

    const timeSigState = timeSignatureMapStore.value;
    if (timeSigState) {
        timeSignatureMapStore.set({
            ...timeSigState,
            changes: timeSigState.changes.map((context) =>
                context.beat >= input.atBeat
                    ? { ...context, beat: clampShiftedBeat(context.beat, input.deltaBeats) }
                    : context
            ),
        });
    }
}
