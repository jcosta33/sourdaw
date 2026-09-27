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
    /** The canonical ADR 0024 surface over the three executors. Only `repitch`
     *  runs today; see `useCases/warp/getStretchModeInfo`. */
    stretchMode: 'repitch' | 'phase-vocoder' | 'wsola';
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

/**
 * Decode a persisted stretch-mode string onto the canonical ADR 0024 set at
 * the read boundary (`stores/warpStates` sanitize), so in-memory state is
 * always canonical: `beats` maps to `wsola` and `complex` to `phase-vocoder`
 * per the ADR's aliasing, while `texture` — dropped because no executor
 * implements it — falls back to the canonical default. Anything else never
 * was a warp mode, and `undefined` tells the caller to reject the row.
 */
export function decodeStretchMode(mode: unknown): WarpState['stretchMode'] | undefined {
    if (typeof mode !== 'string') {
        return undefined;
    }
    if (mode === 'beats') {
        return 'wsola';
    }
    if (mode === 'complex') {
        return 'phase-vocoder';
    }
    if (mode === 'texture') {
        return defaultWarpState.stretchMode;
    }
    if (mode === 'repitch' || mode === 'phase-vocoder' || mode === 'wsola') {
        return mode;
    }
    return undefined;
}
