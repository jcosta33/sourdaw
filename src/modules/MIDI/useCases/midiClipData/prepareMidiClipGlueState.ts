import { type MidiClipDataActionSnapshot, type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore, type MidiStoreState } from '../../stores/midiStore';

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

function snapshotState(state: MidiStoreState, clipIds: readonly string[]): MidiClipGlueActionSnapshot {
    return {
        clips: clipIds.map((clipId) => ({ clipId, data: snapshotClipData(state, clipId) })),
        migratedAbsoluteNoteClipIds: {
            present: state.migratedAbsoluteNoteClipIds !== undefined,
            value: structuredClone(state.migratedAbsoluteNoteClipIds ?? []),
        },
    };
}

function projectVisibleNote({ source, note }: { source: MidiGlueSource; note: MidiNote }): MidiNote | null {
    if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.duration) || note.duration < 0) {
        return null;
    }
    if (note.duration === 0) {
        if (note.startBeat < source.visibleStartBeat || note.startBeat >= source.visibleEndBeat) {
            return null;
        }
        return { ...note, startBeat: note.startBeat + source.beatOffset };
    }

    const clippedStartBeat = Math.max(note.startBeat, source.visibleStartBeat);
    const clippedEndBeat = Math.min(note.startBeat + note.duration, source.visibleEndBeat);
    if (clippedEndBeat <= clippedStartBeat) {
        return null;
    }
    return {
        ...note,
        startBeat: clippedStartBeat + source.beatOffset,
        duration: clippedEndBeat - clippedStartBeat,
    };
}

function hasDuplicateIds(rows: readonly { id: string }[]): boolean {
    return new Set(rows.map((row) => row.id)).size !== rows.length;
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
                (note) => !Number.isFinite(note.startBeat) || !Number.isFinite(note.duration) || note.duration < 0
            )
        ) {
            return null;
        }
        for (const note of sourceNotes) {
            const projected = projectVisibleNote({ source, note });
            if (projected) {
                mergedNotes.push(projected);
            }
        }
        const controlChanges = state.ccByClipId[source.clipId] ?? [];
        const pitchBends = state.pitchBendByClipId[source.clipId] ?? [];
        if (
            controlChanges.some((row) => !Number.isFinite(row.beat)) ||
            pitchBends.some((row) => !Number.isFinite(row.beat))
        ) {
            return null;
        }
        mergedControlChanges.push(
            ...controlChanges
                .filter((row) => row.beat >= source.visibleStartBeat && row.beat < source.visibleEndBeat)
                .map((row) => ({ ...row, beat: row.beat + source.beatOffset }))
        );
        mergedPitchBends.push(
            ...pitchBends
                .filter((row) => row.beat >= source.visibleStartBeat && row.beat < source.visibleEndBeat)
                .map((row) => ({ ...row, beat: row.beat + source.beatOffset }))
        );
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
    mergedNotes.sort((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id));
    mergedControlChanges.sort((left, right) => left.beat - right.beat || left.id.localeCompare(right.id));
    mergedPitchBends.sort((left, right) => left.beat - right.beat || left.id.localeCompare(right.id));

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
