import { midiStore } from '../../stores/midiStore';

import { planMidiRowCoordinateShift } from './planMidiRowCoordinateShift';

type Input = {
    clipId: string;
    beatDelta: number;
    restore?: unknown;
};

type CoordinateCapture = Extract<ReturnType<typeof planMidiRowCoordinateShift>, { status: 'planned' }>['capture'];

/** Validates serialized replay data independently of today's clip and row membership. */
export function isMidiRowCoordinateCapture(value: unknown): value is CoordinateCapture {
    if (value === null || typeof value !== 'object' || !('beatDelta' in value) || typeof value.beatDelta !== 'number') {
        return false;
    }
    return (
        planMidiRowCoordinateShift({
            notes: [],
            controllers: [],
            pitchBends: [],
            beatDelta: -value.beatDelta,
            restore: value,
        }).status === 'planned'
    );
}

/** Plans every lane before either owner writes. Apply synchronously in the caller's transaction. */
export function prepareClipMidiRowCoordinateShift({ clipId, beatDelta, restore }: Input) {
    const state = midiStore.value;
    const notes = state?.notesByClipId[clipId];
    const controllers = state?.ccByClipId[clipId];
    const pitchBends = state?.pitchBendByClipId[clipId];
    const plan = planMidiRowCoordinateShift({
        notes: notes ?? [],
        controllers: controllers ?? [],
        pitchBends: pitchBends ?? [],
        beatDelta,
        restore,
    });
    if (plan.status === 'refused') {
        return plan;
    }

    const coordinates = new Map(plan.capture.coordinates.map((change) => [`${change.kind}:${change.id}`, change]));
    function nextBeat(kind: 'note' | 'cc' | 'pitchBend', id: string): number {
        const coordinate = coordinates.get(`${kind}:${id}`);
        if (!coordinate) {
            throw new Error('The complete MIDI coordinate plan is missing a current row');
        }
        return coordinate.afterBeat;
    }
    const changed = plan.capture.coordinates.some((change) => !Object.is(change.beforeBeat, change.afterBeat));
    const nextState =
        state && changed
            ? {
                  ...state,
                  notesByClipId: notes
                      ? {
                            ...state.notesByClipId,
                            [clipId]: notes.map((row) => ({ ...row, startBeat: nextBeat('note', row.id) })),
                        }
                      : state.notesByClipId,
                  ccByClipId: controllers
                      ? {
                            ...state.ccByClipId,
                            [clipId]: controllers.map((row) => ({ ...row, beat: nextBeat('cc', row.id) })),
                        }
                      : state.ccByClipId,
                  pitchBendByClipId: pitchBends
                      ? {
                            ...state.pitchBendByClipId,
                            [clipId]: pitchBends.map((row) => ({ ...row, beat: nextBeat('pitchBend', row.id) })),
                        }
                      : state.pitchBendByClipId,
              }
            : state;

    return {
        status: 'prepared' as const,
        capture: plan.capture,
        apply: (): boolean => {
            // A caller that yielded or wrote between planning and applying must
            // re-plan, including current membership and non-coordinate properties.
            if (midiStore.value !== state) {
                return false;
            }
            if (changed && nextState) {
                midiStore.set(nextState);
            }
            return true;
        },
    };
}
