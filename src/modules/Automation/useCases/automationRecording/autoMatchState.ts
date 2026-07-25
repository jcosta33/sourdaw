/**
 * AutoMatch release state.
 *
 * When a touch/latch ride ends, the control is at wherever the user left it
 * while the underlying automation curve says something else. Releasing used to
 * hand the parameter straight back to the curve on the next scheduler tick, so
 * the value could jump. The golden standard (Pro Tools AutoMatch) glides the
 * parameter back to the previously written level over a configured time
 * instead.
 *
 * `releaseTouchAutomation` records the released value here; the transport's
 * `applyAutomation` consumes it through `resolveAutoMatchValue` on each tick
 * until the ramp completes, then the entry is forgotten and the curve takes
 * over again.
 *
 * Internal to the recording subsystem — like `recordingSessionState`, the
 * collection is mutated in place and never reseated, so every consumer observes
 * the same Map.
 */

/**
 * How long a released control takes to glide back to the underlying automation,
 * in seconds. Pro Tools exposes this as the AutoMatch preference; there is no
 * settings surface for it here yet, so it is a single named constant — a
 * deliberately short glide that removes the step without audibly lagging the
 * release.
 */
export const AUTOMATCH_RELEASE_SECONDS = 0.15;

export type AutoMatchRelease = {
    /** The parameter value the control held at the moment it was released. */
    releasedValue: number;
    /**
     * Engine time the glide started, stamped by the first scheduler tick that
     * observes the release. Null until then: the release happens on a UI event
     * that has no engine clock of its own, and stamping it on the first tick
     * keeps the ramp measured against the same clock that consumes it.
     */
    startedAtSeconds: number | null;
};

/** Pending AutoMatch glides keyed by `makeKey(trackId, parameterId)`. */
export const pendingAutoMatch = new Map<string, AutoMatchRelease>();
