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

export type WarpStretchMode = WarpState['stretchMode'];

/**
 * Every stretch-mode id a persisted or recorded payload may carry: the
 * canonical ADR 0024 set plus the pre-ADR aliases that survive in CRDT
 * documents and versioned command envelopes recorded before the retirement.
 * The wire contract mirrors this union structurally (`handlerContract`'s
 * `ClipSatelliteWarpStateSnapshot` — model isolation keeps the two
 * declarations separate).
 */
export type PersistedWarpStretchMode = WarpStretchMode | 'beats' | 'complex' | 'texture';

/**
 * Total decode over {@link PersistedWarpStretchMode}: `beats` maps to `wsola`
 * and `complex` to `phase-vocoder` per ADR 0024's aliasing, `texture` — no
 * executor implements it — to the canonical default, and a canonical id to
 * itself. The final return typechecks only because every id the three ifs
 * above do not name is already canonical, so adding an alias to the union
 * without mapping it breaks this function's compile.
 */
export function decodePersistedStretchMode(mode: PersistedWarpStretchMode): WarpStretchMode {
    if (mode === 'beats') {
        return 'wsola';
    }
    if (mode === 'complex') {
        return 'phase-vocoder';
    }
    if (mode === 'texture') {
        return defaultWarpState.stretchMode;
    }
    return mode;
}

/**
 * Decode a persisted stretch-mode string onto the canonical ADR 0024 set at
 * the read boundary (`stores/warpStates` sanitize), so in-memory state is
 * always canonical. Anything that never was a warp mode returns `undefined`
 * and tells the caller to reject the row. Typed payloads whose ids the wire
 * union already constrains use {@link decodePersistedStretchMode} instead —
 * total, so no caller has to handle a rejection that cannot happen.
 */
export function decodeStretchMode(mode: unknown): WarpStretchMode | undefined {
    if (
        typeof mode !== 'string' ||
        (mode !== 'beats' &&
            mode !== 'complex' &&
            mode !== 'texture' &&
            mode !== 'repitch' &&
            mode !== 'phase-vocoder' &&
            mode !== 'wsola')
    ) {
        return undefined;
    }
    return decodePersistedStretchMode(mode);
}
