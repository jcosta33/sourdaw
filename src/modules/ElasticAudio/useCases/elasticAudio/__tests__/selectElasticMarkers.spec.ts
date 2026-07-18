import { beforeEach, describe, expect, it } from 'vitest';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { selectElasticMarkers } from '../selectElasticMarkers';

describe('selectElasticMarkers', () => {
    beforeEach(() => {
        elasticAudioStore.set({ ...defaultElasticAudioState });
    });

    it('writes a copied marker id array', () => {
        const markerIds = ['marker-1', 'marker-2'];

        selectElasticMarkers(markerIds);

        const state = elasticAudioStore.value;
        expect(state?.selectedMarkerIds).toEqual(['marker-1', 'marker-2']);
        expect(state?.selectedMarkerIds).not.toBe(markerIds);

        markerIds.push('marker-3');
        expect(elasticAudioStore.value?.selectedMarkerIds).toEqual(['marker-1', 'marker-2']);
    });

    it('preserves the current editor state', () => {
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'select',
            sensitivity: 0.82,
            detected: true,
        });

        selectElasticMarkers(['marker-9']);

        expect(elasticAudioStore.value).toEqual({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'select',
            sensitivity: 0.82,
            selectedMarkerIds: ['marker-9'],
            detected: true,
        });
    });
});
