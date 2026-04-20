import { setNotesForClip } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { type Clip } from '../../stores/trackStore';

export type VariationNote = { pitch: number; startBeat: number; duration: number; velocity: number };

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function createAlternativeClips(originalClipId: string, variationsData: VariationNote[][]): void {
    const state = getTrackState();
    if (!state) {
        throw new Error('Track state unavailable — cannot create alternative clips.');
    }

    type Track = (typeof state.tracks)[number];
    let targetTrack: Track | null = null;
    let originalClip: Clip | null = null;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === originalClipId);
        if (clip) {
            targetTrack = track;
            originalClip = clip;
            break;
        }
    }

    if (!targetTrack || !originalClip) {
        throw new Error(`Clip ${originalClipId} not found — cannot create alternative clips.`);
    }

    const clipDuration = originalClip.endBeat - originalClip.startBeat;
    const newClips: Clip[] = [];

    let currentStart = originalClip.endBeat;
    for (const [index, variation] of variationsData.entries()) {
        const newClipId = `clip-var-${crypto.randomUUID().slice(0, 8)}`;

        const globalNotes = variation.map((n) => ({
            id: `note-${crypto.randomUUID().slice(0, 8)}`,
            // Clamp MIDI values to valid ranges; guard against NaN/Infinity from LLM output
            pitch: clamp(Math.round(isFinite(n.pitch) ? n.pitch : 60), 0, 127),
            startBeat: currentStart + Math.max(0, isFinite(n.startBeat) ? n.startBeat : 0),
            duration: Math.max(0.0625, isFinite(n.duration) ? n.duration : 0.5),
            velocity: clamp(Math.round(isFinite(n.velocity) ? n.velocity : 80), 1, 127),
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

    updateTrack(targetTrack.id, (t) => ({
        ...t,
        clips: [...t.clips, ...newClips],
    }));
}
