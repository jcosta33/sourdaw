import { createWarpMarker, defaultWarpState, type WarpMarkerOrigin, type WarpState } from '../models/WarpMarker';

/**
 * In-memory warp state per clip. Lives in `stores/` (not `useCases/`) because
 * cross-module mutators (AudioEngine's elastic-audio operations) need a write
 * surface that doesn't pull the full `Arrangement/useCases` graph — that
 * graph closes the AudioEngine ↔ Arrangement cycle through duplicateClip →
 * Automation → AudioEngine.
 */
export const warpStates = new Map<string, WarpState>();

export function getWarpState(clipId: string): WarpState {
    return warpStates.get(clipId) ?? defaultWarpState;
}

/**
 * Exhaustiveness anchor for `isDefaultWarpState`. `Record<keyof WarpState,
 * true>` forces every key of `WarpState` to appear as a property here — a
 * plain `state.someField` read below does not get this for free, since
 * TypeScript's excess-property check only fires on object literals assigned
 * to a typed slot, never on property reads off an already-typed parameter.
 * Add a field to `WarpState` without adding it here and this object literal
 * stops satisfying the annotation, so `pnpm typecheck` breaks at this line
 * until `isDefaultWarpState` below is updated to compare it too.
 */
export const warpStateFieldsCheckedByIsDefaultWarpState: Record<keyof WarpState, true> = {
    enabled: true,
    markers: true,
    stretchMode: true,
    originalTempo: true,
};

/**
 * Whether a `WarpState` value actually differs from `defaultWarpState`,
 * field by field. See `warpStateFieldsCheckedByIsDefaultWarpState` above for
 * the compile-time guarantee that a forgotten field cannot ship silently.
 */
export function isDefaultWarpState(state: WarpState): boolean {
    return (
        state.enabled === defaultWarpState.enabled &&
        state.markers.length === 0 &&
        state.stretchMode === defaultWarpState.stretchMode &&
        state.originalTempo === defaultWarpState.originalTempo
    );
}

/**
 * Whether a clip carries warp state a user actually added — not merely
 * whether `warpStates` has an entry for it. `warpStates.set` runs from
 * roughly fifteen call sites across `Arrangement/useCases/warp/` and
 * `ElasticAudio/useCases/elasticAudio/`, and nothing but `removeWarpState`
 * (run only on clip deletion) ever removes an entry. A write that leaves the
 * state value-identical to `defaultWarpState` — for example `setStretchMode`
 * writing the mode a clip already has — would sit in the map forever and be
 * indistinguishable from real satellite state to a presence check. Any
 * reader deciding whether a clip "has warp state" for undo or glue
 * eligibility must call this instead of `warpStates.has`.
 */
export function hasNonDefaultWarpState(clipId: string): boolean {
    const state = warpStates.get(clipId);
    return state !== undefined && !isDefaultWarpState(state);
}

/** Replace the warp state for a clip (used when duplicating a clip). */
export function setWarpState(clipId: string, state: WarpState): void {
    warpStates.set(clipId, state);
}

/**
 * Drop the warp state keyed by a clip id. Called on clip removal so the map
 * doesn't retain entries for clips that no longer exist.
 */
export function removeWarpState(clipId: string): void {
    warpStates.delete(clipId);
}

export function addWarpMarker(
    clipId: string,
    originalBeat: number,
    warpedBeat: number,
    options?: { origin?: WarpMarkerOrigin; confidence?: number; locked?: boolean }
): void {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(originalBeat, warpedBeat, options);
    warpStates.set(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((alpha, buffer) => alpha.originalBeat - buffer.originalBeat),
    });
}
