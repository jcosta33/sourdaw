import { createStore } from '#/infra/store/createStore';

export type AudioRoute = {
    id: string;
    sourceId: string;
    destinationId: string;
    gain: number;
};

export type AudioGraphState = {
    routes: AudioRoute[];
};

export const defaultAudioGraphState: AudioGraphState = {
    routes: [],
};

export const audioGraphStore = createStore<AudioGraphState>({
    initialData: defaultAudioGraphState,
});
