import { setNotesForClip } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../../stores/trackStore';

export type VariationNote = { pitch: number; startBeat: number; duration: number; velocity: number };

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function createAlternativeClips(originalClipId: string, variationsData: VariationNote[][]): boolean {
    if (!Array.isArray(variationsData) || variationsData.length === 0) {
        return false;
    }
    if (!variationsData.every((variation) => Array.isArray(variation))) {
        return false;
    }

    const resolution = resolveEligibleClipWriteTarget({ clipId: originalClipId });
    if (resolution.status !== 'eligible') {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const targetTrack = state.tracks.find((track) => track.id === resolution.trackId);
    const originalClip = targetTrack?.clips.find((context) => context.id === originalClipId);

    if (!targetTrack || !originalClip) {
        return false;
    }

    const clipDuration = originalClip.endBeat - originalClip.startBeat;
    const newClips: Clip[] = [];

    let currentStart = originalClip.endBeat;
    for (const [index, variation] of variationsData.entries()) {
        const newClipId = `clip-var-${crypto.randomUUID().slice(0, 8)}`;

        const globalNotes = variation.map((node) => ({
            id: `note-${crypto.randomUUID().slice(0, 8)}`,
            // Clamp MIDI values to valid ranges; guard against NaN/Infinity from LLM output
            pitch: clamp(Math.round(isFinite(node.pitch) ? node.pitch : 60), 0, 127),
            startBeat: currentStart + Math.max(0, isFinite(node.startBeat) ? node.startBeat : 0),
            duration: Math.max(0.0625, isFinite(node.duration) ? node.duration : 0.5),
            velocity: clamp(Math.round(isFinite(node.velocity) ? node.velocity : 80), 1, 127),
            probability: 100,
        }));

        setNotesForClip(newClipId, globalNotes);

        newClips.push({
            ...originalClip,
            id: newClipId,
            name: `${originalClip.name} (Var ${String(index + 1)})`,
            startBeat: currentStart,
            endBeat: currentStart + clipDuration,
            muted: true,
        });

        currentStart += clipDuration;
    }

    updateTrack(targetTrack.id, (time) => ({
        ...time,
        clips: [...time.clips, ...newClips],
    }));

    return true;
}
