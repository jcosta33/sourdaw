import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

type CrossfadeClipsSnapshot = {
    clipAEndBeat: number;
    clipAFadeOutBeats: number;
    clipBStartBeat: number;
    clipBFadeInBeats: number;
};

type RestoreCrossfadeClipsInput = {
    clipAId: string;
    clipBId: string;
    replacement: CrossfadeClipsSnapshot;
};

export function restoreCrossfadeClips({ clipAId, clipBId, replacement }: RestoreCrossfadeClipsInput): boolean {
    if (clipAId === clipBId) {
        return false;
    }
    const clipAResolution = resolveEligibleClipWriteTarget({ clipId: clipAId });
    const clipBResolution = resolveEligibleClipWriteTarget({ clipId: clipBId });
    if (clipAResolution.status !== 'eligible' || clipBResolution.status !== 'eligible') {
        return false;
    }
    const values = Object.values(replacement);
    if (
        !values.every((value) => Number.isFinite(value)) ||
        replacement.clipAFadeOutBeats < 0 ||
        replacement.clipBFadeInBeats < 0
    ) {
        return false;
    }
    const state = getTrackState();
    const clips = state?.tracks.flatMap((track) => track.clips) ?? [];
    const clipA = clips.find((clip) => clip.id === clipAId);
    const clipB = clips.find((clip) => clip.id === clipBId);
    if (!clipA || !clipB) {
        return false;
    }
    const didChange =
        clipA.endBeat !== replacement.clipAEndBeat ||
        clipA.fadeOutBeats !== replacement.clipAFadeOutBeats ||
        clipB.startBeat !== replacement.clipBStartBeat ||
        clipB.fadeInBeats !== replacement.clipBFadeInBeats;
    if (!didChange) {
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
                return {
                    ...clip,
                    startBeat: replacement.clipBStartBeat,
                    fadeInBeats: replacement.clipBFadeInBeats,
                };
            }
            return clip;
        }),
    }));
    return true;
}
