import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPreferences } from '#/modules/Preferences/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';

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
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.72 });
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'lock-marker',
            selectedMarkerIds: ['marker-1'],
        });

        markElasticDetectionComplete();

        expect(elasticAudioStore.value).toEqual({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'lock-marker',
            selectedMarkerIds: ['marker-1'],
            detected: true,
        });
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.72);
    });
});
