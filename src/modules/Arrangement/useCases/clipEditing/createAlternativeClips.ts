import { setNotesForClip } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../../stores/trackStore';

export type VariationNote = { pitch: number; startBeat: number; duration: number; velocity: number };

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function normalizeVariationNote(value: unknown): VariationNote | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    const pitch: unknown = Reflect.get(value, 'pitch');
    const startBeat: unknown = Reflect.get(value, 'startBeat');
    const duration: unknown = Reflect.get(value, 'duration');
    const velocity: unknown = Reflect.get(value, 'velocity');
    if (
        typeof pitch !== 'number' ||
        typeof startBeat !== 'number' ||
        typeof duration !== 'number' ||
        typeof velocity !== 'number'
    ) {
        return null;
    }

    return {
        pitch: clamp(Math.round(Number.isFinite(pitch) ? pitch : 60), 0, 127),
        startBeat: Math.max(0, Number.isFinite(startBeat) ? startBeat : 0),
        duration: Math.max(0.0625, Number.isFinite(duration) ? duration : 0.5),
        velocity: clamp(Math.round(Number.isFinite(velocity) ? velocity : 80), 1, 127),
    };
}

function normalizeVariationData(value: unknown): VariationNote[][] | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const normalizedVariations: VariationNote[][] = [];
    try {
        for (const variationValue of value) {
            if (!Array.isArray(variationValue)) {
                return null;
            }

            const normalizedVariation: VariationNote[] = [];
            for (const noteValue of variationValue) {
                const normalizedNote = normalizeVariationNote(noteValue);
                if (!normalizedNote) {
                    return null;
                }
                normalizedVariation.push(normalizedNote);
            }
            normalizedVariations.push(normalizedVariation);
        }
    } catch {
        return null;
    }

    return normalizedVariations;
}

export function createAlternativeClips(originalClipId: string, variationsData: VariationNote[][]): boolean {
    const normalizedVariations = normalizeVariationData(variationsData);
    if (!normalizedVariations) {
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
    for (const [index, variation] of normalizedVariations.entries()) {
        const newClipId = `clip-var-${crypto.randomUUID().slice(0, 8)}`;

        const globalNotes = variation.map((node) => ({
            id: `note-${crypto.randomUUID().slice(0, 8)}`,
            pitch: node.pitch,
            startBeat: currentStart + node.startBeat,
            duration: node.duration,
            velocity: node.velocity,
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
