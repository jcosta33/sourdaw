import { getWarpState, trackStore, warpStates } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

export type QuantizeTransientsResult =
    { ok: true; moved: number } | { ok: false; reason: 'CLIP_NOT_FOUND' | 'CLIP_NOT_AUDIO' | 'NO_MARKERS' };

type QuantizableClip = {
    id: string;
    type: 'audio' | 'midi';
};

type QuantizedMarker = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
    origin?: 'user' | 'transient-auto' | 'grid-snap';
    locked?: boolean;
};

function snapBeat(beat: number, gridDivisionBeats: number): number {
    if (gridDivisionBeats <= 0) {
        return beat;
    }
    return Math.round(beat / gridDivisionBeats) * gridDivisionBeats;
}

function findClip(clipId: string): QuantizableClip | null {
    for (const track of trackStore.value?.tracks ?? []) {
        const clips: readonly QuantizableClip[] = track.clips;
        const clip = clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return null;
}

/**
 * Snap every non-locked transient marker's `warpedBeat` to the nearest grid
 * position (`workspaceStore.snapValue`, in beats). One undo entry covers the
 * marker rewrite.
 *
 * `stretchMode` is left exactly as the user set it. This used to flip
 * `repitch -> complex` on the user's behalf, which wrote a mode the product has
 * no executor for (`getStretchModeInfo` reports `complex` unavailable) and is
 * no longer offered by any editor.
 */
export function quantizeTransients(clipId: string): QuantizeTransientsResult {
    const clip = findClip(clipId);
    if (!clip) {
        return { ok: false, reason: 'CLIP_NOT_FOUND' };
    }
    if (clip.type !== 'audio') {
        return { ok: false, reason: 'CLIP_NOT_AUDIO' };
    }

    const before = getWarpState(clipId);
    const grid = workspaceStore.value?.snapValue ?? 1;

    if (before.markers.length === 0) {
        return { ok: false, reason: 'NO_MARKERS' };
    }

    const after: QuantizedMarker[] = before.markers.map((m) => {
        if (m.locked) {
            return m;
        }
        const snapped = snapBeat(m.originalBeat, grid);
        if (snapped === m.warpedBeat) {
            return m;
        }
        return { ...m, warpedBeat: snapped, origin: 'grid-snap' };
    });

    const moved = after.reduce(
        (count, m, idx) => (m.warpedBeat !== before.markers[idx]!.warpedBeat ? count + 1 : count),
        0
    );

    if (moved === 0) {
        return { ok: true, moved: 0 };
    }

    const previousState = before;
    const nextState = {
        ...before,
        markers: after.sort((a, b) => a.originalBeat - b.originalBeat),
        enabled: true,
    };

    warpStates.set(clipId, nextState);

    pushUndoEntry(
        'Quantize transients',
        () => {
            warpStates.set(clipId, previousState);
        },
        () => {
            warpStates.set(clipId, nextState);
        }
    );

    return { ok: true, moved };
}
