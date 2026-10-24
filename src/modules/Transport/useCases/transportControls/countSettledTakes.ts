import { recordingLifecycle } from './recordingLifecycle';

/**
 * How many take commits have settled since the app started, whether they
 * landed or were retired.
 *
 * Every stop that closes a take (the user's Pause, a replacement's own stop, a
 * punch-out) passes its commit through the recording lifecycle, so this count
 * is the one place they all meet. A caller compares it with the count it read
 * when it last persisted the project to know whether a take has closed into it
 * since. A commit still in flight is not counted: `isTransportIdle` reads it.
 */
export function countSettledTakes(): number {
    return recordingLifecycle.settledCommitCount;
}
