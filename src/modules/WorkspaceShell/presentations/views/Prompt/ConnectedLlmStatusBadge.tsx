import { type ReactElement } from 'react';

import { useStore } from '#/infra/store/useStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores';
import { initEngine, isLlmAvailable } from '#/modules/AiRuntime/useCases';

import { LlmStatusBadge } from './LlmStatusBadge';

const idleStatus: typeof llmStatusStore.value = { state: 'idle' };

/** The status badge outside the Prompt Bar, reading the same engine status and loading the same way. */
export const ConnectedLlmStatusBadge = (): ReactElement | null => {
    const status = useStore(llmStatusStore, idleStatus);
    const loadModel = (modelId?: string): void => {
        if (isLlmAvailable()) {
            void initEngine(modelId, { webLlmDownloadConsent: true });
        }
    };
    return <LlmStatusBadge status={status} onLoad={loadModel} />;
};
