import { defaultElasticAudioState, elasticAudioStore } from '../../stores/elasticAudio';

export function markElasticDetectionComplete(): void {
    const current = elasticAudioStore.value ?? defaultElasticAudioState;
    elasticAudioStore.set({ ...current, detected: true });
}
