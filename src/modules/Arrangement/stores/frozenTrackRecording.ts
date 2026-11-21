import { type Track } from '../models/Track';

/** A frozen track plays only its frozen buffer, so a take recorded onto it would be silent. */
export function isFrozenTrackRefusingRecording(track: Pick<Track, 'frozen'>): boolean {
    return track.frozen === true;
}
