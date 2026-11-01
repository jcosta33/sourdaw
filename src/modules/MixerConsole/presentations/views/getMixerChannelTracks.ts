import { type Track } from '../../models/TrackViewTypes';

// Folders group tracks and the master has its own dedicated strip; neither is
// an ordinary mixer channel.
export function getMixerChannelTracks(tracks: readonly Track[]): Track[] {
    return tracks.filter((track) => track.kind !== 'folder' && track.kind !== 'master');
}
