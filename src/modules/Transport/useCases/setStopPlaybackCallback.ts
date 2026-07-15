import { schedulerSession } from './playheadScheduler';

/**
 * Wire the scheduler's follow-action stop path to the full `stopPlayback`
 * routine. Registered once from `src/app/bootstrap.ts` after all modules
 * have loaded, so the scheduler never needs a static or dynamic import of
 * `stopPlayback` (which would form a scheduler ↔ stopPlayback cycle).
 *
 * If the callback has not been registered yet (e.g. during tests that boot
 * the scheduler directly), the follow-action `shouldStop` branch is a no-op.
 */
export function setStopPlaybackCallback(fn: () => void): void {
    schedulerSession.onStopRequested = fn;
}
