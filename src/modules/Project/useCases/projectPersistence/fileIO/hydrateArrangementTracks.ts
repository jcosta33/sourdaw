import {
    type ProjectClip as SerializedProjectClip,
    type ProjectTrack as SerializedProjectTrack,
    type ProjectTrackAlternative as SerializedProjectTrackAlternative,
} from '../../../models/ProjectData';
import { type ProjectClip, type ProjectTrack, type ProjectTrackAlternative } from '../../../stores/arrangementStore';

function hydrateClip(clip: SerializedProjectClip): ProjectClip {
    return {
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        type: clip.type,
        audioBufferId: clip.bufferId ?? clip.audioBufferId,
        assetHash: clip.assetHash,
        audioOffsetBeats: clip.sampleStartBeat ?? clip.audioOffsetBeats,
        midiOffsetBeats: clip.midiOffsetBeats,
        fadeInBeats: clip.fadeInBeats,
        fadeOutBeats: clip.fadeOutBeats,
        gain: clip.gain,
        color: clip.color,
        locked: clip.locked,
        muted: clip.muted,
        stretchMode: clip.stretchMode,
        stretchRatio: clip.stretchRatio,
        loopEnabled: clip.loopEnabled,
        loopLength: clip.loopLength,
        followAction: clip.followAction,
        generating: clip.generating,
        isGhost: clip.isGhost,
        isInlineEditing: clip.isInlineEditing,
        parentClipId: clip.parentClipId,
        isLinkedInstance: clip.isLinkedInstance,
        sourceKeyRoot: clip.sourceKeyRoot,
        sourceScaleName: clip.sourceScaleName,
        overrides: clip.overrides,
        kneadState: clip.kneadState,
    };
}

function hydrateAlternative(alternative: SerializedProjectTrackAlternative): ProjectTrackAlternative {
    return {
        id: alternative.id,
        name: alternative.name,
        clips: alternative.clips.map(hydrateClip),
    };
}

function hydrateTrack(track: SerializedProjectTrack): ProjectTrack {
    return {
        ...track,
        clips: track.clips.map(hydrateClip),
        alternatives: track.alternatives.map(hydrateAlternative),
    };
}

export function hydrateArrangementTracks(tracks: readonly SerializedProjectTrack[]): ProjectTrack[] {
    return tracks.map(hydrateTrack);
}
