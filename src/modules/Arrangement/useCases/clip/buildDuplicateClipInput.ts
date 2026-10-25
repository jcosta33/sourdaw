import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

import { relocateAudioSourceTimeFields } from './relocateAudioSourceTimeFields';

/** The producer's copy shape, shared with admission of a later replay member. */
export function buildDuplicateClipInput(
    clip: Clip,
    input: { targetClipId: string; destinationTrackId: string; startBeat: number }
): Clip {
    return {
        id: input.targetClipId,
        trackId: input.destinationTrackId,
        startBeat: input.startBeat,
        endBeat: input.startBeat + (clip.endBeat - clip.startBeat),
        name: `${clip.name} (copy)`,
        type: clip.type,
        audioBufferId: clip.audioBufferId,
        assetHash: clip.assetHash,
        audioOffsetBeats: clip.audioOffsetBeats,
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
        // An unanchored source stays unanchored; an anchored loop moves with its copy.
        ...shiftLoopOriginEntry(clip, input.startBeat - clip.startBeat),
        ...relocateAudioSourceTimeFields(clip, input.startBeat - clip.startBeat),
        followAction: clip.followAction,
    };
}
