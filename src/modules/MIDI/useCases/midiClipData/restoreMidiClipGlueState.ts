import { type MidiClipDataActionSnapshot, type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';

import { midiStore, type MidiStoreState } from '../../stores/midiStore';

type RestoreMidiClipGlueStateInput = {
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

function replaceSlot<Row>(
    current: Record<string, Row[]>,
    clipId: string,
    replacement: { present: boolean; value: readonly Row[] }
): Record<string, Row[]> {
    const next = { ...current };
    if (!replacement.present) {
        delete next[clipId];
        return next;
    }
    next[clipId] = structuredClone([...replacement.value]);
    return next;
}

function mergeMigrationIds({
    affectedIds,
    currentIds,
    replacementIds,
}: {
    affectedIds: readonly string[];
    currentIds: readonly string[];
    replacementIds: readonly string[];
}): string[] {
    const currentAffectedIndexes = currentIds.flatMap((clipId, index) => (affectedIds.includes(clipId) ? [index] : []));
    const insertionAnchor = currentAffectedIndexes[0] ?? currentIds.length;
    const result = currentIds.filter((clipId) => !affectedIds.includes(clipId));
    let insertedReplacement = false;
    for (const clipId of replacementIds.filter((candidateId) => affectedIds.includes(candidateId))) {
        const orderIndex = replacementIds.indexOf(clipId);
        const precedingId = replacementIds
            .slice(0, orderIndex)
            .toReversed()
            .find((candidateId) => result.includes(candidateId));
        const followingId = replacementIds.slice(orderIndex + 1).find((candidateId) => result.includes(candidateId));
        let insertionIndex = Math.min(insertionAnchor, result.length);
        if (!insertedReplacement) {
            insertedReplacement = true;
        } else if (precedingId) {
            insertionIndex = result.indexOf(precedingId) + 1;
        } else if (followingId) {
            insertionIndex = Math.min(insertionIndex, result.indexOf(followingId));
        }
        result.splice(insertionIndex, 0, clipId);
    }
    return result;
}

export function restoreMidiClipGlueState({ expected, replacement }: RestoreMidiClipGlueStateInput): boolean {
    const state = midiStore.value;
    const expectedIds = expected.clips.map((clip) => clip.clipId);
    const replacementIds = replacement.clips.map((clip) => clip.clipId);
    if (
        !state ||
        new Set(expectedIds).size !== expectedIds.length ||
        JSON.stringify(expectedIds) !== JSON.stringify(replacementIds) ||
        expected.clips.some(
            (clip) => JSON.stringify(snapshotClipData(state, clip.clipId)) !== JSON.stringify(clip.data)
        ) ||
        JSON.stringify(expected.migratedAbsoluteNoteClipIds.value.filter((clipId) => expectedIds.includes(clipId))) !==
            JSON.stringify((state.migratedAbsoluteNoteClipIds ?? []).filter((clipId) => expectedIds.includes(clipId)))
    ) {
        return false;
    }

    let notesByClipId = state.notesByClipId;
    let ccByClipId = state.ccByClipId;
    let pitchBendByClipId = state.pitchBendByClipId;
    for (const clip of replacement.clips) {
        notesByClipId = replaceSlot(notesByClipId, clip.clipId, clip.data.notes);
        ccByClipId = replaceSlot(ccByClipId, clip.clipId, clip.data.controlChanges);
        pitchBendByClipId = replaceSlot(pitchBendByClipId, clip.clipId, clip.data.pitchBends);
    }
    const next: MidiStoreState = {
        ...state,
        notesByClipId,
        ccByClipId,
        pitchBendByClipId,
    };
    const currentMigrationIds = state.migratedAbsoluteNoteClipIds ?? [];
    const migratedAbsoluteNoteClipIds = mergeMigrationIds({
        affectedIds: expectedIds,
        currentIds: currentMigrationIds,
        replacementIds: replacement.migratedAbsoluteNoteClipIds.value,
    });
    const presenceChangedWithoutAffectedMarkers =
        expected.migratedAbsoluteNoteClipIds.value.every((clipId) => !expectedIds.includes(clipId)) &&
        expected.migratedAbsoluteNoteClipIds.present !== (state.migratedAbsoluteNoteClipIds !== undefined);
    const shouldKeepPresent = presenceChangedWithoutAffectedMarkers
        ? state.migratedAbsoluteNoteClipIds !== undefined
        : replacement.migratedAbsoluteNoteClipIds.present;
    if (shouldKeepPresent || migratedAbsoluteNoteClipIds.length > 0) {
        next.migratedAbsoluteNoteClipIds = structuredClone(migratedAbsoluteNoteClipIds);
    } else {
        delete next.migratedAbsoluteNoteClipIds;
    }
    midiStore.set(next);
    return true;
}
