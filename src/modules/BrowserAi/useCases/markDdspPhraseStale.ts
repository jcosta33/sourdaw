import { markPhraseStale, renderQueueStore } from '../stores/renderQueueStore';

import { getDdspPhraseId } from './getDdspPhraseId';

/** Invalidate the DDSP preview derived from a clip whose render source changed. */
export function markDdspPhraseStale(clipId: string): void {
    const phraseId = getDdspPhraseId(clipId);
    const status = renderQueueStore.value?.phraseStatusMap[phraseId];
    if (status !== 'preview' && status !== 'final' && status !== 'stale') {
        return;
    }
    markPhraseStale(phraseId);
}
