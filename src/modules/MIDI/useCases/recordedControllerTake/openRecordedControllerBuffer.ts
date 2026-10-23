import {
    recordedControllerTakeState,
    type RecordedControllerBuffer,
} from '../../repositories/webMidi/recordedControllerTakeState';

/**
 * The clip's buffer, or `null` when the clip's commit already took it: a
 * message arriving after that belongs to no take, and the snapshot the commit
 * captured would not hold it.
 */
export function openRecordedControllerBuffer(clipId: string): RecordedControllerBuffer | null {
    const { buffers, committedClipIds } = recordedControllerTakeState;
    if (committedClipIds.has(clipId)) {
        return null;
    }
    const existing = buffers.get(clipId);
    if (existing) {
        return existing;
    }
    const created: RecordedControllerBuffer = { cc: [], pitchBend: [], registeredStateAtFirstRow: undefined };
    buffers.set(clipId, created);
    return created;
}
