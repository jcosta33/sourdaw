import { beforeEach, describe, expect, it } from 'vitest';

import { renderQueueStore } from '#/modules/BrowserAi/stores';

import { invalidateDdspPhraseIfSourceChanged } from '../invalidateDdspPhraseIfSourceChanged';
import { recordDdspPhraseSource } from '../recordDdspPhraseSource';

describe('DDSP phrase source ownership', () => {
    beforeEach(() => {
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-1-ddsp': 'preview' },
        });
    });

    it('stales a completed canonical phrase only when its effective source changes', () => {
        recordDdspPhraseSource('clip-1', 'source-a');

        expect(invalidateDdspPhraseIfSourceChanged('clip-1', 'source-a')).toBe(false);
        expect(renderQueueStore.value?.phraseStatusMap['clip-1-ddsp']).toBe('preview');
        expect(invalidateDdspPhraseIfSourceChanged('clip-1', 'source-b')).toBe(true);
        expect(renderQueueStore.value?.phraseStatusMap['clip-1-ddsp']).toBe('stale');
        expect(renderQueueStore.value?.phraseSourceFingerprints?.['clip-1-ddsp']).toBeUndefined();
    });
});
