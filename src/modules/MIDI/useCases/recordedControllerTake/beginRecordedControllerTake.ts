import { activeRecordingRef } from '#/modules/Arrangement/stores';

import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { readHeldPedalRows } from './readHeldPedalRows';

/**
 * Start a take's controller recording at the transport's recording rising edge.
 *
 * Nothing a previous take buffered carries over. The pedals held on the live
 * input are read now, before the take's own messages move them, because a pedal
 * pressed before the take is still down when it begins and no message will say
 * so. The clips the recorder just opened are the ones whose commit flushes
 * their rows; `startRecording` opens them before the transport reports
 * recording.
 */
export function beginRecordedControllerTake(): void {
    const { buffers, openedClipIds, committedClipIds } = recordedControllerTakeState;
    buffers.clear();
    committedClipIds.clear();
    openedClipIds.clear();
    for (const clipId of activeRecordingRef.current) {
        openedClipIds.add(clipId);
    }

    const trackId = getTargetTrackId();
    recordedControllerTakeState.heldPedalSeed = trackId === null ? null : { trackId, rows: readHeldPedalRows() };
}
