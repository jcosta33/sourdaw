import { createStore } from '#/infra/store/createStore';

export type ElasticEditorTool = 'select' | 'add-marker' | 'remove-marker' | 'lock-marker';

export type ElasticAudioState = {
    openClipId: string | null;
    tool: ElasticEditorTool;
    sensitivity: number;
    selectedMarkerIds: string[];
    detected: boolean;
};

export const defaultElasticAudioState: ElasticAudioState = {
    openClipId: null,
    tool: 'select',
    sensitivity: 0.5,
    selectedMarkerIds: [],
    detected: false,
};

export const elasticAudioStore = createStore<ElasticAudioState>({
    initialData: defaultElasticAudioState,
});
