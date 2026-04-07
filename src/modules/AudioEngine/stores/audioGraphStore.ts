import { createStore } from '#/infra/store/createStore';
import { type AudioGraphState, defaultAudioGraphState } from '../models/AudioGraph';

export const audioGraphStore = createStore<AudioGraphState>({
    initialData: defaultAudioGraphState,
});
