import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { type Clip } from '../../stores/trackStore';

export function addClip(input: {
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type?: 'audio' | 'midi';
    audioBufferId?: string;
    assetHash?: string;
    isGhost?: boolean;
}): Clip | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((t) => t.id === input.trackId);
    const inferredType = input.type ?? (track?.kind === 'midi' ? 'midi' : 'audio');

    const clip: Clip = {
        id: getNextClipId(),
        trackId: input.trackId,
        name: input.name,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: inferredType,
        audioBufferId: input.audioBufferId,
        assetHash: input.assetHash,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
        isGhost: input.isGhost,
    };

    updateTrack(input.trackId, (t) => ({ ...t, clips: [...t.clips, clip] }));

    return clip;
}
