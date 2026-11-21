import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { answeringStatus } from '../answeringStatus';
import { llmStatusStore, type LlmEngineStatus } from '../llmStatusStore';

const GENERATING_A: LlmEngineStatus = { state: 'generating', backend: 'webllm', modelId: 'model-a' };
const GENERATING_B: LlmEngineStatus = { state: 'generating', backend: 'webllm', modelId: 'model-b' };
const READY_A: LlmEngineStatus = { state: 'ready', backend: 'webllm', modelId: 'model-a' };
const LOADING: LlmEngineStatus = { state: 'loading', progress: 0.5, text: 'Loading model-b' };
const REFUSAL: LlmEngineStatus = {
    state: 'error',
    message: 'Not enough storage for model-b',
    refusal: {
        reason: 'insufficient-storage',
        modelId: 'model-b',
        requiredBytes: 2_000_000_000,
        availableBytes: 1_000,
    },
};

function publishGenerating(turn: ReturnType<typeof answeringStatus.openTurn>, status: LlmEngineStatus) {
    if (status.state !== 'generating') {
        throw new Error('expected a generating status');
    }
    answeringStatus.publish(turn, status);
}

describe('answeringStatus engine statuses', () => {
    beforeEach(() => {
        answeringStatus.clear();
        llmStatusStore.set(READY_A);
    });

    afterEach(() => {
        answeringStatus.clear();
        llmStatusStore.set({ state: 'idle' });
    });

    it('publishes an engine status at once while no turn answers', () => {
        answeringStatus.publishEngineStatus(LOADING);
        expect(llmStatusStore.value).toEqual(LOADING);
    });

    it.each([
        ['loading', LOADING],
        ['refusal', REFUSAL],
        ['ready', { state: 'ready', backend: 'webllm', modelId: 'model-b' } satisfies LlmEngineStatus],
    ])('keeps generating on screen when a load records %s, then settles to it', (_name, status) => {
        const turn = answeringStatus.openTurn();
        publishGenerating(turn, GENERATING_A);

        answeringStatus.publishEngineStatus(status);
        expect(llmStatusStore.value).toEqual(GENERATING_A);

        answeringStatus.settle(turn, READY_A);
        expect(llmStatusStore.value).toEqual(status);
    });

    it('settles a turn that leaves the engine as it was to the status the load recorded', () => {
        const turn = answeringStatus.openTurn();
        publishGenerating(turn, GENERATING_A);
        answeringStatus.publishEngineStatus(REFUSAL);

        answeringStatus.settle(turn, answeringStatus.readSettled());

        expect(llmStatusStore.value).toEqual(REFUSAL);
    });

    it('still settles to the turn computed status when no load recorded one', () => {
        const turn = answeringStatus.openTurn();
        publishGenerating(turn, GENERATING_A);

        answeringStatus.settle(turn, { state: 'error', message: 'turn failed' });

        expect(llmStatusStore.value).toEqual({ state: 'error', message: 'turn failed' });
    });

    it('lets a turn that published after the load settle to its own status', () => {
        const first = answeringStatus.openTurn();
        publishGenerating(first, GENERATING_A);
        answeringStatus.publishEngineStatus(REFUSAL);
        const second = answeringStatus.openTurn();
        publishGenerating(second, GENERATING_B);

        answeringStatus.settle(second, READY_A);
        expect(llmStatusStore.value).toEqual(GENERATING_A);
        answeringStatus.settle(first, { state: 'idle' });

        expect(llmStatusStore.value).toEqual(READY_A);
    });

    it('keeps the newest attempt on screen across overlapping turns until the last settles', () => {
        const first = answeringStatus.openTurn();
        const second = answeringStatus.openTurn();
        publishGenerating(first, GENERATING_A);
        publishGenerating(second, GENERATING_B);
        answeringStatus.publishEngineStatus(LOADING);
        expect(llmStatusStore.value).toEqual(GENERATING_B);

        answeringStatus.settle(second, READY_A);
        expect(llmStatusStore.value).toEqual(GENERATING_A);
        answeringStatus.settle(first, READY_A);

        expect(llmStatusStore.value).toEqual(LOADING);
    });

    it('reads the engine status the store hides while a turn answers', () => {
        const turn = answeringStatus.openTurn();
        publishGenerating(turn, GENERATING_A);
        answeringStatus.publishEngineStatus(REFUSAL);

        expect(answeringStatus.readEngineStatus()).toEqual(REFUSAL);
        answeringStatus.settle(turn, null);
        expect(answeringStatus.readEngineStatus()).toEqual(REFUSAL);
    });
});
