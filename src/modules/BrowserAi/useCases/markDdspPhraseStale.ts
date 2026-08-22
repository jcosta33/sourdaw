import { markPhraseStale } from '../stores/renderQueueStore';

import { getDdspPhraseId } from './getDdspPhraseId';

/** Invalidate the DDSP preview derived from a clip whose render source changed. */
export function markDdspPhraseStale(clipId: string): void {
    markPhraseStale(getDdspPhraseId(clipId));
}
