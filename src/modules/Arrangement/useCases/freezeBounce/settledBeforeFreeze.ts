import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';

/**
 * The last state a track showed that was not `freezing`, kept for as long as overlapping freezes
 * (a refresh superseding a running freeze, or a re-freeze right after a cancel) may still exit.
 * Without it the second freeze would capture `freezing` as its own pre-freeze state, and so would
 * restore `freezing` when it was cancelled or failed.
 */
export const settledBeforeFreeze = new Map<string, FreezeStateSnapshot>();
