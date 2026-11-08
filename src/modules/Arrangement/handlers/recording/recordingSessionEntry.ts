import { decodeMidiClipDataSnapshots } from '#/modules/MIDI/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { withMinimumRecordingLength } from '../../useCases/recording/withMinimumRecordingLength';
import { isRetiredTakeLanes } from '../isRetiredTakeLanes';

function recordingClip(value: unknown) {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        value.id.length === 0 ||
        typeof value.trackId !== 'string' ||
        value.trackId.length === 0
    ) {
        return null;
    }
    return isExactClipSnapshot(value, value.id, value.trackId) ? value : null;
}

/** Current recording redo captures only takes of this clip on its recording track. */
export function isRecordingRestoreSessionPayload(value: unknown): boolean {
    if (!isRecord(value) || Object.keys(value).length !== 5) {
        return false;
    }
    const clip = recordingClip(value.clip);
    if (
        !clip ||
        !Array.isArray(value.retiredTakeLanes) ||
        !isRetiredTakeLanes(value.retiredTakeLanes, clip.id, clip.trackId)
    ) {
        return false;
    }
    for (const capture of value.retiredTakeLanes) {
        if (
            !isRecord(capture) ||
            !Array.isArray(capture.retiredTakeIds) ||
            !isRecord(capture.lane) ||
            !Array.isArray(capture.lane.takes)
        ) {
            return false;
        }
        const ownIds = capture.lane.takes
            .filter((take) => isRecord(take) && take.clipId === clip.id)
            .map((take) => (isRecord(take) ? take.id : undefined));
        if (!valuesEqual(capture.retiredTakeIds, ownIds)) {
            return false;
        }
    }
    return (
        ['midiNotesSnapshot', 'midiCcSnapshot', 'midiPitchBendSnapshot'].every((key) => Object.hasOwn(value, key)) &&
        decodeMidiClipDataSnapshots({
            notesSnapshot: value.midiNotesSnapshot,
            controlChangeSnapshot: value.midiCcSnapshot,
            pitchBendSnapshot: value.midiPitchBendSnapshot,
        }) !== null
    );
}

/** JSON session storage omits undefined optional fields, including nested clip metadata. */
function serializedClipValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => (item === undefined ? null : serializedClipValue(item)));
    }
    if (!isRecord(value)) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .filter(([, field]) => field !== undefined)
            .map(([key, field]) => [key, serializedClipValue(field)])
    );
}

/** Authenticate the complete private creation/inverse/redo family without granting live removal authority. */
export function isRecordingSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'commitRecording' ||
        entry.inverseAction?.type !== 'discardRecording' ||
        entry.redoAction?.type !== 'restoreRecording'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    const clip = recordingClip(action.clip);
    if (
        !clip ||
        Object.keys(action).length !== 1 ||
        Object.keys(inverse).length !== 1 ||
        inverse.clipId !== clip.id ||
        !isRecordingRestoreSessionPayload(redo)
    ) {
        return false;
    }
    const expected = serializedClipValue(withMinimumRecordingLength(clip));
    const restored = serializedClipValue(redo.clip);
    return (
        isRecord(expected) &&
        isRecord(restored) &&
        Object.entries(expected).every(([key, value]) => valuesEqual(restored[key], value))
    );
}
