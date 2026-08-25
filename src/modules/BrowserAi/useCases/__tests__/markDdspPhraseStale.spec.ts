import { describe, expect, it } from 'vitest';

import { renderQueueStore } from '../../stores/renderQueueStore';
import { getDdspPhraseId } from '../getDdspPhraseId';
import { markDdspPhraseStale } from '../markDdspPhraseStale';

describe('markDdspPhraseStale', () => {
    it('uses one stable canonical DDSP phrase identity for a clip', () => {
        expect(getDdspPhraseId('clip-1')).toBe('clip-1-ddsp');
        expect(getDdspPhraseId('clip-1')).toBe(getDdspPhraseId('clip-1'));
    });

    it('marks preview and final canonical DDSP phrases stale', () => {
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-preview-ddsp': 'preview', 'clip-final-ddsp': 'final' },
        });

        markDdspPhraseStale('clip-preview');
        markDdspPhraseStale('clip-final');

        expect(renderQueueStore.value?.phraseStatusMap['clip-preview-ddsp']).toBe('stale');
        expect(renderQueueStore.value?.phraseStatusMap['clip-final-ddsp']).toBe('stale');
    });

    it('does not create stale state for absent or non-rendered canonical DDSP phrases', () => {
        const initialPhraseStatusMap = {
            'clip-queued-ddsp': 'queued',
            'clip-preparing-ddsp': 'preparing',
            'clip-rendering-browser-ddsp': 'rendering-browser',
            'clip-rendering-native-ddsp': 'rendering-native',
            'clip-not-rendered-ddsp': 'not-rendered',
            'clip-error-ddsp': 'error',
        } as const;
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: initialPhraseStatusMap,
        });

        for (const clipId of [
            'clip-absent',
            'clip-queued',
            'clip-preparing',
            'clip-rendering-browser',
            'clip-rendering-native',
            'clip-not-rendered',
            'clip-error',
        ]) {
            markDdspPhraseStale(clipId);
        }

        expect(renderQueueStore.value?.phraseStatusMap).toEqual(initialPhraseStatusMap);
    });
});
