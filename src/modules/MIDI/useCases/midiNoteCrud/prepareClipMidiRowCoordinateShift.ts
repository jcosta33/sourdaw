import { midiStore } from '../../stores/midiStore';

import { planMidiRowCoordinateShift } from './planMidiRowCoordinateShift';

type Input = {
    clipId: string;
    beatDelta: number;
    restore?: unknown;
};

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
    let nextState = state;
    if (state && changed) {
        let notesByClipId = state.notesByClipId;
        if (notes) {
            notesByClipId = {
                ...state.notesByClipId,
                [clipId]: notes.map((row) => ({ ...row, startBeat: nextBeat('note', row.id) })),
            };
        }
        let ccByClipId = state.ccByClipId;
        if (controllers) {
            ccByClipId = {
                ...state.ccByClipId,
                [clipId]: controllers.map((row) => ({ ...row, beat: nextBeat('cc', row.id) })),
            };
        }
        let pitchBendByClipId = state.pitchBendByClipId;
        if (pitchBends) {
            pitchBendByClipId = {
                ...state.pitchBendByClipId,
                [clipId]: pitchBends.map((row) => ({ ...row, beat: nextBeat('pitchBend', row.id) })),
            };
        }
        nextState = { ...state, notesByClipId, ccByClipId, pitchBendByClipId };
    }

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
