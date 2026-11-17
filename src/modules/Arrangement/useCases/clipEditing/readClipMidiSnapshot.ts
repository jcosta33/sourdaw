import { type MidiClipDataActionSnapshot } from '#/modules/MIDI/events';
import { getMidiStoreState } from '#/modules/MIDI/useCases';

/** A clip-bounded read; absent buckets remain distinct from present empty rows. */
export function readClipMidiSnapshot(clipId: string): MidiClipDataActionSnapshot {
    const state = getMidiStoreState();
    return {
        notes: {
            present: state !== null && Object.hasOwn(state.notesByClipId, clipId),
            value: structuredClone(state?.notesByClipId[clipId] ?? []),
        },
        controlChanges: {
            present: state !== null && Object.hasOwn(state.ccByClipId, clipId),
            value: structuredClone(state?.ccByClipId[clipId] ?? []),
        },
        pitchBends: {
            present: state !== null && Object.hasOwn(state.pitchBendByClipId, clipId),
            value: structuredClone(state?.pitchBendByClipId[clipId] ?? []),
        },
    };
}
