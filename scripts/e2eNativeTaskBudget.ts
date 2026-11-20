export const JANK_TASK_CEILING_MS = 50;

// Controlled 4× cold apply and decode measured 1.41× and 1.52× their respective medians.
export const NATIVE_REFERENCE_FACTOR = 2;

export function isNativeSdkDurationWithinBudget(
    taskMs: number,
    observedLongTask: boolean,
    sdkMs: number,
    referenceMedianMs: number
): boolean {
    if (![taskMs, sdkMs, referenceMedianMs].every((durationMs) => Number.isFinite(durationMs) && durationMs > 0)) {
        return false;
    }
    if (taskMs < JANK_TASK_CEILING_MS && !observedLongTask) {
        return true;
    }
    return sdkMs <= NATIVE_REFERENCE_FACTOR * referenceMedianMs;
}
