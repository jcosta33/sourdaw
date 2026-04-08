import { createStore } from '#/infra/store/createStore';
import { type AudioGraphState, defaultAudioGraphState } from '../models/AudioGraph';

export { type AudioGraphState, defaultAudioGraphState };

export const audioGraphStore = createStore<AudioGraphState>({
    initialData: defaultAudioGraphState,
});
