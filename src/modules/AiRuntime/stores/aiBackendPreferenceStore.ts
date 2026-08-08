import { createStore } from '#/infra/store/createStore';

import { type AiBackendPreference } from '../models/LlmOrchestrationTypes';

export const aiBackendPreferenceStore = createStore<AiBackendPreference>({
    initialData: 'webllm',
});
