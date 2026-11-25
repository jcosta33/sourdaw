import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { isTakeTargetTrack } from './isTakeTargetTrack';

/** The armed audio tracks hardware capture starts for: take targets only, so a frozen track never asks for the input. */
export function readTakeTargetAudioTracks() {
    return (getTrackStoreState()?.tracks ?? []).filter((track) => track.kind === 'audio' && isTakeTargetTrack(track));
}
