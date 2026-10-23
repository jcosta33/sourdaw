import { recordingLifecycle } from './recordingLifecycle';

/**
 * Resolve once no stop is closing a recording and no take commit is in flight.
 *
 * A user's Pause or Stop turns the transport idle at once and lands the take
 * afterwards, so a caller that must act on the project the take is about to
 * write into (the save that precedes a project replacement) waits here first.
 * It never stops or starts playback: a transport that is still rolling is left
 * rolling. A stop or commit registered while this waits is waited for too.
 *
 * It only observes: the commits a stop is waiting for stay the stop's, so a
 * Stop that overlaps this wait still resolves only once its take has landed.
 */
export function waitForClosedTakes(): Promise<void> {
    return recordingLifecycle.waitUntilQuiet();
}
