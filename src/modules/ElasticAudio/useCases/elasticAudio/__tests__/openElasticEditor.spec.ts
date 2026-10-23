import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPreferences } from '#/modules/Preferences/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { openElasticEditor } from '../openElasticEditor';

describe('openElasticEditor', () => {
    beforeEach(() => {
        elasticAudioStore.set({ ...defaultElasticAudioState });
    });

    it('sets openClipId to the supplied clipId', () => {
        openElasticEditor('clip-123');
        expect(elasticAudioStore.value?.openClipId).toBe('clip-123');
    });

    it('resets detected flag and selectedMarkerIds', () => {
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            detected: true,
            selectedMarkerIds: ['a', 'b'],
        });
        openElasticEditor('clip-1');
        const state = elasticAudioStore.value;
        expect(state?.detected).toBe(false);
        expect(state?.selectedMarkerIds).toEqual([]);
    });

    it('preserves the tool and the user preference when switching clips', () => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.8 });
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            tool: 'add-marker',
        });
        openElasticEditor('clip-1');
        const state = elasticAudioStore.value;
        expect(state?.tool).toBe('add-marker');
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.8);
    });
});
