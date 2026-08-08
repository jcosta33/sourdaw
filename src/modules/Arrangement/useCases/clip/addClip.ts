import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Clip, type FollowAction, type StretchMode } from '../../stores/trackStore';

export function addClip(input: {
    id?: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type?: 'audio' | 'midi';
    audioBufferId?: string;
    assetHash?: string;
    isGhost?: boolean;
    /** Optional source-clip properties to preserve (e.g. when duplicating). */
    audioOffsetBeats?: number;
    midiOffsetBeats?: number;
    fadeInBeats?: number;
    fadeOutBeats?: number;
    gain?: number;
    color?: string;
    locked?: boolean;
    muted?: boolean;
    stretchMode?: StretchMode;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: FollowAction;
}): Clip | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    // Validate the requested span before touching the store. A clip with a
    // non-positive duration or a negative start position is never valid and
    // would otherwise produce a degenerate clip that downstream renderers and
    // the engine cannot reason about.
    if (!Number.isFinite(input.startBeat) || !Number.isFinite(input.endBeat)) {
        return null;
    }
    if (input.startBeat < 0 || input.endBeat <= input.startBeat) {
        return null;
    }

    const track = state.tracks.find((time) => time.id === input.trackId);
    // updateTrack silently no-ops when the track id doesn't match (see
    // updateTrack.ts), so without this guard addClip would return a clip that
    // was never actually inserted into any track.
    if (!track) {
        return null;
    }
    if (!getTrackEligibility(track.kind).acceptsClipAdd) {
        return null;
    }
    const clipId = input.id ?? getNextClipId();
    const clipIdExists =
        state.ghostClips?.some((clip) => clip.id === clipId) === true ||
        state.tracks.some(
            (candidate) =>
                candidate.clips.some((clip) => clip.id === clipId) ||
                candidate.alternatives.some((alternative) => alternative.clips.some((clip) => clip.id === clipId))
        );
    if (clipIdExists) {
        return null;
    }
    const inferredType = input.type ?? (track.kind === 'midi' ? 'midi' : 'audio');

    const clip: Clip = {
        id: clipId,
        trackId: input.trackId,
        name: input.name,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: inferredType,
        audioBufferId: input.audioBufferId,
        assetHash: input.assetHash,
        audioOffsetBeats: input.audioOffsetBeats,
        midiOffsetBeats: input.midiOffsetBeats,
        fadeInBeats: input.fadeInBeats ?? 0,
        fadeOutBeats: input.fadeOutBeats ?? 0,
        gain: input.gain ?? 1.0,
        color: input.color ?? '',
        locked: input.locked ?? false,
        muted: input.muted ?? false,
        stretchMode: input.stretchMode,
        stretchRatio: input.stretchRatio,
        loopEnabled: input.loopEnabled,
        loopLength: input.loopLength,
        followAction: input.followAction,
        isGhost: input.isGhost,
    };

    updateTrack(input.trackId, (time) => ({ ...time, clips: [...time.clips, clip] }));

    return clip;
}
