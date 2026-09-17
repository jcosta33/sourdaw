import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../../models/AgentResourceLimits';
import { type ModelProviderRequestInput } from '../../../models/ModelProviderProtocol';
import { agentResourceLimitsStore } from '../../../stores/agentResourceLimitsStore';
import { configureAgentResourceLimits } from '../../configureAgentResourceLimits';
import { runLocalModelTextCompletion } from '../runLocalModelTextCompletion';

const mocks = vi.hoisted(() => ({
    compileRequest: vi.fn((_input: ModelProviderRequestInput) => undefined),
}));

vi.mock('../../modelProviderProtocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../modelProviderProtocol')>();
    return {
        ...actual,
        createModelProviderProtocol: (input: Parameters<typeof actual.createModelProviderProtocol>[0]) => {
            const protocol = actual.createModelProviderProtocol(input);
            return {
                ...protocol,
                compileRequest: (request: ModelProviderRequestInput) => {
                    mocks.compileRequest(request);
                    return protocol.compileRequest(request);
                },
            };
        },
    };
});

async function compileLocalRequest(): Promise<{
    limitsMaxOutputTokens: number;
    budgetMaxOutputTokens: number;
    maxTotalTokens: number;
}> {
    mocks.compileRequest.mockClear();
    await runLocalModelTextCompletion({
        provider: 'webllm',
        model: 'local-model',
        systemPrompt: 'You are a DAW assistant.',
        userMessage: 'Describe the mix.',
        maxOutputTokens: 2_048,
        execute: async () => 'Local answer',
    });
    const compiled = mocks.compileRequest.mock.calls[0]?.[0];
    if (compiled === undefined) {
        throw new Error('the local route compiled no provider request');
    }
    return {
        limitsMaxOutputTokens: compiled.limits.maxOutputTokens,
        budgetMaxOutputTokens: compiled.budget.maxOutputTokens,
        maxTotalTokens: compiled.budget.maxTotalTokens,
    };
}

describe('runLocalModelTextCompletion output ceiling', () => {
    afterEach(() => {
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('lowers the caller ceiling and the total budget to a smaller configured model ceiling', async () => {
        expect(configureAgentResourceLimits({ maxModelOutputTokens: 256 })).toMatchObject({ status: 'configured' });

        await expect(compileLocalRequest()).resolves.toEqual({
            limitsMaxOutputTokens: 256,
            budgetMaxOutputTokens: 256,
            maxTotalTokens: 33_024,
        });
    });

    it('keeps the caller ceiling when the configured model ceiling is larger', async () => {
        await expect(compileLocalRequest()).resolves.toEqual({
            limitsMaxOutputTokens: 2_048,
            budgetMaxOutputTokens: 2_048,
            maxTotalTokens: 34_816,
        });
    });
});
