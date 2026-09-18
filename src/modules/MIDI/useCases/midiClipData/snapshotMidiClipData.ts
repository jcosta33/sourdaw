import { type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { type MidiStoreState } from '../../stores/midiStore';

/**
 * One clip's MIDI rows as a restorable snapshot.
 *
 * `present` records whether the store holds a slot for the clip at all, which
 * is not the same question as whether the slot is empty: restoring must be able
 * to put an absent clip back to absent rather than to an empty array, or the
 * store shape drifts from what the project persisted. Shared by the capture and
 * the guard so the two can never disagree about that distinction.
 */
export function snapshotMidiClipData(state: MidiStoreState, clipId: string): MidiClipDataActionSnapshot {
    return {
        notes: {
            present: Object.hasOwn(state.notesByClipId, clipId),
            value: structuredClone(state.notesByClipId[clipId] ?? []),
        },
        controlChanges: {
            present: Object.hasOwn(state.ccByClipId, clipId),
            value: structuredClone(state.ccByClipId[clipId] ?? []),
        },
        pitchBends: {
            present: Object.hasOwn(state.pitchBendByClipId, clipId),
            value: structuredClone(state.pitchBendByClipId[clipId] ?? []),
        },
    };
}
