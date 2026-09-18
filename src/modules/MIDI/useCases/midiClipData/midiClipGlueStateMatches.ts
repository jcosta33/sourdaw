import { type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { snapshotMidiClipData } from './snapshotMidiClipData';

export type MidiClipGlueStateMatchInput = {
    expected: MidiClipGlueActionSnapshot;
    replacement: MidiClipGlueActionSnapshot;
};

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
        expected.clips.every((clip) => valuesEqual(snapshotMidiClipData(state, clip.clipId), clip.data)) &&
        JSON.stringify(expected.migratedAbsoluteNoteClipIds.value.filter((clipId) => expectedIds.includes(clipId))) ===
            JSON.stringify((state.migratedAbsoluteNoteClipIds ?? []).filter((clipId) => expectedIds.includes(clipId)))
    );
}
