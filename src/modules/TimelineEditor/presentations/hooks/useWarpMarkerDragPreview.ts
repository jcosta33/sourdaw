import { useEffect, useRef, useState } from 'react';

import { commitWarpMarkerBeatDrag } from '#/modules/Arrangement/useCases';

type BeatMarker = { id: string; originalBeat: number; warpedBeat: number };

type MarkerPreview = { clipId: string; markerId: string; warpedBeat: number };

/** A preview belongs to the clip it was dragged on; switching clips leaves it behind unused. */
function withMarkerPreview<State extends { markers: BeatMarker[] }>(
    state: State,
    preview: MarkerPreview | null,
    clipId: string
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
            return { ...marker, warpedBeat: preview.warpedBeat };
        }),
    };
}

/**
 * The ephemeral state of one warp-marker drag in the waveform editor. A move updates the preview only; the release
 * commits it as one action, and a cancelled gesture writes nothing. The latest preview is held in a ref beside the
 * state so a release that lands before the next render still commits it, and the preview a settled commit clears is
 * only its own.
 */
export function useWarpMarkerDragPreview(clipId: string) {
    const [preview, setPreview] = useState<MarkerPreview | null>(null);
    const previewRef = useRef<MarkerPreview | null>(null);

    useEffect(() => {
        previewRef.current = null;
    }, [clipId]);

    const clear = (): void => {
        previewRef.current = null;
        setPreview(null);
    };

    const move = (markerId: string, warpedBeat: number): void => {
        const next: MarkerPreview = { clipId, markerId, warpedBeat };
        previewRef.current = next;
        setPreview(next);
    };

    const commit = (moved: MarkerPreview): void => {
        if (moved.clipId !== clipId) {
            clear();
            return;
        }
        // The preview stays drawn until its commit settles, unless a newer drag has replaced it by then.
        void commitWarpMarkerBeatDrag({
            clipId: moved.clipId,
            markerId: moved.markerId,
            warpedBeat: moved.warpedBeat,
        }).finally(() => setPreview((current) => (current === moved ? null : current)));
    };

    const release = (markerId: string): void => {
        const released = previewRef.current;
        previewRef.current = null;
        if (released === null || released.markerId !== markerId) {
            clear();
            return;
        }
        commit(released);
    };

    // Pressing another marker while one is mid-drag ends that drag: its moved preview is committed first.
    const begin = (markerId: string): void => {
        const pending = previewRef.current;
        if (pending === null || pending.markerId === markerId) {
            return;
        }
        previewRef.current = null;
        commit(pending);
    };

    const overlay = <State extends { markers: BeatMarker[] }>(state: State): State =>
        withMarkerPreview(state, preview, clipId);

    return { overlay, begin, move, release, cancel: clear };
}
