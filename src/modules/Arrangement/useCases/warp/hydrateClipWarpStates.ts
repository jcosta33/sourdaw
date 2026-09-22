import { sanitizeClipWarpStates, setAllWarpStates } from '../../stores/warpStates';

/**
 * Load persisted clip warp states into the live store, replacing whatever the
 * previous project left there.
 *
 * Called unconditionally by the project-load path, including with `undefined`,
 * so markers keyed by the outgoing project's clip ids cannot survive into the
 * incoming one.
 */
export function hydrateClipWarpStates(persistedWarpStates: unknown): void {
    setAllWarpStates(sanitizeClipWarpStates(persistedWarpStates));
}
