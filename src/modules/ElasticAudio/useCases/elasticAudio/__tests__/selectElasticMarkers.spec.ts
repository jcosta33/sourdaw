import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPreferences } from '#/modules/Preferences/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';

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
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        elasticAudioStore.set({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'select',
            detected: true,
        });

        selectElasticMarkers(['marker-9']);

        expect(elasticAudioStore.value).toEqual({
            ...defaultElasticAudioState,
            openClipId: 'clip-1',
            tool: 'select',
            selectedMarkerIds: ['marker-9'],
            detected: true,
        });
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.82);
    });
});
