import { type MidiClipDataActionSnapshot, type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';

import { midiStore, type MidiStoreState } from '../../stores/midiStore';

export type MidiClipGlueStateMatchInput = {
    expected: MidiClipGlueActionSnapshot;
    replacement: MidiClipGlueActionSnapshot;
};

function snapshotClipData(state: MidiStoreState, clipId: string): MidiClipDataActionSnapshot {
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

/** Same precondition `restoreMidiClipGlueState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without triggering the write that `restoreMidiClipGlueState` performs once
 *  the precondition holds.
 *
 *  `state` is a parameter so the write path can check and write against one store read. A caller
 *  that only preflights omits it. */
export function midiClipGlueStateMatches(
    { expected, replacement }: MidiClipGlueStateMatchInput,
    state: MidiStoreState | null = midiStore.value
): boolean {
    const expectedIds = expected.clips.map((clip) => clip.clipId);
    const replacementIds = replacement.clips.map((clip) => clip.clipId);
    return (
        state !== null &&
        state !== undefined &&
        new Set(expectedIds).size === expectedIds.length &&
        JSON.stringify(expectedIds) === JSON.stringify(replacementIds) &&
        expected.clips.every(
            (clip) => JSON.stringify(snapshotClipData(state, clip.clipId)) === JSON.stringify(clip.data)
        ) &&
        JSON.stringify(expected.migratedAbsoluteNoteClipIds.value.filter((clipId) => expectedIds.includes(clipId))) ===
            JSON.stringify((state.migratedAbsoluteNoteClipIds ?? []).filter((clipId) => expectedIds.includes(clipId)))
    );
}
