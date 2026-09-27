import { isMidiNoteSnapshot } from './isMidiNoteSnapshot';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absentBucketContradictsSnapshot(
    payload: JsonRecord,
    bucketPresentKey: 'expectedNotesBucketPresent' | 'notesBucketPresent',
    notesKey: 'expectedNotes' | 'notes'
): boolean {
    return payload[bucketPresentKey] === false && Array.isArray(payload[notesKey]) && payload[notesKey].length > 0;
}

export function isRestoreMidiClipNotesReplayArguments(value: unknown): boolean {
    return (
        isRecord(value) &&
        isMidiNoteSnapshot(value.notes) &&
        isMidiNoteSnapshot(value.expectedNotes) &&
        (value.articulationReplayGuard === undefined ||
            (isRecord(value.articulationReplayGuard) &&
                isMidiNoteSnapshot(value.articulationReplayGuard.expectedSourceNotes))) &&
        !absentBucketContradictsSnapshot(value, 'notesBucketPresent', 'notes') &&
        !absentBucketContradictsSnapshot(value, 'expectedNotesBucketPresent', 'expectedNotes')
    );
}
