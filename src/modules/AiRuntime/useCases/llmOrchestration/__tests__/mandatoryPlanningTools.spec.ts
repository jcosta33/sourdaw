import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlatformPlugins } from '#/modules/Arrangement/useCases';

import {
    CREATIVE_INTERPRETATION_TOOL_NAME,
    createCreativeInterpretationToolSchema,
    type CreativeInterpretationCatalog,
} from '../../../models/CreativeInterpretation';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES, WORKFLOW_CAPABILITY_TOOL_NAME } from '../../../models/WorkflowCapability';
import { encodeWireToolName } from '../../../repositories/cloudLlm/cloudInference/encodeWireToolName';
import { generateAnthropicToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateAnthropicToolCalls';
import { generateOpenAiCompatibleToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { generateOpenAiResponsesToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateOpenAiResponsesToolCalls';
import { AUTO_TOOL_CHOICE } from '../../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import {
    compileProviderAdapterInstallation,
    OPENAI_RESPONSES_ADAPTER_ID,
} from '../../../repositories/providerAdapterRegistry';
import { agentReferenceStore } from '../../../stores/agentReferenceStore';
import {
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    MANDATORY_PLANNING_TOOL_NAMES,
    RECIPE_EXPANSION_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../../applicationOwnedToolLoop';
import { buildAgentContext } from '../../buildAgentContext';
import { getPlanningProviderToolSchemas } from '../../getPlanningProviderToolSchemas';
import { getProjectContext } from '../../getProjectContext';
import { generateToolPlanningOutcome, WEBLLM_TOOL_BUDGET } from '../inference';

const mocks = vi.hoisted(() => ({
    backendChain: { value: [] as ('cloud' | 'webllm')[] },
    generateCloudToolCalls: vi.fn(),
    generateWebLlmToolCalls: vi.fn(),
    getCloudProviderInfo: vi.fn(),
    usesStrictCloudToolSchemas: vi.fn(),
    isWebLlmLoaded: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    requestAnthropicProvider: vi.fn(),
    requestHostedOpenAiProvider: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));
vi.mock('../backendResolution/getBackendChain', () => ({ getBackendChain: () => mocks.backendChain.value }));
vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: mocks.generateCloudToolCalls,
}));
vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));
vi.mock('../../../repositories/cloudLlm/usesStrictCloudToolSchemas', () => ({
    usesStrictCloudToolSchemas: mocks.usesStrictCloudToolSchemas,
}));
vi.mock('../../../repositories/webLlm/initWebLlmEngine', () => ({ initWebLlmEngine: vi.fn() }));
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: mocks.isWebLlmLoaded }));
vi.mock('../../../repositories/webLlm/toolCalling', () => ({
    generateWebLlmToolCalls: mocks.generateWebLlmToolCalls,
}));
vi.mock('../../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: mocks.requestAnthropicProvider,
}));
vi.mock('../../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: mocks.requestHostedOpenAiProvider,
}));

const MAX_RECEIPT_BYTES_PER_CALL = 16_384;
const NO_REVISION_REJECTION = 'Provider requested an unavailable application tool.';

const creativeCatalog: CreativeInterpretationCatalog = {
    schemaVersion: 1,
    catalogId: 'creative-catalog-1',
    revision: 'revision-1',
    requestDigest: 'digest-1',
    selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
    unresolvedExplicitReferences: [],
    modes: ['edit'],
    targets: [],
    dimensions: [],
    constraints: [],
    creationSlots: [],
};

/** The list production sends to every backend: the planning schemas plus the creative interpretation tool. */
function productionToolSchemas(): ToolSchema[] {
    return [...getPlanningProviderToolSchemas(), createCreativeInterpretationToolSchema(creativeCatalog)];
}

function namesOf(tools: readonly ToolSchema[]): string[] {
    return tools.map((tool) => tool.function.name);
}

function expectAllMandatory(names: readonly string[]): void {
    for (const name of MANDATORY_PLANNING_TOOL_NAMES) {
        expect(names, `${name} must be advertised`).toContain(name);
    }
}

function wireNamesOf(names: readonly string[]): string[] {
    return names.map(encodeWireToolName);
}

