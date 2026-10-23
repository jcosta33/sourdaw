import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPreferences } from '#/modules/Preferences/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { setElasticTool } from '../setElasticTool';

describe('setElasticTool', () => {
    beforeEach(() => {
        elasticAudioStore.set({ ...defaultElasticAudioState });
    });

    it('updates tool to the supplied value', () => {
        setElasticTool('add-marker');
        expect(elasticAudioStore.value?.tool).toBe('add-marker');
        setElasticTool('remove-marker');
        expect(elasticAudioStore.value?.tool).toBe('remove-marker');
    });

    it('does not mutate other fields', () => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.75 });
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
        });
        setElasticTool('lock-marker');
        const state = elasticAudioStore.value;
        expect(state?.openClipId).toBe('clip-1');
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.75);
        expect(state?.tool).toBe('lock-marker');
    });
});
