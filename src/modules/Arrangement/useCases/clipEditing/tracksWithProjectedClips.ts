import { type Clip, type Track } from '../../stores/trackStore';

import { type ShiftedOwnerState } from './ShiftedOwnerState';

export function tracksWithProjectedClips(state: ShiftedOwnerState): readonly Track[] | null {
    if (!state.tracks) {
        return null;
    }
    const tracks: Track[] = [];
    for (const track of state.tracks) {
        const clips: Clip[] = [];
        for (const owner of state.clips.filter((candidate) => candidate.owningTrackId === track.id)) {
            const source = track.clips.find((clip) => clip.id === owner.clip.id);
            if (!source) {
                return null;
            }
            clips.push({ ...source, ...owner.clip });
        }
        tracks.push({ ...track, clips });
    }
    return tracks;
}
