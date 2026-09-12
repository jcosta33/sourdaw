import {
    closeMainThreadLongTaskCoverage,
    openMainThreadLongTaskCoverage,
    recordMainThreadLongTasks,
} from '../../services/mainThreadLongTaskLatch';

/**
 * Registers the `PerformanceObserver` that counts main-thread long tasks.
 *
 * A main-thread task that runs past its budget starves the work feeding the
 * audio graph — buffer refills, parameter writes, the scheduler's own tick —
 * so it is a deadline miss the render thread cannot see and the engine's own
 * dropout counter never records.
 *
 * `longtask` is not in every runtime's entry-type list, and a runtime that
 * lists it can still refuse to register for it. Either way nothing counts, and
 * the latch stays closed so a reader is told there is no coverage rather than
 * handed a zero.
 */

const LONG_TASK_ENTRY_TYPE = 'longtask';

function supportsLongTaskEntryType(): boolean {
    if (typeof PerformanceObserver !== 'function') {
        return false;
    }

    return PerformanceObserver.supportedEntryTypes.includes(LONG_TASK_ENTRY_TYPE);
}

/**
 * Register the observer and return the function that disconnects it.
 *
 * Returns a no-op stop when there is nothing to observe, so a caller's teardown
 * path is the same on every runtime.
 */
export function startMainThreadLongTaskObserver(): () => void {
    closeMainThreadLongTaskCoverage();

    if (!supportsLongTaskEntryType()) {
        return () => {};
    }

    let observer: PerformanceObserver;
    try {
        observer = new PerformanceObserver((entries) => {
            recordMainThreadLongTasks(entries.getEntries().length);
        });
        observer.observe({ type: LONG_TASK_ENTRY_TYPE, buffered: true });
    } catch {
        // The static entry-type list can name a type registration still refuses.
        return () => {};
    }

    openMainThreadLongTaskCoverage();

    return () => {
        closeMainThreadLongTaskCoverage();
        observer.disconnect();
    };
}
