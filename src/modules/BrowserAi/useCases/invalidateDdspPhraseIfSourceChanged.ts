import { invalidatePhraseSource } from '../stores/renderQueueStore';

import { getDdspPhraseId } from './getDdspPhraseId';

/** Mark a completed canonical DDSP preview stale when its effective source no longer matches. */
export function invalidateDdspPhraseIfSourceChanged(clipId: string, sourceFingerprint: string): boolean {
    return invalidatePhraseSource(getDdspPhraseId(clipId), sourceFingerprint);
}
