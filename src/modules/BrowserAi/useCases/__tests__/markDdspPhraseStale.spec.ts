import { describe, expect, it, beforeEach } from 'vitest';

import { renderQueueStore } from '../../stores/renderQueueStore';
import { getDdspPhraseId } from '../getDdspPhraseId';
import { markDdspPhraseStale } from '../markDdspPhraseStale';

describe('markDdspPhraseStale', () => {
    beforeEach(() => {
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-1': 'final', 'clip-1-ddsp': 'preview' },
        });
    });

    it('uses one stable canonical DDSP phrase identity for a clip', () => {
        expect(getDdspPhraseId('clip-1')).toBe('clip-1-ddsp');
        expect(getDdspPhraseId('clip-1')).toBe(getDdspPhraseId('clip-1'));
    });

    it('marks only the canonical DDSP phrase stale', () => {
        markDdspPhraseStale('clip-1');

        expect(renderQueueStore.value?.phraseStatusMap['clip-1-ddsp']).toBe('stale');
        expect(renderQueueStore.value?.phraseStatusMap['clip-1']).toBe('final');
    });
});
