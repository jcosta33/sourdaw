import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { AiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { HostedToolCallingProtocolError } from '../../../errors/HostedToolCallingProtocolError';
import { NativeToolCallingProtocolError } from '../../../errors/NativeToolCallingProtocolError';
import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type ModelProviderResult } from '../../../models/ModelProviderProtocol';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import {
    createWorkflowCapabilityToolSchema,
    WORKFLOW_CAPABILITY_ACTION_TOOL_NAMES,
} from '../../../models/WorkflowCapability';
import { APPLICATION_OWNED_TOOL_SCHEMAS } from '../../applicationOwnedToolLoop';
import { generateToolCalls as generateCompatibleToolCalls } from '../generateToolCalls';
import { generateToolPlanningOutcome as generateToolCalls } from '../inference';

type ReadyStatus = {
    state: 'ready';
    backend: 'native' | 'webllm' | 'cloud';
    modelId: string;
};

const { mockLogger, mocks } = vi.hoisted(() => {
    const backendPreference: { value: 'auto' | 'native' | 'webllm' | 'cloud' } = { value: 'auto' };
    const llmStatusValue: { value: ReadyStatus } = {
        value: { state: 'ready', backend: 'webllm', modelId: 'test-model' },
    };

    return {
        mockLogger: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
        mocks: {
            backendChain: { value: Array<string>() },
            nativeEngineReady: { value: false },
            generateNativeToolCalls: vi.fn(),
            generateNativeCompletion: vi.fn(),
            parseToolPlanningOutcome: vi.fn(),
            generateCloudToolCalls: vi.fn(),
            getCloudProviderInfo: vi.fn(),
            generateWebLlmToolCalls: vi.fn(),
            initWebLlmEngine: vi.fn(),
            isWebLlmLoaded: vi.fn(),
            llmStatusSet: vi.fn(),
            llmStatusValue,
            backendPreference,
            providerFinishCalls: [] as unknown[],
        },
    };
});

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: () => mocks.backendChain.value,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('../../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: () => mocks.nativeEngineReady.value,
}));

vi.mock('../../../repositories/nativeEngine/nativeToolCalling', () => ({
    generateNativeToolCalls: mocks.generateNativeToolCalls,
}));

vi.mock('../../../repositories/nativeEngine/completions', () => ({
    generateNativeCompletion: mocks.generateNativeCompletion,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: mocks.generateCloudToolCalls,
}));

vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: mocks.isWebLlmLoaded,
}));

vi.mock('../../../repositories/webLlm/toolCalling', () => ({
    generateWebLlmToolCalls: mocks.generateWebLlmToolCalls,
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: {
        get value() {
            return mocks.llmStatusValue.value;
        },
        set: mocks.llmStatusSet,
    },
}));

vi.mock('../../../stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.backendPreference,
}));

vi.mock('../../../transformers/toolCallParser', () => ({
    parseToolPlanningOutcome: mocks.parseToolPlanningOutcome,
}));

vi.mock('../../modelProviderProtocol', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../modelProviderProtocol')>();
    return {
        createModelProviderProtocol: (...args: Parameters<typeof original.createModelProviderProtocol>) => {
            const protocol = original.createModelProviderProtocol(...args);
            return {
                ...protocol,
                start: (request: Parameters<typeof protocol.start>[0]) => {
                    const session = protocol.start(request);
                    return {
                        ...session,
                        finish: (finish: Parameters<typeof session.finish>[0]) => {
                            mocks.providerFinishCalls.push(finish);
                            return session.finish(finish);
                        },
                    };
                },
            };
        },
    };
});

function completePlan<TToolCall>(toolCalls: TToolCall[]) {
    return { status: 'complete' as const, toolCalls };
}

