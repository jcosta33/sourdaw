import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPreferences } from '#/modules/Preferences/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { closeElasticEditor } from '../closeElasticEditor';

describe('closeElasticEditor', () => {
    beforeEach(() => {
        elasticAudioStore.set({ ...defaultElasticAudioState });
    });

    it('clears openClipId and selection', () => {
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            selectedMarkerIds: ['m-1'],
        });
        closeElasticEditor();
        const state = elasticAudioStore.value;
        expect(state?.openClipId).toBeNull();
        expect(state?.selectedMarkerIds).toEqual([]);
    });

    it('preserves tool and user sensitivity preference', () => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.9 });
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'lock-marker',
        });
        closeElasticEditor();
        const state = elasticAudioStore.value;
        expect(state?.tool).toBe('lock-marker');
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.9);
    });
});
