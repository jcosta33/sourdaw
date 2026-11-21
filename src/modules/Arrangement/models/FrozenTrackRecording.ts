import { type Track } from './Track';

export const FROZEN_TRACK_RECORDING_MESSAGE = 'Unfreeze the track to record on it.';

/** A frozen track plays only its frozen buffer, so a take recorded onto it would be silent. */
export function isFrozenTrackRefusingRecording(track: Pick<Track, 'frozen'>): boolean {
    return track.frozen === true;
}
