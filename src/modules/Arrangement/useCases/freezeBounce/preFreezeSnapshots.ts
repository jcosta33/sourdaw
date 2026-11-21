import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';

/** The state each track with a running freeze returns to when that freeze does not commit. */
export const preFreezeSnapshots = new Map<string, FreezeStateSnapshot>();
