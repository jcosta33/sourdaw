import { loopOriginEntry } from '#/utils/clipLoopOrigin';

import {
    captureClipAudioSource,
    type ClipAudioSourceFields,
    isSameClipAudioSource,
    replaceClipAudioSource,
} from '../../models/ClipAudioSource';
import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

type CrossfadeClipsSnapshot = {
    clipAEndBeat: number;
    clipAFadeOutBeats: number;
    clipBStartBeat: number;
    clipBFadeInBeats: number;
    clipBAudioOffsetBeats?: number;
    clipBMidiOffsetBeats?: number;
    clipBLoopOriginBeat?: number;
    clipBAudioSource?: ClipAudioSourceFields;
};

type RestoreCrossfadeClipsInput = {
    clipAId: string;
    clipBId: string;
    replacement: CrossfadeClipsSnapshot;
};

function isValidSnapshot(replacement: CrossfadeClipsSnapshot): boolean {
    if (
        !Number.isFinite(replacement.clipAEndBeat) ||
        !Number.isFinite(replacement.clipAFadeOutBeats) ||
        !Number.isFinite(replacement.clipBStartBeat) ||
        !Number.isFinite(replacement.clipBFadeInBeats) ||
        replacement.clipAFadeOutBeats < 0 ||
        replacement.clipBFadeInBeats < 0
    ) {
        return false;
    }
    if (replacement.clipBAudioOffsetBeats !== undefined && !Number.isFinite(replacement.clipBAudioOffsetBeats)) {
        return false;
    }
    if (replacement.clipBMidiOffsetBeats !== undefined && !Number.isFinite(replacement.clipBMidiOffsetBeats)) {
        return false;
    }
    if (replacement.clipBLoopOriginBeat !== undefined && !Number.isFinite(replacement.clipBLoopOriginBeat)) {
        return false;
    }
    return true;
}

function snapshotDiffers(
    clipA: { endBeat: number; fadeOutBeats: number },
    clipB: Clip,
    replacement: CrossfadeClipsSnapshot
): boolean {
    if (clipA.endBeat !== replacement.clipAEndBeat || clipA.fadeOutBeats !== replacement.clipAFadeOutBeats) {
        return true;
    }
    if (clipB.startBeat !== replacement.clipBStartBeat || clipB.fadeInBeats !== replacement.clipBFadeInBeats) {
        return true;
    }
    if (
        replacement.clipBAudioOffsetBeats !== undefined &&
        clipB.audioOffsetBeats !== replacement.clipBAudioOffsetBeats
    ) {
        return true;
    }
    if (replacement.clipBMidiOffsetBeats !== undefined && clipB.midiOffsetBeats !== replacement.clipBMidiOffsetBeats) {
        return true;
    }
    if (
        replacement.clipBAudioSource !== undefined &&
        !isSameClipAudioSource(captureClipAudioSource(clipB) ?? {}, replacement.clipBAudioSource)
    ) {
        return true;
    }
    return false;
}

export function restoreCrossfadeClips({ clipAId, clipBId, replacement }: RestoreCrossfadeClipsInput): boolean {
    if (clipAId === clipBId) {
        return false;
    }
    const clipAResolution = resolveEligibleClipWriteTarget({ clipId: clipAId });
    const clipBResolution = resolveEligibleClipWriteTarget({ clipId: clipBId });
    if (clipAResolution.status !== 'eligible' || clipBResolution.status !== 'eligible') {
        return false;
    }
    if (!isValidSnapshot(replacement)) {
        return false;
    }
    const state = getTrackState();
    const clips = state?.tracks.flatMap((track) => track.clips) ?? [];
    const clipA = clips.find((clip) => clip.id === clipAId);
    const clipB = clips.find((clip) => clip.id === clipBId);
    if (!clipA || !clipB) {
        return false;
    }
    if (!snapshotDiffers(clipA, clipB, replacement)) {
        return false;
    }
    const clipBAudioSource = replacement.clipBAudioSource;
    if (clipBAudioSource && !replaceClipAudioSource(clipB, clipBAudioSource)) {
        return false;
    }

    mapAllTracks((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
            if (clip.id === clipAId) {
                return {
                    ...clip,
                    endBeat: replacement.clipAEndBeat,
                    fadeOutBeats: replacement.clipAFadeOutBeats,
                };
            }
            if (clip.id === clipBId) {
                const sourced = clipBAudioSource ? replaceClipAudioSource(clip, clipBAudioSource) : clip;
                const base = sourced ?? clip;
                const updated = {
                    ...base,
                    startBeat: replacement.clipBStartBeat,
                    fadeInBeats: replacement.clipBFadeInBeats,
                    // The captured anchor rides only in entries recorded after
                    // the field existed: a legacy entry decodes without it and
                    // leaves the live anchor untouched, exactly as before
                    // (#5198). The forward leg displaces a stretched clip B's
                    // anchor, so the undo must put the captured one back.
                    ...loopOriginEntry(replacement.clipBLoopOriginBeat),
                };
                if (replacement.clipBAudioOffsetBeats !== undefined) {
                    updated.audioOffsetBeats = replacement.clipBAudioOffsetBeats;
                }
                if (replacement.clipBMidiOffsetBeats !== undefined) {
                    updated.midiOffsetBeats = replacement.clipBMidiOffsetBeats;
                }
                return updated;
            }
            return clip;
        }),
    }));
    return true;
}
