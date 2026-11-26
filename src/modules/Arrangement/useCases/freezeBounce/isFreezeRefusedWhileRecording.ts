import { readRecordingEngaged } from '#/modules/Transport/stores';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { getTrackStoreState } from '../getTrackStoreState';

export const FREEZE_REFUSED_WHILE_RECORDING_MESSAGE = 'Freeze is unavailable while this track is recording.';

/**
 * A freeze of a track that is a take target would replace the live sound under a capture
 * that is running or about to run: admitted audio is dropped without a take, overdubbed
 * notes are lost, and a count-in finds no target. Plain playback and other tracks are free.
 */
export function isFreezeRefusedWhileRecording(trackId: string): boolean {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
    if (!track?.armed || !getTrackEligibility(track.kind).acceptsRecording) {
        return false;
    }
    return readRecordingEngaged();
}
