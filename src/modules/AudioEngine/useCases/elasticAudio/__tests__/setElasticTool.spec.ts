import { beforeEach, describe, expect, it } from 'vitest';

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
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            sensitivity: 0.75,
        });
        setElasticTool('lock-marker');
        const state = elasticAudioStore.value;
        expect(state?.openClipId).toBe('clip-1');
        expect(state?.sensitivity).toBe(0.75);
        expect(state?.tool).toBe('lock-marker');
    });
});
