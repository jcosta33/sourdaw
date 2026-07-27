import { createStore } from '#/infra/store/createStore';

import { type HostedLlmProviderInfo } from '../models/HostedLlmProvider';

export const hostedLlmProviderStatusStore = createStore<HostedLlmProviderInfo | null>({
    initialData: null,
});
