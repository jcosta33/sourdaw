export type WarpMarkerOrigin = 'user' | 'transient-auto' | 'grid-snap';

export type WarpMarker = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
    /** Provenance — user-edited markers and grid-snap targets are preserved
     *  across detection re-runs; `transient-auto` markers are replaced. */
    origin?: WarpMarkerOrigin;
    /** Onset-detection confidence (0..1). Undefined for non-auto markers. */
    confidence?: number;
    /** When true, quantize and re-detection both leave this marker untouched. */
    locked?: boolean;
};

export type WarpState = {
    enabled: boolean;
    markers: WarpMarker[];
    /** Only `repitch` has an executor; see `useCases/warp/getStretchModeInfo`. */
    stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
    originalTempo: number | null;
};

export const createWarpMarker = (
    originalBeat: number,
    warpedBeat: number,
    options?: { origin?: WarpMarkerOrigin; confidence?: number; locked?: boolean }
): WarpMarker => ({
    id: `warp-${crypto.randomUUID()}`,
    originalBeat,
    warpedBeat,
    origin: options?.origin ?? 'user',
    confidence: options?.confidence,
    locked: options?.locked ?? false,
});

export const defaultWarpState: WarpState = {
    enabled: false,
    markers: [],
    stretchMode: 'repitch',
    originalTempo: null,
};
