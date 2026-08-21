import type { CrumbsRecordFeedHandle } from '../../engine/CrumbsRecordFeedNode';

/**
 * Session state for the shared crumbs record feed tap.
 *
 * The tap is shared by every armed instance — the native feed fans one
 * monitored block out to all of them — so it exists exactly while
 * `armedInstances` is non-empty, not per arm. The start/stop files around
 * this state settle concurrent starts by generation: a start captures the
 * current generation before it awaits node creation, and whatever it created
 * is installed only if it is still the newest generation with at least one
 * armed instance behind it. Anything else destroys the handle it made, so a
 * start can never install a stale tap and never overwrites an installed one
 * without destroying it.
 */
type CrumbsRecordFeedSession = {
    armedInstances: Set<string>;
    handle: CrumbsRecordFeedHandle | null;
    /** Zero-gain sink that keeps the tap pulled by the render quantum. */
    silentSink: GainNode | null;
    /** Bumped when the session empties or a new start begins; an older start is stale. */
    generation: number;
    /** Generation of the start currently awaiting node creation, if any. */
    startingGeneration: number | null;
};

export const crumbsRecordFeedSession: CrumbsRecordFeedSession = {
    armedInstances: new Set(),
    handle: null,
    silentSink: null,
    generation: 0,
    startingGeneration: null,
};

/** Tear the installed tap and its silent sink down, if one is installed. */
export function destroyCrumbsRecordFeedTap(): void {
    crumbsRecordFeedSession.handle?.destroy();
    crumbsRecordFeedSession.handle = null;
    try {
        crumbsRecordFeedSession.silentSink?.disconnect();
    } catch {
        // The context may already be closed around us.
    }
    crumbsRecordFeedSession.silentSink = null;
}
