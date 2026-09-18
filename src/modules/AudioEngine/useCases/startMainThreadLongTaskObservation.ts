import { startMainThreadLongTaskObserver } from '../repositories/engineDiagnostics/observeMainThreadLongTasks';

/**
 * Registers the main-thread long-task observer for the life of the process.
 *
 * `src/app/` reaches a module through its `useCases` barrel, never a
 * repository file directly, so this wraps the repository call. The returned
 * stop function is discarded: nothing tears this registration down while the
 * app is running, so there is no caller for it.
 */
export function startMainThreadLongTaskObservation(): void {
    startMainThreadLongTaskObserver();
}
