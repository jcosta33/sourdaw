import { associatePhraseSource } from '../stores/renderQueueStore';

import { getDdspPhraseId } from './getDdspPhraseId';

/** Associate a completed canonical DDSP preview with the effective source that produced it. */
export function recordDdspPhraseSource(clipId: string, sourceFingerprint: string): void {
    associatePhraseSource(getDdspPhraseId(clipId), sourceFingerprint);
}
