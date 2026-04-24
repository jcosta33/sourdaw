import { beforeEach, describe, expect, it } from 'vitest';

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

    it('preserves tool and sensitivity', () => {
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'lock-marker',
            sensitivity: 0.9,
        });
        closeElasticEditor();
        const state = elasticAudioStore.value;
        expect(state?.tool).toBe('lock-marker');
        expect(state?.sensitivity).toBe(0.9);
    });
});
