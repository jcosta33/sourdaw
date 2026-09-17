import { type MidiClipDataActionSnapshot, type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';
import { DEFAULT_NOTE_PROBABILITY } from '#/utils/midiData';

import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { snapshotMidiClipData } from './snapshotMidiClipData';

type MidiClipFanOutCopy = {
    sourceClipId: string;
    targetClipId: string;
};

type PrepareMidiClipFanOutStateInput = {
    /**
     * Every clip whose MIDI data this transition retires, in the order the
     * caller wants the snapshots to list them. A source without a copy is
     * retired outright — the clip stops existing, so nothing can read its rows.
     */
    sourceClipIds: readonly string[];
    /** Which target receives a copy of which source's rows. */
    copies: readonly MidiClipFanOutCopy[];
};

const ABSENT_CLIP_DATA: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function hasIdentityDependentProbability(probability: number | undefined): boolean {
    const resolved = probability ?? DEFAULT_NOTE_PROBABILITY;
    return resolved > 0 && resolved < 100;
}

/** Whether any source row would make the copy sound different from the original. */
function hasUncopyableRows(state: MidiStoreState, sourceClipId: string): boolean {
    const notes = state.notesByClipId[sourceClipId] ?? [];
    if (
        notes.some(
            (note) =>
                !Number.isFinite(note.startBeat) ||
                !Number.isFinite(note.duration) ||
                note.duration < 0 ||
                // The probability roll is seeded by clip id, so a copy under a
                // new id would keep or drop different notes than the original.
                // Only a note that always sounds or never sounds survives the
                // re-identification unchanged — the same rule glue applies.
                hasIdentityDependentProbability(note.probability)
        )
    ) {
        return true;
    }
    return (
        (state.ccByClipId[sourceClipId] ?? []).some((row) => !Number.isFinite(row.beat)) ||
        (state.pitchBendByClipId[sourceClipId] ?? []).some((row) => !Number.isFinite(row.beat))
    );
}

function copyClipData(state: MidiStoreState, sourceClipId: string): MidiClipDataActionSnapshot {
    const source = snapshotMidiClipData(state, sourceClipId);
    return {
        notes: {
            present: source.notes.present,
            value: source.notes.value.map((note) => ({ ...note, id: `note-dup-${crypto.randomUUID()}` })),
        },
        controlChanges: {
            present: source.controlChanges.present,
            value: source.controlChanges.value.map((row) => ({ ...row, id: `cc-dup-${crypto.randomUUID()}` })),
        },
        pitchBends: {
            present: source.pitchBends.present,
            value: source.pitchBends.value.map((row) => ({ ...row, id: `pb-dup-${crypto.randomUUID()}` })),
        },
    };
}

/**
 * Where the absolute-note migration markers land once each source's rows live
 * on its targets instead: the live list with every source removed and each
 * target inserted in its source's place, so a target inherits the marker
 * exactly when its source carried one. A marker names data that has already
 * been converted, and the copies carry that same converted data.
 */
function projectMigrationMarkers({
    liveMarkers,
    sourceClipIds,
    copies,
}: {
    liveMarkers: readonly string[];
    sourceClipIds: readonly string[];
    copies: readonly MidiClipFanOutCopy[];
}): string[] {
    const sourceIdSet = new Set(sourceClipIds);
    const targetIdSet = new Set(copies.map((copy) => copy.targetClipId));
    return liveMarkers.flatMap((clipId) => {
        if (targetIdSet.has(clipId)) {
            return [];
        }
        if (!sourceIdSet.has(clipId)) {
            return [clipId];
        }
        return copies.filter((copy) => copy.sourceClipId === clipId).map((copy) => copy.targetClipId);
    });
}

/**
 * The MIDI half of a transition that replaces a set of clips with a set of
 * copies cut from them — Flatten comp materialising the take programme, where
 * one recorded clip can fan out into several fragments.
 *
 * Both snapshots list exactly the same clip ids in the same order, which is
 * what `clipGlueStateRestorable` and `midiClipGlueStateMatches` require of the
 * transition they guard, and what lets one `restoreClipGlueState` call replay
 * the whole thing in either direction.
 *
 * Returns `null` rather than a partial plan whenever the copy could not
 * reproduce what the sources sound like, or a target is already occupied.
 */
export function prepareMidiClipFanOutState({ sourceClipIds, copies }: PrepareMidiClipFanOutStateInput): {
    previous: MidiClipGlueActionSnapshot;
    next: MidiClipGlueActionSnapshot;
} | null {
    const state = midiStore.value;
    if (!state || sourceClipIds.length === 0) {
        return null;
    }
    const targetClipIds = copies.map((copy) => copy.targetClipId);
    const clipIds = [...sourceClipIds, ...targetClipIds];
    if (
        new Set(clipIds).size !== clipIds.length ||
        clipIds.some((clipId) => clipId.length === 0) ||
        copies.some((copy) => !sourceClipIds.includes(copy.sourceClipId))
    ) {
        return null;
    }
    const liveMarkers = state.migratedAbsoluteNoteClipIds ?? [];
    if (new Set(liveMarkers).size !== liveMarkers.length) {
        return null;
    }
    if (sourceClipIds.some((sourceClipId) => hasUncopyableRows(state, sourceClipId))) {
        return null;
    }

    const previous: MidiClipGlueActionSnapshot = {
        clips: clipIds.map((clipId) => ({ clipId, data: snapshotMidiClipData(state, clipId) })),
        migratedAbsoluteNoteClipIds: {
            present: state.migratedAbsoluteNoteClipIds !== undefined,
            value: structuredClone(liveMarkers),
        },
    };
    const targetOccupied = previous.clips
        .filter((clip) => targetClipIds.includes(clip.clipId))
        .some(
            (clip) =>
                clip.data.notes.present ||
                clip.data.controlChanges.present ||
                clip.data.pitchBends.present ||
                liveMarkers.includes(clip.clipId)
        );
    if (targetOccupied) {
        return null;
    }

    const migratedIds = projectMigrationMarkers({ liveMarkers, sourceClipIds, copies });
    const next: MidiClipGlueActionSnapshot = {
        clips: [
            ...sourceClipIds.map((clipId) => ({ clipId, data: structuredClone(ABSENT_CLIP_DATA) })),
            ...copies.map((copy) => ({ clipId: copy.targetClipId, data: copyClipData(state, copy.sourceClipId) })),
        ],
        migratedAbsoluteNoteClipIds: {
            present: previous.migratedAbsoluteNoteClipIds.present || migratedIds.length > 0,
            value: migratedIds,
        },
    };
    return { previous, next };
}
