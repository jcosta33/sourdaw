import { elasticAudioStore, defaultElasticAudioState } from '../../stores/elasticAudio';

export function openElasticEditor(clipId: string): void {
    const current = elasticAudioStore.value ?? defaultElasticAudioState;
    elasticAudioStore.set({
        ...current,
        openClipId: clipId,
        selectedMarkerIds: [],
        detected: false,
    });
}
