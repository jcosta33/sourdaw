import { elasticAudioStore, defaultElasticAudioState, type ElasticEditorTool } from '../../stores/elasticAudio';

export function setElasticTool(tool: ElasticEditorTool): void {
    const current = elasticAudioStore.value ?? defaultElasticAudioState;
    elasticAudioStore.set({ ...current, tool });
}
