import type { SessionActionEntry } from '../stores/undoSessionMirror';

import type { ExecutableAppActionType } from './executableAppActionRegistry';

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

function isMaterializedAddNote(value: unknown): value is JsonRecord & { id: string } {
    return isRecord(value) && typeof value.id === 'string' && value.id.length > 0;
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

function hasExactAddNotesRestorePair(entry: SessionActionEntry): boolean {
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
        !Array.isArray(actionPayload.notes) ||
        actionPayload.notes.length === 0 ||
        !actionPayload.notes.every(isMaterializedAddNote) ||
        !Array.isArray(inversePayload.notes) ||
        !Array.isArray(inversePayload.expectedNotes) ||
        !Array.isArray(redoPayload.notes) ||
        !Array.isArray(redoPayload.expectedNotes) ||
        !isWritableMidiClipReplayGuard(inversePayload.noteTransformReplayGuard) ||
        !isWritableMidiClipReplayGuard(redoPayload.noteTransformReplayGuard)
    ) {
        return false;
    }

    const noteIds = actionPayload.notes.map((note) => note.id);
    if (new Set(noteIds).size !== noteIds.length) {
        return false;
    }

    const expectedAddedNotes = inversePayload.expectedNotes.slice(inversePayload.notes.length);
    if (
        inversePayload.expectedNotes.length !== inversePayload.notes.length + actionPayload.notes.length ||
        !valuesEqual(inversePayload.expectedNotes.slice(0, inversePayload.notes.length), inversePayload.notes) ||
        !valuesEqual(redoPayload.notes, inversePayload.expectedNotes) ||
        !valuesEqual(redoPayload.expectedNotes, inversePayload.notes) ||
        !valuesEqual(redoPayload.noteTransformReplayGuard, inversePayload.noteTransformReplayGuard)
    ) {
        return false;
    }

    return actionPayload.notes.every((note, index) => {
        const snapshot: unknown = expectedAddedNotes[index];
        return (
            isRecord(snapshot) &&
            snapshot.id === note.id &&
            snapshot.pitch === note.pitch &&
            snapshot.startBeat === note.startBeat &&
            snapshot.duration === note.duration &&
            snapshot.velocity === (note.velocity ?? 100)
        );
    });
}

export function getCommandUndoSessionEntryValidator(
    actionType: ExecutableAppActionType
): ((entry: SessionActionEntry) => boolean) | undefined {
    return actionType === 'addNotes' ? hasExactAddNotesRestorePair : undefined;
}
