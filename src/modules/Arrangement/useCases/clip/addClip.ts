import { getTrackState, updateTrack } from '#/modules/Arrangement/repositories/track';
import { type Clip } from '#/modules/Arrangement/models/Track';
import { getNextClipId } from '#/modules/Arrangement/repositories/clipIdCounter';

export function addClip(input: {
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type?: 'audio' | 'midi';
    audioBufferId?: string;
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
