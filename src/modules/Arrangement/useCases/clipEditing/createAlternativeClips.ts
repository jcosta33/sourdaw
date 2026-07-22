import { setNotesForClip } from '#/modules/MIDI/useCases';

import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../../stores/trackStore';

export type VariationNote = { pitch: number; startBeat: number; duration: number; velocity: number };

type StagedNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability: number;
};

type StagedVariation = {
    clip: Clip;
    notes: StagedNote[];
};

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

function addClipIdsToSet(value: unknown, clipIds: Set<string>): boolean {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const candidate of value) {
        if (candidate === null || typeof candidate !== 'object') {
            return false;
        }

        const clipId: unknown = Reflect.get(candidate, 'id');
        if (typeof clipId !== 'string' || clipId.length === 0) {
            return false;
        }
        clipIds.add(clipId);
    }

    return true;
}

function collectProjectClipIds(value: unknown): Set<string> | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const clipIds = new Set<string>();
    try {
        for (const track of value) {
            if (track === null || typeof track !== 'object') {
                return null;
            }
            if (!addClipIdsToSet(Reflect.get(track, 'clips'), clipIds)) {
                return null;
            }

            const alternatives: unknown = Reflect.get(track, 'alternatives');
            if (!Array.isArray(alternatives)) {
                return null;
            }
            for (const alternative of alternatives) {
                if (alternative === null || typeof alternative !== 'object') {
                    return null;
                }
                if (!addClipIdsToSet(Reflect.get(alternative, 'clips'), clipIds)) {
                    return null;
                }
            }
        }
    } catch {
        return null;
    }

    return clipIds;
}

function hasValidSourceGeometry(clip: Clip): boolean {
    if (!Number.isFinite(clip.startBeat) || !Number.isFinite(clip.endBeat)) {
        return false;
    }
    return clip.endBeat > clip.startBeat;
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

    if (!hasValidSourceGeometry(originalClip)) {
        return false;
    }

    const occupiedClipIds = collectProjectClipIds(state.tracks);
    if (!occupiedClipIds) {
        return false;
    }

    const clipDuration = originalClip.endBeat - originalClip.startBeat;
    const stagedNoteIds = new Set<string>();
    const stagedVariations: StagedVariation[] = [];

    let currentStart = originalClip.endBeat;
    for (const [index, variation] of normalizedVariations.entries()) {
        const currentEnd = currentStart + clipDuration;
        if (!Number.isFinite(currentStart) || !Number.isFinite(currentEnd)) {
            return false;
        }

        const newClipId = getNextClipId();
        if (newClipId.length === 0 || occupiedClipIds.has(newClipId)) {
            return false;
        }
        occupiedClipIds.add(newClipId);

        const globalNotes: StagedNote[] = [];
        for (const node of variation) {
            const noteStartBeat = currentStart + node.startBeat;
            if (!Number.isFinite(noteStartBeat)) {
                return false;
            }

            const noteId = `note-${crypto.randomUUID()}`;
            if (stagedNoteIds.has(noteId)) {
                return false;
            }
            stagedNoteIds.add(noteId);
            globalNotes.push({
                id: noteId,
                pitch: node.pitch,
                startBeat: noteStartBeat,
                duration: node.duration,
                velocity: node.velocity,
                probability: 100,
            });
        }

        stagedVariations.push({
            clip: {
                ...originalClip,
                id: newClipId,
                name: `${originalClip.name} (Var ${String(index + 1)})`,
                startBeat: currentStart,
                endBeat: currentEnd,
                muted: true,
            },
            notes: globalNotes,
        });

        currentStart = currentEnd;
    }

    for (const variation of stagedVariations) {
        setNotesForClip(variation.clip.id, variation.notes);
    }

    updateTrack(targetTrack.id, (time) => ({
        ...time,
        clips: [...time.clips, ...stagedVariations.map((variation) => variation.clip)],
    }));

    return true;
}
