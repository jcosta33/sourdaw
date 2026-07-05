import { defaultElasticAudioState, elasticAudioStore } from '../../stores/elasticAudio';

export function selectElasticMarkers(markerIds: string[]): void {
    const current = elasticAudioStore.value ?? defaultElasticAudioState;
    elasticAudioStore.set({ ...current, selectedMarkerIds: [...markerIds] });
}
