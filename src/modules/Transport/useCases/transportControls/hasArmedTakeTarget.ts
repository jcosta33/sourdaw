import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { isTakeTargetTrack } from './isTakeTargetTrack';

/** Whether `startRecording` would open a take clip anywhere. */
export function hasArmedTakeTarget(): boolean {
    return (getTrackStoreState()?.tracks ?? []).some(isTakeTargetTrack);
}