function readSentTools(body: string): string[] {
    const parsed = JSON.parse(body) as { tools: { name?: string; function?: { name: string } }[] };
    return parsed.tools.map((tool) => tool.name ?? tool.function?.name ?? '');
}

function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe('mandatory planning tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'openai',
            model: 'hosted-model',
            baseUrl: 'https://api.openai.com/v1',
            authentication: 'api-key',
        });
        mocks.usesStrictCloudToolSchemas.mockReturnValue(false);
        mocks.isWebLlmLoaded.mockReturnValue(true);
    });

    afterEach(() => {
        agentReferenceStore.set({ reference: null, loadEpoch: 0 });
    });

    it('names exactly the eight planning tools AC-002 makes mandatory', () => {
        expect([...MANDATORY_PLANNING_TOOL_NAMES].sort()).toEqual(
            [
                'project.query',
                'analysis.measure',
                'recipe.discover',
                'recipe.expand',
                'device.factory-manifest.read',
                'transform.compile',
                'command.batch.propose',
                'command.batch.decline',
            ].sort()
        );
    });

    it('assembles every mandatory tool into the production planning list', () => {
        expectAllMandatory(namesOf(productionToolSchemas()));
    });

    describe.each([
        { label: 'plain hosted wire', strict: false },
        { label: 'strict hosted wire', strict: true },
    ])('hosted backend, $label', ({ strict }) => {
        it('sends every mandatory tool to the hosted provider', async () => {
            mocks.backendChain.value = ['cloud'];
            mocks.usesStrictCloudToolSchemas.mockReturnValue(strict);
            mocks.generateCloudToolCalls.mockResolvedValue({
                providerRequestId: null,
                calls: [],
                strictToolSchemas: strict,
                usage: null,
            });

            await expect(
                generateToolPlanningOutcome('system', 'make the kick punchier', productionToolSchemas())
            ).resolves.toMatchObject({ status: 'complete' });

            const sent = (mocks.generateCloudToolCalls.mock.calls[0]?.[2] ?? []) as ToolSchema[];
            expectAllMandatory(namesOf(sent));
        });
    });

    describe('hosted dialects', () => {
        it('sends every mandatory tool in an Anthropic request body', async () => {
            let sentBody = '';
            mocks.requestAnthropicProvider.mockImplementation(
                async ({ body, onBodyChunk }: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
                    sentBody = body;
                    onBodyChunk(new TextEncoder().encode(JSON.stringify({ content: [], stop_reason: 'end_turn' })));
                    return { status: 200, contentType: 'application/json' };
                }
            );

            await generateAnthropicToolCalls({
                runtime: {
                    provider: 'anthropic',
                    authentication: 'api-key',
                    model: 'claude-test',
                    session_id: 'provider-session-00000000000000000000000000000000',
                },
                systemPrompt: 'system',
                userMessage: 'make the kick punchier',
                toolSchemas: productionToolSchemas(),
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
                signal: new AbortController().signal,
            });

            expect(readSentTools(sentBody)).toEqual(
                expect.arrayContaining(wireNamesOf([...MANDATORY_PLANNING_TOOL_NAMES]))
            );
        });

        it('sends every mandatory tool in an OpenAI Responses request body', async () => {
            let sentBody = '';
            mocks.requestHostedOpenAiProvider.mockImplementation(
                async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
                    sentBody = request.body;
                    request.onBodyChunk(
                        new TextEncoder().encode(JSON.stringify({ id: 'resp_1', status: 'completed', output: [] }))
                    );
                    return { status: 200, contentType: 'application/json' };
                }
            );
            const model = 'gpt-4-turbo';

            await generateOpenAiResponsesToolCalls({
                runtime: {
                    provider: 'openai',
                    model,
                    base_url: 'https://api.openai.com/v1',
                    authentication: 'api-key',
                    adapter: compileProviderAdapterInstallation({
                        adapterId: OPENAI_RESPONSES_ADAPTER_ID,
                        providerId: 'openai',
                        modelId: model,
                        protocolFamily: 'openai-responses',
                        origin: 'https://api.openai.com',
                    }),
                    session_id: `provider-session-${'0'.repeat(32)}`,
                },
                systemPrompt: 'system',
                userMessage: 'make the kick punchier',
                toolSchemas: productionToolSchemas(),
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
            });

            expect(readSentTools(sentBody)).toEqual(
                expect.arrayContaining(wireNamesOf([...MANDATORY_PLANNING_TOOL_NAMES]))
            );
        });

        it('sends every mandatory tool in an OpenAI-compatible request body', async () => {
            let sentBody = '';
            mocks.requestHostedOpenAiProvider.mockImplementation(
                async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
                    sentBody = request.body;
                    request.onBodyChunk(
                        new TextEncoder().encode(
                            JSON.stringify({ choices: [{ finish_reason: 'stop', message: { tool_calls: [] } }] })
                        )
                    );
                    return { status: 200, contentType: 'application/json' };
                }
            );

            await generateOpenAiCompatibleToolCalls({
                runtime: {
                    provider: 'openai-compatible',
                    authentication: 'none',
                    session_id: null,
                    model: 'compatible-model',
                    base_url: 'http://localhost:1234/v1',
                    strict_tool_schemas: false,
                },
                systemPrompt: 'system',
                userMessage: 'make the kick punchier',
                toolSchemas: productionToolSchemas(),
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
            });

            expect(readSentTools(sentBody)).toEqual(
                expect.arrayContaining(wireNamesOf([...MANDATORY_PLANNING_TOOL_NAMES]))
            );
        });
    });

    describe('WebLLM', () => {
        async function advertisedToWebLlm(prompt: string): Promise<string[]> {
            mocks.backendChain.value = ['webllm'];
            mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });
            await generateToolPlanningOutcome('system', prompt, productionToolSchemas());
            return namesOf((mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? []) as ToolSchema[]);
        }

        it.each([
            'add an eq device to the vocals',
            'the bass is muddy, clean it up',
            'compile a transform for each selected MIDI clip',
            'show the command history',
        ])('advertises every mandatory tool within the budget for "%s"', async (prompt) => {
            const advertised = await advertisedToWebLlm(prompt);

            expectAllMandatory(advertised);
            expect(advertised.length).toBeLessThanOrEqual(WEBLLM_TOOL_BUDGET);
        });

        it('keeps at least one prompt-selected slot beside the mandatory set', async () => {
            const advertised = await advertisedToWebLlm('add an eq device to the vocals');
            const mandatory = new Set<string>([
                WORKFLOW_CAPABILITY_TOOL_NAME,
                ...MANDATORY_PLANNING_TOOL_NAMES,
                AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                AGENT_CATALOG_DISCOVERY_TOOL_NAME,
                CREATIVE_INTERPRETATION_TOOL_NAME,
                ...WORKFLOW_ACTION_TOOL_NAMES,
            ]);

            expect(WEBLLM_TOOL_BUDGET - mandatory.size).toBeGreaterThanOrEqual(1);
            expect(advertised.filter((name) => !mandatory.has(name)).length).toBeGreaterThanOrEqual(1);
            expect(advertised).toHaveLength(WEBLLM_TOOL_BUDGET);
        });

        it('does not advertise analysis.compareReference with a reference loaded', async () => {
            agentReferenceStore.set({
                reference: {
                    referenceId: 'reference-test',
                    name: 'reference.wav',
                    contentAddress: 'content-address',
                    measurements: {},
                    sampleRate: 48_000,
                    frameCount: 48_000,
                    channelCount: 2,
                    durationSeconds: 1,
                },
                loadEpoch: 1,
            });

            const advertised = await advertisedToWebLlm('compare my mix to the reference track I loaded');

            expect(advertised).not.toContain(ANALYSIS_COMPARE_REFERENCE_TOOL_NAME);
            expectAllMandatory(advertised);
        });
    });

    describe('a delta turn', () => {
        const catalogueRequest = {
            id: 'catalogue-call',
            name: AGENT_DEVICE_MANIFEST_TOOL_NAME,
            arguments: {},
        };

        async function runManifestCall(call: { id: string; name: string; arguments: Record<string, unknown> }) {
            const result = await runApplicationOwnedToolLoop({
                loopId: `loop-${call.id}`,
                terminalToolNames: new Set(['setTempo']),
                requestTurn: vi
                    .fn()
                    .mockResolvedValueOnce({ status: 'complete', toolCalls: [call] })
                    .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
            });
            const receipt = result.receipts.find((entry) => entry.callId === call.id);
            if (!receipt) {
                throw new Error(`Missing receipt for ${call.id}`);
            }
            return receipt;
        }

        it('drops the device catalogue from the context and returns it, live, on a manifest call without types', async () => {
            const context = getProjectContext();
            const full = buildAgentContext({
                fixedPolicy: 'policy',
                prompt: 'adjust',
                context,
                projectRevision: 'revision-1',
            });
            const delta = buildAgentContext({
                fixedPolicy: 'policy',
                prompt: 'adjust',
                context: { ...context, tempo: context.tempo + 1 },
                projectRevision: 'revision-2',
                priorEvidence: full.evidence,
            });
            expect(full.evidence.delta.mode).toBe('full');
            expect(full.message).toContain('availableDeviceTypes');
            expect(delta.evidence.delta.mode).toBe('delta');
            expect(delta.message).not.toContain('availableDeviceTypes');

            const receipt = await runManifestCall(catalogueRequest);

            const expected = getPlatformPlugins().map((plugin) => ({ id: plugin.id, name: plugin.name }));
            expect(expected.length).toBeGreaterThan(0);
            expect(receipt).toMatchObject({ status: 'success', toolName: AGENT_DEVICE_MANIFEST_TOOL_NAME });
            expect(receipt.data).toEqual({
                schema: 'sourdaw.agent-device-catalogue',
                schemaVersion: 1,
                availableDeviceTypes: expected,
            });
            expect(context.availableDeviceTypes?.map((device) => device.id)).toEqual(
                expected.map((device) => device.id)
            );
        });

        it('keeps the catalogue receipt, built from the real builtin catalogue, under the per-call receipt budget', async () => {
            const receipt = await runManifestCall(catalogueRequest);

            expect(receipt.status).toBe('success');
            expect(byteLength(receipt)).toBeLessThan(MAX_RECEIPT_BYTES_PER_CALL);
        });

        it('reads a call with types exactly as before', async () => {
            const receipt = await runManifestCall({
                id: 'typed-call',
                name: AGENT_DEVICE_MANIFEST_TOOL_NAME,
                arguments: { types: ['builtin-eq'] },
            });

            expect(receipt.status).toBe('success');
            expect(receipt.data).toMatchObject({
                schema: 'sourdaw.agent-device-factory-manifest',
                schemaVersion: 1,
                devices: [expect.objectContaining({ type: 'builtin-eq' })],
            });
            expect(receipt.data).not.toHaveProperty('availableDeviceTypes');
        });

        it.each([
            { label: 'a page without types', arguments: { page: {} } },
            { label: 'an empty type set', arguments: { types: [] } },
            { label: 'an unknown argument', arguments: { kind: 'catalogue' } },
        ])('still refuses $label', async ({ arguments: callArguments }) => {
            const receipt = await runManifestCall({
                id: 'refused-call',
                name: AGENT_DEVICE_MANIFEST_TOOL_NAME,
                arguments: callArguments,
            });

            expect(receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
        });
    });

    describe('without a project revision', () => {
        it.each([
            {
                tool: ANALYSIS_MEASURE_TOOL_NAME,
                arguments: { scope: { kind: 'master' }, range: { startBeat: 0, endBeat: 4 } },
            },
            { tool: TRANSFORM_COMPILE_TOOL_NAME, arguments: { document: '{}' } },
            { tool: RECIPE_EXPANSION_TOOL_NAME, arguments: { recipeId: 'recipe', targetId: 'track-1' } },
        ])(
            'reports $tool as an unavailable application tool, never a crash',
            async ({ tool, arguments: callArguments }) => {
                const result = await runApplicationOwnedToolLoop({
                    loopId: `loop-no-revision-${tool}`,
                    terminalToolNames: new Set([COMMAND_BATCH_PROPOSAL_TOOL_NAME, COMMAND_BATCH_DECLINE_TOOL_NAME]),
                    requestTurn: vi.fn().mockResolvedValueOnce({
                        status: 'complete',
                        toolCalls: [{ id: 'unwired-call', name: tool, arguments: callArguments }],
                    }),
                });

                expect(result).toMatchObject({ status: 'rejected', reason: NO_REVISION_REJECTION });
            }
        );
    });
});
