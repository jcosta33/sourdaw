import { beforeEach, describe, expect, it } from 'vitest';

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

    it('preserves tool and sensitivity when switching clips', () => {
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            tool: 'add-marker',
            sensitivity: 0.8,
        });
        openElasticEditor('clip-1');
        const state = elasticAudioStore.value;
        expect(state?.tool).toBe('add-marker');
        expect(state?.sensitivity).toBe(0.8);
    });
});
