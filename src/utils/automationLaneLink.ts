/**
 * Shared automation lane-link resolution — the single source of truth for how a
 * lane that follows another lane (`linkedLaneId`, scaled by `linkScale`; F3.3
 * linked/inverted automation) resolves to the lane that actually holds the
 * points.
 *
 * Both the live apply path (Automation `getAutomationValueAtBeat`) and the
 * offline render path (AudioEngine `scheduleTrackAutomation`) route through this
 * so a linked lane renders in a bounce exactly as it plays live (finding AU-3,
 * AUDIT-automation.md): offline previously read `lane.points` raw and rendered a
 * link-only lane silent. Do not re-implement chain-walking or the cycle guard in
 * either path — share this.
 *
 * Semantics (converged from the live recursion):
 *  - a lane with no `linkedLaneId` resolves to itself with scale 1;
 *  - a linked lane *is* its source — it ignores its own points and adopts the
 *    source's, so the walk follows `linkedLaneId` to the first lane that has no
 *    link (the authoritative point holder);
 *  - `linkScale` accumulates multiplicatively along the chain (A→B→C scales by
 *    `scaleA · scaleB`), defaulting to 1 per hop when absent;
 *  - a cycle (A→B→A, or a self-link) resolves to `null` — "no value" — matching
 *    every other no-value path (the caller skips the lane, leaving the param
 *    untouched rather than driving it to a real 0);
 *  - a missing lane resolves to `null`.
 *
 * RT-safe: no locks/IO; the cycle-visited `Set` is caller-suppliable so the
 * per-tick live path can reuse one instead of allocating each call.
 */

/** Minimal structural shape the link walk consumes. Both modules' lane types satisfy it. */
export type LinkableLane = {
    id: string;
    linkedLaneId?: string;
    linkScale?: number;
};

export type ResolvedLaneLink = {
    /** Id of the authoritative (non-linked) source lane whose points are used. */
    sourceLaneId: string;
    /** Cumulative `linkScale` product to apply to the source's values. */
    scale: number;
};

/**
 * Follow `laneId`'s `linkedLaneId` chain to its authoritative source lane,
 * accumulating `linkScale`. Returns `null` on a cycle or a missing lane. Pass a
 * reusable `visited` set on hot paths to avoid a per-call allocation — it is
 * cleared before use.
 */
export function resolveLinkedLane(
    laneId: string,
    getLane: (id: string) => LinkableLane | undefined,
    visited: Set<string> = new Set<string>()
): ResolvedLaneLink | null {
    visited.clear();
    let currentId = laneId;
    let scale = 1;
    for (;;) {
        if (visited.has(currentId)) {
            return null;
        }
        visited.add(currentId);
        const lane = getLane(currentId);
        if (!lane) {
            return null;
        }
        if (!lane.linkedLaneId) {
            return { sourceLaneId: currentId, scale };
        }
        scale *= lane.linkScale ?? 1;
        currentId = lane.linkedLaneId;
    }
}
