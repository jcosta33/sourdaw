/**
 * How many callers have asked the Auto input monitoring owner to stand still.
 *
 * It lives here rather than in the owner because a use case exports exactly one
 * function value (`sourdaw/no-multiple-function-exports`), and a suspension
 * needs a writer and a reader. `suspendAutoInputMonitoring` owns the writes;
 * `reconcileAutoInputMonitoring` owns the read. A count rather than a flag lets
 * two overlapping suspensions each release their own hold.
 */
let holds = 0;

export function holdAutoInputMonitoring(): void {
    holds++;
}

export function releaseAutoInputMonitoringHold(): void {
    holds = Math.max(0, holds - 1);
}

export function isAutoInputMonitoringHeld(): boolean {
    return holds > 0;
}
