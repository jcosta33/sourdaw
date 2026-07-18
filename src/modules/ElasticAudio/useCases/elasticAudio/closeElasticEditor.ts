import { elasticAudioStore, defaultElasticAudioState } from '../../stores/elasticAudio';

export function closeElasticEditor(): void {
    const current = elasticAudioStore.value ?? defaultElasticAudioState;
    elasticAudioStore.set({
        ...current,
        openClipId: null,
        selectedMarkerIds: [],
    });
}
