import { useEffect, useRef, useState } from 'react';

import { commitWarpMarkerBeatDrag } from '#/modules/Arrangement/useCases';

type BeatMarker = { id: string; originalBeat: number; warpedBeat: number };

type MovedBeats = { originalBeat?: number; warpedBeat?: number };

type MarkerPreview = MovedBeats & {
    clipId: string;
    markerId: string;
};

function mergeMarkerPreview(
    previous: MarkerPreview | null,
    clipId: string,
    markerId: string,
    moved: MovedBeats
): MarkerPreview {
    if (previous?.clipId === clipId && previous.markerId === markerId) {
        return { ...previous, ...moved };
    }
    return { clipId, markerId, ...moved };
}

/** A preview belongs to the clip it was dragged on; switching clips leaves it behind unused. */
function withMarkerPreview<State extends { markers: BeatMarker[] }>(
    state: State,
    preview: MarkerPreview | null,
    clipId: string | null
): State {
    if (preview === null || preview.clipId !== clipId) {
        return state;
    }
    return {
        ...state,
        markers: state.markers.map((marker) => {
            if (marker.id !== preview.markerId) {
                return marker;
            }
            return {
                ...marker,
                originalBeat: preview.originalBeat ?? marker.originalBeat,
                warpedBeat: preview.warpedBeat ?? marker.warpedBeat,
            };
        }),
    };
}

/**
 * The ephemeral state of one marker drag in the Elastic editor. A move updates the preview only (each beat the
 * gesture has moved, merged across moves); the release commits every moved beat as one action, and a cancelled
 * gesture writes nothing. The latest preview is held in a ref beside the state so a release that lands before the
 * next render still commits it, and the preview a settled commit clears is only its own.
 */
export function useMarkerDragPreview(clipId: string | null) {
    const [preview, setPreview] = useState<MarkerPreview | null>(null);
    const previewRef = useRef<MarkerPreview | null>(null);

    useEffect(() => {
        previewRef.current = null;
    }, [clipId]);

    const clear = (): void => {
        previewRef.current = null;
        setPreview(null);
    };

    const move = (markerId: string, moved: MovedBeats): void => {
        if (clipId === null) {
            return;
        }
        const next = mergeMarkerPreview(previewRef.current, clipId, markerId, moved);
        previewRef.current = next;
        setPreview(next);
    };

    const release = (markerId: string): void => {
        const released = previewRef.current;
        previewRef.current = null;
        if (clipId === null || released === null || released.clipId !== clipId || released.markerId !== markerId) {
            clear();
            return;
        }
        // The preview stays drawn until its commit settles, unless a newer drag has replaced it by then.
        void commitWarpMarkerBeatDrag({
            clipId,
            markerId,
            originalBeat: released.originalBeat,
            warpedBeat: released.warpedBeat,
        }).finally(() => setPreview((current) => (current === released ? null : current)));
    };

    const overlay = <State extends { markers: BeatMarker[] }>(state: State): State =>
        withMarkerPreview(state, preview, clipId);

    return { overlay, move, release, cancel: clear };
}
