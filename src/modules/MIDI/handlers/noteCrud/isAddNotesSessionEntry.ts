import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { isRestoreMidiClipNotesReplayArguments } from '../../transformers/isRestoreMidiClipNotesReplayArguments';

import { isMaterializedAddNotesArguments } from './isMaterializedAddNotesArguments';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) {
        return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]))
    );
}

function isRestoreMidiClipNotesAction(value: unknown): value is { type: 'restoreMidiClipNotes'; payload: JsonRecord } {
    return isRecord(value) && value.type === 'restoreMidiClipNotes' && isRecord(value.payload);
}

function isWritableMidiClipReplayGuard(value: unknown): value is JsonRecord {
    return (
        isRecord(value) &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        value.expectedTrackFrozen === false &&
        value.expectedClipLocked === false
    );
}

function getStringIds(values: readonly unknown[]): string[] | null {
    const ids: string[] = [];
    for (const value of values) {
        if (!isRecord(value) || typeof value.id !== 'string') {
            return null;
        }
        ids.push(value.id);
    }
    return ids;
}

export function isAddNotesSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'addNotes' ||
        !isRecord(entry.action.payload) ||
        !isRestoreMidiClipNotesAction(entry.inverseAction) ||
        !isRestoreMidiClipNotesAction(entry.redoAction)
    ) {
        return false;
    }

    const actionPayload = entry.action.payload;
    const inversePayload = entry.inverseAction.payload;
    const redoPayload = entry.redoAction.payload;
    if (
        typeof actionPayload.clipId !== 'string' ||
        actionPayload.clipId !== inversePayload.clipId ||
        actionPayload.clipId !== redoPayload.clipId ||
        !Array.isArray(inversePayload.notes) ||
        !Array.isArray(inversePayload.expectedNotes) ||
        !Array.isArray(redoPayload.notes) ||
        !Array.isArray(redoPayload.expectedNotes) ||
        !isRestoreMidiClipNotesReplayArguments(inversePayload) ||
        !isRestoreMidiClipNotesReplayArguments(redoPayload) ||
        typeof inversePayload.notesBucketPresent !== 'boolean' ||
        typeof inversePayload.expectedNotesBucketPresent !== 'boolean' ||
        typeof redoPayload.notesBucketPresent !== 'boolean' ||
        typeof redoPayload.expectedNotesBucketPresent !== 'boolean' ||
        Object.hasOwn(inversePayload, 'allowMissingExpectedEmpty') ||
        Object.hasOwn(redoPayload, 'allowMissingExpectedEmpty') ||
        !isWritableMidiClipReplayGuard(inversePayload.noteTransformReplayGuard) ||
        !isWritableMidiClipReplayGuard(redoPayload.noteTransformReplayGuard)
    ) {
        return false;
    }

    if (!isMaterializedAddNotesArguments(actionPayload)) {
        return false;
    }
    const noteIds = actionPayload.notes.map((note) => note.id);
    const baseNoteIds = getStringIds(inversePayload.notes);
    if (baseNoteIds === null) {
        return false;
    }
    const baseNoteIdSet = new Set(baseNoteIds);
    if (new Set(noteIds).size !== noteIds.length || noteIds.some((id) => baseNoteIdSet.has(id))) {
        return false;
    }

    const expectedAddedNotes = inversePayload.expectedNotes.slice(inversePayload.notes.length);
    if (
        inversePayload.expectedNotes.length !== inversePayload.notes.length + actionPayload.notes.length ||
        !valuesEqual(inversePayload.expectedNotes.slice(0, inversePayload.notes.length), inversePayload.notes) ||
        !valuesEqual(redoPayload.notes, inversePayload.expectedNotes) ||
        !valuesEqual(redoPayload.expectedNotes, inversePayload.notes) ||
        inversePayload.notesBucketPresent !== redoPayload.expectedNotesBucketPresent ||
        inversePayload.expectedNotesBucketPresent !== redoPayload.notesBucketPresent ||
        !valuesEqual(redoPayload.noteTransformReplayGuard, inversePayload.noteTransformReplayGuard)
    ) {
        return false;
    }

    return actionPayload.notes.every((note, index) => valuesEqual(expectedAddedNotes[index], note));
}
