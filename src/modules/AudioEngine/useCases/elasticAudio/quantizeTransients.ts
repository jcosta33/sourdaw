import { getWarpState, trackStore, warpStates } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/stores';
import { workspaceStore } from '#/modules/Workspace/stores';

import type { WarpMarker } from '#/modules/Arrangement/models/WarpMarker';

export type QuantizeTransientsResult =
    | { ok: true; moved: number }
    | { ok: false; reason: 'CLIP_NOT_FOUND' | 'CLIP_NOT_AUDIO' | 'NO_MARKERS' };

function snapBeat(beat: number, gridDivisionBeats: number): number {
    if (gridDivisionBeats <= 0) {
        return beat;
    }
    return Math.round(beat / gridDivisionBeats) * gridDivisionBeats;
}

function findClip(clipId: string): import('#/modules/Arrangement/models/Track').Clip | null {
    for (const track of trackStore.value?.tracks ?? []) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return null;
}

/**
 * Snap every non-locked transient marker's `warpedBeat` to the nearest grid
 * position (`workspaceStore.snapValue`, in beats). Flips `stretchMode` away
 * from `repitch` if needed so the warped output actually plays back time-
 * stretched. One grouped undo entry covers both the marker rewrite and the
 * stretch-mode change.
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

    const after: WarpMarker[] = before.markers.map((m) => {
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

    if (moved === 0 && before.stretchMode !== 'repitch') {
        return { ok: true, moved: 0 };
    }

    const beforeStretch = before.stretchMode;
    const nextStretch: typeof before.stretchMode = beforeStretch === 'repitch' ? 'complex' : beforeStretch;

    const previousState = before;
    const nextState = {
        ...before,
        markers: after.sort((a, b) => a.originalBeat - b.originalBeat),
        stretchMode: nextStretch,
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
