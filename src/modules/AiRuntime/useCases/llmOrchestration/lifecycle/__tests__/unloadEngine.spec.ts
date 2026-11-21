import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answeringStatus } from '../../../../stores/answeringStatus';
import { type LlmEngineStatus, llmStatusStore } from '../../../../stores/llmStatusStore';
import { unloadEngine } from '../unloadEngine';

const { unloadWebLlmEngineMock } = vi.hoisted(() => ({ unloadWebLlmEngineMock: vi.fn() }));

vi.mock('../../../../repositories/webLlm/unloadWebLlmEngine', () => ({
    unloadWebLlmEngine: unloadWebLlmEngineMock,
}));

const READY: LlmEngineStatus = { state: 'ready', backend: 'webllm', modelId: 'model-under-test' };
const GENERATING: LlmEngineStatus = { state: 'generating', backend: 'webllm', modelId: 'model-under-test' };
const LOADING: LlmEngineStatus = { state: 'loading', progress: 0.5, text: 'Loading AI engine...' };

describe('unloadEngine', () => {
    beforeEach(() => {
        answeringStatus.clear();
        unloadWebLlmEngineMock.mockReset();
        llmStatusStore.set(READY);
    });

    it('unloads the engine and shows idle when no turn answers', () => {
        unloadEngine();

        expect(unloadWebLlmEngineMock).toHaveBeenCalledTimes(1);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('leaves the answering status showing and settles to idle when the turn ends in an error', () => {
        const turn = answeringStatus.openTurn();
        answeringStatus.publish(turn, GENERATING);
        answeringStatus.publishEngineStatus(LOADING);

        unloadEngine();

        expect(llmStatusStore.value).toEqual(GENERATING);

        answeringStatus.settle(turn, { state: 'error', message: 'x' });

        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });
});
