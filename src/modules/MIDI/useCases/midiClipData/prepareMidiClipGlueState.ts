import { type MidiClipDataActionSnapshot, type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';
import { DEFAULT_NOTE_PROBABILITY } from '#/utils/midiData';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { projectMidiClipWindow } from './projectMidiClipWindow';
import { snapshotMidiClipData } from './snapshotMidiClipData';

type MidiGlueSource = {
    beatOffset: number;
    clipId: string;
    visibleEndBeat: number;
    visibleStartBeat: number;
};

type PrepareMidiClipGlueStateInput = {
    sources: readonly MidiGlueSource[];
    targetClipId: string;
};

function snapshotState(state: MidiStoreState, clipIds: readonly string[]): MidiClipGlueActionSnapshot {
    return {
        clips: clipIds.map((clipId) => ({ clipId, data: snapshotMidiClipData(state, clipId) })),
        migratedAbsoluteNoteClipIds: {
            present: state.migratedAbsoluteNoteClipIds !== undefined,
            value: structuredClone(state.migratedAbsoluteNoteClipIds ?? []),
        },
    };
}

function hasDuplicateIds(rows: readonly { id: string }[]): boolean {
    return new Set(rows.map((row) => row.id)).size !== rows.length;
}

function compareCodeUnits(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

function hasIdentityDependentProbability(note: MidiNote): boolean {
    const probability = note.probability ?? DEFAULT_NOTE_PROBABILITY;
    return probability > 0 && probability < 100;
}

export function prepareMidiClipGlueState({
    sources,
    targetClipId,
}: PrepareMidiClipGlueStateInput): { previous: MidiClipGlueActionSnapshot; next: MidiClipGlueActionSnapshot } | null {
    const state = midiStore.value;
    const sourceIds = sources.map((source) => source.clipId);
    if (
        !state ||
        targetClipId.length === 0 ||
        sources.length < 2 ||
        new Set([...sourceIds, targetClipId]).size !== sources.length + 1 ||
        sources.some(
            (source) =>
                !Number.isFinite(source.beatOffset) ||
                !Number.isFinite(source.visibleStartBeat) ||
                !Number.isFinite(source.visibleEndBeat) ||
                source.visibleEndBeat <= source.visibleStartBeat
        )
    ) {
        return null;
    }
    const migrationIds = state.migratedAbsoluteNoteClipIds ?? [];
    if (new Set(migrationIds).size !== migrationIds.length) {
        return null;
    }
    const clipIds = [...sourceIds, targetClipId];
    const previous = snapshotState(state, clipIds);
    const targetSnapshot = previous.clips.at(-1)!.data;
    if (
        targetSnapshot.notes.present ||
        targetSnapshot.controlChanges.present ||
        targetSnapshot.pitchBends.present ||
        previous.migratedAbsoluteNoteClipIds.value.includes(targetClipId)
    ) {
        return null;
    }

    const mergedNotes: MidiNote[] = [];
    const mergedControlChanges: MidiCC[] = [];
    const mergedPitchBends: MidiPitchBend[] = [];
    for (const source of sources) {
        const sourceNotes = state.notesByClipId[source.clipId] ?? [];
        if (
            sourceNotes.some(
                (note) =>
                    !Number.isFinite(note.startBeat) ||
                    !Number.isFinite(note.duration) ||
                    note.duration < 0 ||
                    hasIdentityDependentProbability(note)
            )
        ) {
            return null;
        }
        const controlChanges = state.ccByClipId[source.clipId] ?? [];
        const pitchBends = state.pitchBendByClipId[source.clipId] ?? [];
        if (
            controlChanges.some((row) => !Number.isFinite(row.beat)) ||
            pitchBends.some((row) => !Number.isFinite(row.beat))
        ) {
            return null;
        }
        const projected = projectMidiClipWindow({
            notes: sourceNotes,
            controlChanges,
            pitchBends,
            window: source,
        });
        mergedNotes.push(...projected.notes);
        mergedControlChanges.push(...projected.controlChanges);
        mergedPitchBends.push(...projected.pitchBends);
    }
    if (
        mergedNotes.some((row) => !Number.isFinite(row.startBeat) || !Number.isFinite(row.duration)) ||
        mergedControlChanges.some((row) => !Number.isFinite(row.beat)) ||
        mergedPitchBends.some((row) => !Number.isFinite(row.beat)) ||
        hasDuplicateIds(mergedNotes) ||
        hasDuplicateIds(mergedControlChanges) ||
        hasDuplicateIds(mergedPitchBends)
    ) {
        return null;
    }
    mergedNotes.sort((left, right) => left.startBeat - right.startBeat || compareCodeUnits(left.id, right.id));
    // Controller rows tie-break by source order (the sort is stable), never by id:
    // ids are random, and a same-tick re-pedal must keep its order.
    mergedControlChanges.sort((left, right) => left.beat - right.beat);
    mergedPitchBends.sort((left, right) => left.beat - right.beat);

    const firstMigratedSourceIndex = previous.migratedAbsoluteNoteClipIds.value.findIndex((clipId) =>
        sourceIds.includes(clipId)
    );
    const migratedIds = previous.migratedAbsoluteNoteClipIds.value.filter(
        (clipId) => !sourceIds.includes(clipId) && clipId !== targetClipId
    );
    if (mergedNotes.length > 0) {
        const targetIndex = firstMigratedSourceIndex < 0 ? migratedIds.length : firstMigratedSourceIndex;
        migratedIds.splice(targetIndex, 0, targetClipId);
    }
    const absentData: MidiClipDataActionSnapshot = {
        notes: { present: false, value: [] },
        controlChanges: { present: false, value: [] },
        pitchBends: { present: false, value: [] },
    };
    const next: MidiClipGlueActionSnapshot = {
        clips: [
            ...sourceIds.map((clipId) => ({ clipId, data: structuredClone(absentData) })),
            {
                clipId: targetClipId,
                data: {
                    notes: { present: mergedNotes.length > 0, value: mergedNotes },
                    controlChanges: { present: mergedControlChanges.length > 0, value: mergedControlChanges },
                    pitchBends: { present: mergedPitchBends.length > 0, value: mergedPitchBends },
                },
            },
        ],
        migratedAbsoluteNoteClipIds: {
            present: previous.migratedAbsoluteNoteClipIds.present || migratedIds.length > 0,
            value: migratedIds,
        },
    };
    return { previous, next };
}
