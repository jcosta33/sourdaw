import { clearClipPitchContour } from '#/modules/Knead/useCases';

import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../stores/trackStore';

/**
 * Replace the audio buffer ID on a clip. Used when dropping a new audio file
 * onto a waveform editor to swap the clip's source audio.
 */
export function replaceClipAudioBuffer(clipId: string, newBufferId: string): boolean {
    if (newBufferId.length === 0) {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    // The match accepts either the clip id or its previous buffer id; collect the
    // real clip ids up front so their now-stale pitch contours can be dropped
    // after the swap (contours key on clip id, not buffer id).
    const replacedClipIds = new Set<string>();
    try {
        for (const track of state.tracks) {
            for (const clip of track.clips) {
                if (clip.id !== clipId && clip.audioBufferId !== clipId) {
                    continue;
                }
                if (clip.type !== 'audio') {
                    return false;
                }
                replacedClipIds.add(clip.id);
            }
        }
    } catch {
        return false;
    }

    if (replacedClipIds.size === 0) {
        return false;
    }

    for (const replacedClipId of replacedClipIds) {
        const target = resolveEligibleClipWriteTarget({ clipId: replacedClipId });
        if (target.status !== 'eligible' || !('clipId' in target)) {
            return false;
        }
    }

    const tracks = state.tracks.map((track) => {
        const clips = track.clips.map((candidate) => {
            if (!replacedClipIds.has(candidate.id)) {
                return candidate;
            }
            return { ...candidate, audioBufferId: newBufferId };
        });
        return { ...track, clips };
    });
    trackStore.set({
        ...state,
        tracks,
    });

    // New source audio invalidates any analyzed pitch contour: clear it so the
    // Knead editor re-analyses instead of editing the previous audio's pitch.
    for (const replacedClipId of replacedClipIds) {
        clearClipPitchContour(replacedClipId);
    }
    return true;
}
