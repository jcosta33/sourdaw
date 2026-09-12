/**
 * The main-thread long-task tally, and whether anything is counting it.
 *
 * It lives here rather than beside the observer that fills it because a
 * repository file exports exactly one function value
 * (`sourdaw/no-multiple-function-exports`), and a count needs both a writer and
 * a reader. The observer in
 * `repositories/engineDiagnostics/observeMainThreadLongTasks.ts` owns the
 * platform call; this owns the figure it produces.
 *
 * Coverage starts closed. A tally nothing is registered to fill is not a tally
 * of zero long tasks, and a reader told `0` would take an unobserved platform
 * for a healthy one.
 */

/** What a read returns while nothing is observing long tasks. */
export const LONG_TASK_OBSERVATION_UNSUPPORTED = 'unsupported';

export type MainThreadLongTaskReading = number | typeof LONG_TASK_OBSERVATION_UNSUPPORTED;

let coverageOpen = false;
let observedLongTasks = 0;

/** Start counting from zero. Called once an observer is registered and live. */
export function openMainThreadLongTaskCoverage(): void {
    coverageOpen = true;
    observedLongTasks = 0;
}

/** Stop claiming a figure. Called when the runtime observes no long tasks. */
export function closeMainThreadLongTaskCoverage(): void {
    coverageOpen = false;
    observedLongTasks = 0;
}

/** Add the entries one observer callback was handed. */
export function recordMainThreadLongTasks(entries: number): void {
    if (!coverageOpen) {
        return;
    }

    observedLongTasks += entries;
}

/** The entries counted so far, or the marker when nothing is counting them. */
export function readMainThreadLongTasks(): MainThreadLongTaskReading {
    if (!coverageOpen) {
        return LONG_TASK_OBSERVATION_UNSUPPORTED;
    }

    return observedLongTasks;
}