describe('generateToolPlanningOutcome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        mocks.nativeEngineReady.value = false;
        mocks.generateNativeToolCalls.mockReset();
        mocks.generateNativeCompletion.mockReset();
        mocks.parseToolPlanningOutcome.mockReset();
        mocks.getCloudProviderInfo.mockReturnValue(null);
        mocks.llmStatusValue.value = { state: 'ready', backend: 'webllm', modelId: 'test-model' };
        mocks.backendPreference.value = 'auto';
        mocks.providerFinishCalls.length = 0;
    });

    it('should throw when no backend chain is available', async () => {
        await expect(generateToolCalls('sys', 'hello')).rejects.toThrow(/No AI backend available/);
    });

    it('terminates a thrown provider attempt through a typed neutral failure', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.getCloudProviderInfo.mockReturnValue({ provider: 'openai', model: 'hosted-model' });
        mocks.generateCloudToolCalls.mockRejectedValue(new Error('private provider diagnostic'));

        await expect(generateToolCalls('sys', 'mute drums')).rejects.toMatchObject({
            _tag: 'ModelProviderFailure',
            message: 'The model provider request failed.',
            code: 'provider-attempt-failed',
            correlationId: expect.stringMatching(/^tool-planning-/),
            retryable: true,
            partialOutputDisposition: 'discard',
        });
        expect(mocks.providerFinishCalls).toContainEqual({
            reason: 'error',
            failure: {
                code: 'provider-attempt-failed',
                retryable: true,
                safeMessage: 'The model provider request failed.',
            },
        });
    });

    it('should use repository-owned native structured tool calls before text fallback', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([
            { name: 'mute_track', arguments: { track_id: 'track-1', muted: true } },
        ]);

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: 'sys',
                userMessage: 'mute drums',
                temperature: 0.1,
            })
        );
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
        expect(result).toEqual(completePlan([{ name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]));
    });

    it('does not retry a successful provider when result persistence throws', async () => {
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([
            { name: 'mute_track', arguments: { track_id: 'track-1', muted: true } },
        ]);

        await expect(
            generateToolCalls('sys', 'mute drums', undefined, undefined, undefined, () => {
                throw new Error('provider usage persistence failed');
            })
        ).resolves.toEqual(completePlan([{ name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]));
        expect(mocks.generateWebLlmToolCalls).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI Engine] Provider result observer failed: provider usage persistence failed'
        );
    });

    it('preserves a terminal native structured no-op without retrying through text', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([]);

        const result = await generateToolCalls('sys', 'leave the mix unchanged');

        expect(result).toEqual(completePlan([]));
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it('preserves provider tool-call identities through production normalization', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(
            completePlan([{ id: 'provider-call-1', name: 'project.query', arguments: { type: 'project-summary' } }])
        );

        await expect(generateToolCalls('sys', 'inspect project', APPLICATION_OWNED_TOOL_SCHEMAS)).resolves.toEqual(
            completePlan([{ id: 'provider-call-1', name: 'project.query', arguments: { type: 'project-summary' } }])
        );
    });

    it('does not bypass a rejected native invoke outcome through text or provider fallback', async () => {
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockRejectedValue(
            new ToolPlanningRejectedError('Native tool calling returned inconsistent finish reason length')
        );

        const result = await generateToolCalls('sys', 'mute drums');

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Native tool calling returned inconsistent finish reason length',
        });
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.generateWebLlmToolCalls).not.toHaveBeenCalled();
    });

    it('marks malformed native DTOs unhealthy and tries another provider without text fallback', async () => {
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.nativeEngineReady.value = true;
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateNativeToolCalls.mockRejectedValue(
            new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope')
        );
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolPlanningOutcome.mockReturnValue(completePlan([{ name: 'mute_track', arguments: {} }]));
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([{ name: 'soloTrack', arguments: {} }]));

        const providerResults: ModelProviderResult[] = [];

        await expect(
            generateToolCalls('sys', 'solo drums', undefined, undefined, undefined, (result) => {
                providerResults.push(result);
            })
        ).resolves.toEqual(completePlan([{ name: 'soloTrack', arguments: {} }]));
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledOnce();
        expect(mocks.llmStatusSet).not.toHaveBeenCalledWith({ state: 'ready', backend: 'native', modelId: 'native' });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith(
            expect.objectContaining({ state: 'ready', backend: 'webllm' })
        );
        expect(providerResults).toHaveLength(2);
        expect(providerResults.map((result) => result.provider)).toEqual(['native', 'webllm']);
        expect(providerResults.map((result) => result.status)).toEqual(['failed', 'complete']);
        expect(providerResults[0]?.correlationId).not.toBe(providerResults[1]?.correlationId);
        expect(providerResults[0]?.failure).toMatchObject({ retryable: true });
    });

    it('continues provider fallback when failed-attempt persistence throws', async () => {
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.nativeEngineReady.value = true;
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateNativeToolCalls.mockRejectedValue(
            new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope')
        );
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([{ name: 'soloTrack', arguments: {} }]));

        await expect(
            generateToolCalls('sys', 'solo drums', undefined, undefined, undefined, () => {
                throw new Error('provider usage persistence failed');
            })
        ).resolves.toEqual(completePlan([{ name: 'soloTrack', arguments: {} }]));
        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledOnce();
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI Engine] Provider result observer failed: provider usage persistence failed'
        );
    });

    it('does not convert a malformed native DTO into a compatible empty plan', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockRejectedValue(
            new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope')
        );

        await expect(generateCompatibleToolCalls('sys', 'mute drums')).rejects.toMatchObject({
            _tag: 'ModelProviderFailure',
            message: 'The model provider request failed.',
            code: 'provider-attempt-failed',
            retryable: true,
            partialOutputDisposition: 'discard',
        });
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it.each(['Hosted AI refused tool planning', 'Hosted AI returned an invalid tool-planning response'])(
        'does not bypass terminal hosted rejection %s through provider fallback',
        async (reason) => {
            mocks.backendChain.value = ['cloud', 'native'];
            mocks.nativeEngineReady.value = true;
            mocks.generateCloudToolCalls.mockRejectedValue(new ToolPlanningRejectedError(reason));

            const result = await generateToolCalls('sys', 'mute drums');

            expect(result).toEqual({ status: 'rejected', reason });
            expect(mocks.generateNativeToolCalls).not.toHaveBeenCalled();
        }
    );

    it('falls back after hosted response cardinality violates the n:1 contract', async () => {
        mocks.backendChain.value = ['cloud', 'webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateCloudToolCalls.mockRejectedValue(
            new HostedToolCallingProtocolError('Hosted AI returned an invalid response choice count')
        );
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([{ name: 'soloTrack', arguments: {} }]));

        await expect(generateToolCalls('sys', 'solo drums')).resolves.toEqual(
            completePlan([{ name: 'soloTrack', arguments: {} }])
        );
        expect(mocks.llmStatusSet).not.toHaveBeenCalledWith({ state: 'ready', backend: 'cloud', modelId: 'cloud' });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith(
            expect.objectContaining({ state: 'ready', backend: 'webllm' })
        );
    });

    it('marks a lone hosted response cardinality failure as an operational error', async () => {
        const protocolError = new HostedToolCallingProtocolError('Hosted AI returned an invalid response choice count');
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockRejectedValue(protocolError);

        await expect(generateToolCalls('sys', 'mute drums')).rejects.toMatchObject({
            _tag: 'ModelProviderFailure',
            message: 'The model provider request failed.',
            code: 'provider-attempt-failed',
            retryable: true,
            partialOutputDisposition: 'discard',
            cause: protocolError,
        });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'error',
            message: 'The model provider request failed.',
        });
        expect(mocks.llmStatusSet).not.toHaveBeenCalledWith({ state: 'ready', backend: 'cloud', modelId: 'cloud' });
    });

    it('does not bypass a token-limited WebLLM plan through native fallback', async () => {
        mocks.backendChain.value = ['webllm', 'native'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.nativeEngineReady.value = true;
        mocks.generateWebLlmToolCalls.mockRejectedValue(
            new ToolPlanningRejectedError('WebLLM tool planning did not complete (finish_reason: length)')
        );

        await expect(generateToolCalls('sys', 'mute drums')).resolves.toEqual({
            status: 'rejected',
            reason: 'WebLLM tool planning did not complete (finish_reason: length)',
        });
        expect(mocks.generateNativeToolCalls).not.toHaveBeenCalled();
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
    });

    it('passes an explicit executable tool subset to every provider backend', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue([]);

        await generateToolCalls('sys', 'mute drums', tools);

        expect(mocks.generateCloudToolCalls).toHaveBeenCalledWith('sys', 'mute drums', tools);
    });

    it('bounds default WebLLM tools while retaining registry-relevant compound commands', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));

        await generateToolCalls('sys', 'create a vocal bus and route the vocal tracks with sends');

        const tools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] as ToolSchema[] | undefined;
        const toolNames = tools?.map((tool) => tool.function.name);
        expect(tools?.length).toBeLessThanOrEqual(30);
        expect(toolNames).toEqual(expect.arrayContaining(['createBus', 'addSend', 'setTrackOutput']));
    });

    it('always retains semantic workflow selection inside the bounded WebLLM tool set', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));
        const tools = [
            createWorkflowCapabilityToolSchema(['shared-vocal-fx-buses']),
            ...getExecutableAppActionToolSchemas(),
        ];

        await generateToolCalls('sys', 'rephrase with no capability-id token', tools);

        const selectedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] as ToolSchema[] | undefined;
        expect(selectedTools?.map((tool) => tool.function.name)).toEqual(
            expect.arrayContaining(['selectWorkflowCapability', ...WORKFLOW_CAPABILITY_ACTION_TOOL_NAMES])
        );
        expect(selectedTools?.length).toBeLessThanOrEqual(30);
    });

    it('always retains the application-owned project query inside the bounded WebLLM tool set', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));
        const tools = [...APPLICATION_OWNED_TOOL_SCHEMAS, ...getExecutableAppActionToolSchemas()];

        await generateToolCalls('sys', 'inspect the project before editing', tools);

        const selectedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] as ToolSchema[] | undefined;
        expect(selectedTools?.map((tool) => tool.function.name)).toContain('project.query');
        expect(selectedTools?.length).toBeLessThanOrEqual(30);
    });

    it('retains a specialized legacy tool selected by its schema metadata', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));

        await generateToolCalls('sys', 'Generate MIDI notes for this clip');

        const tools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] as ToolSchema[] | undefined;
        expect(tools?.map((tool) => tool.function.name)).toContain('addNotes');
    });

    it('selects WebLLM tools from raw intent instead of untrusted context text', async () => {
        const requestedToolNames = new Set(['createBus', 'addSend', 'setTrackOutput']);
        const executableTools = getExecutableAppActionToolSchemas();
        const noisyContext = executableTools
            .filter((tool) => !requestedToolNames.has(tool.function.name))
            .map((tool) => tool.function.name)
            .join(' ');
        const rawPrompt = 'create a vocal bus and route the vocal tracks with sends';
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));

        await generateToolCalls('sys', noisyContext, executableTools, undefined, rawPrompt);

        const selectedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] as ToolSchema[] | undefined;
        expect(selectedTools?.map((tool) => tool.function.name)).toEqual(
            expect.arrayContaining([...requestedToolNames])
        );
    });

    it('stops provider fallback when tool planning is aborted mid-flight', async () => {
        mocks.backendChain.value = ['cloud', 'native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateCloudToolCalls.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();

        const pending = generateToolCalls('sys', 'mute drums', undefined, controller.signal);
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.generateNativeToolCalls).not.toHaveBeenCalled();
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'ready',
            backend: 'webllm',
            modelId: 'test-model',
        });
    });

    it('does not restore a ready backend that failed before fallback was aborted', async () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'native', modelId: 'native' };
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.nativeEngineReady.value = true;
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateNativeToolCalls.mockRejectedValue(
            new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope')
        );
        mocks.generateWebLlmToolCalls.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();

        const pending = generateToolCalls('sys', 'mute drums', undefined, controller.signal);
        await vi.waitFor(() => expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledOnce());
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({ state: 'idle' });
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
    });

    it('does not restore native readiness when an already-rejected protocol failure races abort', async () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'native', modelId: 'native' };
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockRejectedValue(
            new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope')
        );
        const controller = new AbortController();

        const pending = generateToolCalls('sys', 'mute drums', undefined, controller.signal);
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({ state: 'idle' });
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
    });

    it('treats hosted session revocation as terminal without trying another backend', async () => {
        mocks.backendChain.value = ['cloud', 'native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateCloudToolCalls.mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await expect(generateToolCalls('sys', 'mute drums')).rejects.toMatchObject({
            name: 'AiRuntimeConfigurationChangedError',
        });

        expect(mocks.generateNativeToolCalls).not.toHaveBeenCalled();
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({ state: 'idle' });
    });

    it('does not restore a stale backend after preference-switch cancellation', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();

        const pending = generateToolCalls('sys', 'mute drums', undefined, controller.signal);
        mocks.backendPreference.value = 'native';
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({ state: 'idle' });
    });

    it('passes an explicit executable tool subset to WebLLM without widening it', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));

        const controller = new AbortController();
        await generateToolCalls('sys', 'mute drums', tools, controller.signal);

        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledWith('sys', 'mute drums', tools, controller.signal);
    });

    it('rejects a WebLLM call whose registered tool was not advertised for this request', async () => {
        const tools: ToolSchema[] = Array.from({ length: 35 }, (_, index) => ({
            type: 'function',
            function: {
                name: `action${String(index)}`,
                description: `Action ${String(index)}`,
                parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
            },
        }));
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockImplementation(
            async (_systemPrompt: string, _userMessage: string, advertisedTools: ToolSchema[]) => {
                const advertisedNames = new Set(advertisedTools.map((tool) => tool.function.name));
                const omittedTool = tools.find((tool) => !advertisedNames.has(tool.function.name));
                if (!omittedTool) {
                    throw new Error('Expected prompt tool selection to omit at least one registered tool');
                }
                return completePlan([{ id: 'unadvertised-call', name: omittedTool.function.name, arguments: {} }]);
            }
        );

        await expect(generateToolCalls('sys', 'use the appropriate action', tools)).resolves.toEqual({
            status: 'rejected',
            reason: 'Provider requested a tool that was not advertised for this request.',
        });
    });

    it('passes cancellation into WebLLM initialization', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(false);
        mocks.initWebLlmEngine.mockResolvedValue({});
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));
        const controller = new AbortController();

        await generateToolCalls('sys', 'mute drums', [], controller.signal);

        expect(mocks.initWebLlmEngine).toHaveBeenCalledWith(undefined, { signal: controller.signal });
    });
    it('preserves the direct-consumer array contract and fails fast on rejection', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(
            completePlan([{ name: 'muteTrack', arguments: { trackId: 'track-1' } }])
        );

        await expect(generateCompatibleToolCalls('sys', 'mute drums')).resolves.toEqual([
            { name: 'muteTrack', arguments: { trackId: 'track-1' } },
        ]);
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'rejected', reason: 'Refused tool planning' });

        await expect(generateCompatibleToolCalls('sys', 'mute drums')).rejects.toThrow('Refused tool planning');
    });

    it('passes an explicit executable tool subset to native structured calling', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([
            { name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
        ]);

        await generateToolCalls('sys', 'mute drums', tools);

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledWith({
            systemPrompt: 'sys',
            userMessage: 'mute drums',
            tools: [
                {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: tools[0]?.function.parameters,
                },
            ],
            temperature: 0.1,
        });
    });

    it('should fall back to native text completion when structured native calls are unavailable', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue(null);
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolPlanningOutcome.mockReturnValue(completePlan([{ name: 'mute_track', arguments: {} }]));

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledTimes(1);
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(
            expect.stringContaining('Available tools:'),
            'mute drums',
            { requireComplete: true }
        );
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(
            expect.stringContaining('muteTrack'),
            'mute drums',
            { requireComplete: true }
        );
        expect(mocks.parseToolPlanningOutcome).toHaveBeenCalledWith('<tool name="mute_track" />');
        expect(result).toEqual(completePlan([{ name: 'mute_track', arguments: {} }]));
    });

    it.each([
        { response: 'I cannot change the project.', reason: 'non-tool' },
        { response: '[{"name":"mute_track","arguments":{', reason: 'malformed' },
    ])('returns a rejected outcome for a native text $reason response', async ({ response }) => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue(null);
        mocks.generateNativeCompletion.mockResolvedValue(response);
        mocks.parseToolPlanningOutcome.mockReturnValue({
            status: 'rejected',
            reason: 'Model returned a non-tool response instead of a complete tool-call batch.',
        });

        const result = await generateToolCalls('sys', 'mute drums');

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Model returned a non-tool response instead of a complete tool-call batch.',
        });
    });

    it('treats an incomplete native text finish as a terminal planning rejection', async () => {
        mocks.backendChain.value = ['native', 'cloud'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue(null);
        mocks.generateNativeCompletion.mockRejectedValue(
            new ToolPlanningRejectedError('Native text tool planning did not complete (finish_reason: length)')
        );

        const result = await generateToolCalls('sys', 'mute drums');

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Native text tool planning did not complete (finish_reason: length)',
        });
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(
            expect.stringContaining('Available tools:'),
            'mute drums',
            { requireComplete: true }
        );
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
        expect(mocks.generateCloudToolCalls).not.toHaveBeenCalled();
    });

    it('should fall back to native text completion when structured native calls fail', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockRejectedValue(new Error('structured unavailable'));
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolPlanningOutcome.mockReturnValue(completePlan([{ name: 'mute_track', arguments: {} }]));

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI Engine] Structured tool calling failed, falling back to text: structured unavailable'
        );
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(
            expect.stringContaining('Available tools:'),
            'mute drums',
            { requireComplete: true }
        );
        expect(result).toEqual(completePlan([{ name: 'mute_track', arguments: {} }]));
    });
});
