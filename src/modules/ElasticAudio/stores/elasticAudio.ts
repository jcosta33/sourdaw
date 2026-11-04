import { createStore } from '#/infra/store/createStore';

export type ElasticEditorTool = 'select' | 'add-marker' | 'remove-marker' | 'lock-marker';

export type ElasticAudioState = {
    openClipId: string | null;
    tool: ElasticEditorTool;
    selectedMarkerIds: string[];
    detected: boolean;
};

export const defaultElasticAudioState: ElasticAudioState = {
    openClipId: null,
    tool: 'select',
    selectedMarkerIds: [],
    detected: false,
};

export const elasticAudioStore = createStore<ElasticAudioState>({
    initialData: defaultElasticAudioState,
});
