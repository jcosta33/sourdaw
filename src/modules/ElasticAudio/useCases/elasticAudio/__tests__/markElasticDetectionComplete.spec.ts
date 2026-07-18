import { beforeEach, describe, expect, it } from 'vitest';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { markElasticDetectionComplete } from '../markElasticDetectionComplete';

describe('markElasticDetectionComplete', () => {
    beforeEach(() => {
        elasticAudioStore.set({ ...defaultElasticAudioState });
    });

    it('marks detection complete', () => {
        markElasticDetectionComplete();
        expect(elasticAudioStore.value?.detected).toBe(true);
    });

    it('preserves the current editor state', () => {
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'lock-marker',
            sensitivity: 0.72,
            selectedMarkerIds: ['marker-1'],
        });

        markElasticDetectionComplete();

        expect(elasticAudioStore.value).toEqual({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'lock-marker',
            sensitivity: 0.72,
            selectedMarkerIds: ['marker-1'],
            detected: true,
        });
    });
});
