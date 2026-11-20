/**
 * How long a reactivation waits for a keyed unload already pending on the same
 * instance before it gives up without loading.
 *
 * The native control-gate wait is bounded at 10 s, plus up to 2 s for the
 * seam wait, so a live unload answers inside this deadline; only a plugin hung
 * inside its own native call outlasts it. The wait must be bounded because
 * callers await the activation inside committed actions.
 */
export const PENDING_UNLOAD_WAIT_TIMEOUT_MS = 15_000;
