import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

type JsonRecord = Record<string, unknown>;

const CANONICAL_ADD_NOTES_ARGUMENT_KEYS = ['clipId', 'notes'] as const;
const CANONICAL_ADD_NOTE_KEYS = ['duration', 'id', 'pitch', 'probability', 'startBeat', 'velocity'] as const;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
    const valueKeys = Object.keys(value).sort();
    const expectedKeys = [...keys].sort();
    return valueKeys.length === expectedKeys.length && valueKeys.every((key, index) => key === expectedKeys[index]);
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

function isCanonicalSerializedAddNote(value: unknown): value is JsonRecord & { id: string } {
    return (
        isRecord(value) &&
        hasExactKeys(value, CANONICAL_ADD_NOTE_KEYS) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        typeof value.pitch === 'number' &&
        Number.isInteger(value.pitch) &&
        value.pitch >= 0 &&
        value.pitch <= 127 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.duration === 'number' &&
        Number.isFinite(value.duration) &&
        value.duration >= 0.0625 &&
        typeof value.velocity === 'number' &&
        Number.isInteger(value.velocity) &&
        value.velocity >= 1 &&
        value.velocity <= 127 &&
        value.probability === 100
    );
}

function isCanonicalSerializedAddNotesArguments(value: unknown): value is JsonRecord & {
    clipId: string;
    notes: Array<JsonRecord & { id: string }>;
} {
    return (
        isRecord(value) &&
        hasExactKeys(value, CANONICAL_ADD_NOTES_ARGUMENT_KEYS) &&
        typeof value.clipId === 'string' &&
        value.clipId.trim().length > 0 &&
        Array.isArray(value.notes) &&
        value.notes.length > 0 &&
        value.notes.every(isCanonicalSerializedAddNote) &&
        new Set(value.notes.map((note) => note.id)).size === value.notes.length
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

    if (!isCanonicalSerializedAddNotesArguments(actionPayload)) {
        return false;
    }
    const noteIds = actionPayload.notes.map((note) => note.id);
    const baseNoteIds = inversePayload.notes.flatMap((note) =>
        isRecord(note) && typeof note.id === 'string' ? [note.id] : []
    );
    if (new Set(noteIds).size !== noteIds.length || noteIds.some((id) => baseNoteIds.includes(id))) {
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
