import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlatformPlugins } from '#/modules/Arrangement/useCases';

import {
    CREATIVE_INTERPRETATION_TOOL_NAME,
    createCreativeInterpretationToolSchema,
    type CreativeInterpretationCatalog,
} from '../../../models/CreativeInterpretation';
import {
    LOCAL_CONTEXT_WINDOW_EXCEEDED_FAILURE_CODE,
    LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
} from '../../../models/LocalPlanningBudget';
import { DEFAULT_WEBLLM_MODEL_ID } from '../../../models/ModelInfo';
import { type ModelProviderResult } from '../../../models/ModelProviderProtocol';
import { type ProjectContext } from '../../../models/ProjectContext';
import { THREAD_CONTEXT_MAX_BYTES, type ThreadContext } from '../../../models/ThreadContext';
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
import { engineState } from '../../../repositories/webLlm/engineLifecycleState';
import { getWebLlmContextWindowSize } from '../../../repositories/webLlm/getWebLlmContextWindowSize';
import { initWebLlmEngine } from '../../../repositories/webLlm/initWebLlmEngine';
import { agentReferenceStore } from '../../../stores/agentReferenceStore';
import { readAgentResourceLimits } from '../../../stores/agentResourceLimitsStore';
import { buildPlanningSystemPrompt } from '../../../transformers/buildPlanningSystemPrompt';
import { estimateConservativePromptTokens } from '../../../transformers/estimateConservativePromptTokens';
import { describeLocalContextWindowShortfall } from '../../../transformers/localContextWindowRefusal';
import { createPlanningProject } from '../../__tests__/planningProjectFixture';
import { createFullThreadContext, threadRequest } from '../../__tests__/threadContextFixture';
import {
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    MANDATORY_PLANNING_TOOL_NAMES,
    PROJECT_DISCOVERY_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../../applicationOwnedToolLoop';
import { buildAgentContext } from '../../buildAgentContext';
import { getPlanningProviderToolSchemas } from '../../getPlanningProviderToolSchemas';
import { getProjectContext } from '../../getProjectContext';
import { prepareCreativeInterpretationCatalog } from '../../prepareCreativeInterpretationCatalog';
import { generateToolPlanningOutcome, WEBLLM_TOOL_BUDGET } from '../inference';

const mocks = vi.hoisted(() => ({
    backendChain: { value: [] as ('cloud' | 'webllm')[] },
    generateCloudToolCalls: vi.fn(),
    generateWebLlmCompletion: vi.fn(),
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
vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
}));
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
function productionToolSchemas(catalog: CreativeInterpretationCatalog = creativeCatalog): ToolSchema[] {
    return [...getPlanningProviderToolSchemas(), createCreativeInterpretationToolSchema(catalog)];
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

    it('names exactly the nine planning tools every backend must advertise', () => {
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
                'answer.respond',
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
        async function advertisedToWebLlm(
            prompt: string,
            catalog: CreativeInterpretationCatalog = creativeCatalog
        ): Promise<string[]> {
            mocks.backendChain.value = ['webllm'];
            mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });
            await generateToolPlanningOutcome('system', prompt, productionToolSchemas(catalog));
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

        it('sizes the budget at the mandatory set plus exactly one prompt-selected slot', async () => {
            const advertised = await advertisedToWebLlm('add an eq device to the vocals');
            const mandatory = new Set<string>([
                WORKFLOW_CAPABILITY_TOOL_NAME,
                ...MANDATORY_PLANNING_TOOL_NAMES,
                AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                AGENT_CATALOG_DISCOVERY_TOOL_NAME,
                CREATIVE_INTERPRETATION_TOOL_NAME,
                ...WORKFLOW_ACTION_TOOL_NAMES,
            ]);

            expect(WEBLLM_TOOL_BUDGET).toBe(mandatory.size + 1);
            expect(advertised.filter((name) => !mandatory.has(name))).toHaveLength(1);
            expect(advertised).toHaveLength(WEBLLM_TOOL_BUDGET);
        });

        it('does not advertise analysis.compareReference with a reference loaded, even ahead of the free slot', async () => {
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
            const loaded = productionToolSchemas();
            const comparison = loaded.find((tool) => tool.function.name === ANALYSIS_COMPARE_REFERENCE_TOOL_NAME);
            if (comparison === undefined) {
                throw new Error('A loaded reference must offer analysis.compareReference to hosted backends.');
            }
            // Ahead of every other optional tool, it would take the one prompt-selected slot unless
            // the WebLLM narrowing excludes it by name.
            const comparisonFirst = [
                comparison,
                ...loaded.filter((tool) => tool.function.name !== ANALYSIS_COMPARE_REFERENCE_TOOL_NAME),
            ];
            mocks.backendChain.value = ['webllm'];
            mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });

            await generateToolPlanningOutcome('system', 'compare my mix to the reference track', comparisonFirst);

            const advertised = namesOf((mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? []) as ToolSchema[]);
            expect(advertised).not.toContain(ANALYSIS_COMPARE_REFERENCE_TOOL_NAME);
            expect(advertised).toContain(PROJECT_DISCOVERY_TOOL_NAME);
            expectAllMandatory(advertised);
        });

        describe('the whole local request', () => {
            const REQUEST = 'make the chorus wider and tame the harshness on the lead vocal';
            const RECEIPT_EVIDENCE_CHARACTERS = 8_192;

            // What a receipt turn carries at the evidence budget's ceiling: the loop's receipt header
            // and receipt JSON, which the context escapes again as a JSON string.
            function receiptEvidence(): string {
                const receipt = {
                    callId: 'call-1',
                    toolName: PROJECT_DISCOVERY_TOOL_NAME,
                    status: 'success',
                    data: { trackId: 'track-3', name: 'Lead Vocal', gainDb: -6.2, devices: ['builtin-eq'] },
                };
                const receipts = JSON.stringify({ receipts: Array.from({ length: 64 }, () => receipt) });
                return `Application-owned tool receipts from turn 1 follow as JSON.\n${receipts}`.slice(
                    0,
                    RECEIPT_EVIDENCE_CHARACTERS
                );
            }

            async function sendLocalRequest(context: ProjectContext, receiptSummary?: string, thread?: ThreadContext) {
                const catalog = prepareCreativeInterpretationCatalog({
                    prompt: REQUEST,
                    context,
                    projectRevision: 'revision-1',
                });
                const tools = productionToolSchemas(catalog);
                const systemPrompt = buildPlanningSystemPrompt();
                const built = buildAgentContext({
                    fixedPolicy: systemPrompt,
                    prompt: REQUEST,
                    context,
                    projectRevision: 'revision-1',
                    receipts:
                        receiptSummary === undefined ? [] : [{ id: 'application-tool-loop', summary: receiptSummary }],
                    capabilitySchemas: tools.map((tool) => ({ name: tool.function.name, schemaVersion: 1 })),
                    capabilityData: { creativeInterpretationCatalog: catalog },
                    thread,
                });
                const { generateWebLlmToolCalls } = await vi.importActual<
                    typeof import('../../../repositories/webLlm/toolCalling')
                >('../../../repositories/webLlm/toolCalling');
                mocks.backendChain.value = ['webllm'];
                mocks.generateWebLlmToolCalls.mockImplementation(generateWebLlmToolCalls);
                const providerResults: ModelProviderResult[] = [];
                const outcome = await generateToolPlanningOutcome(
                    systemPrompt,
                    built.message,
                    tools,
                    undefined,
                    REQUEST,
                    (result) => providerResults.push(result),
                    undefined,
                    undefined,
                    AUTO_TOOL_CHOICE,
                    undefined,
                    built.localMessage
                );
                return { built, outcome, providerResults, sent: mocks.generateWebLlmCompletion.mock.calls[0] };
            }

            function emptyProject(): ProjectContext {
                return getProjectContext();
            }

            function fiveTrackProject(): ProjectContext {
                return createPlanningProject(getProjectContext(), 5);
            }

            // Each row is the whole request the engine receives, measured the way the budget measures
            // it. Growth in the planning prompt, a tool description or the local message that pushes a
            // realistic row past the window is answered by compaction or a larger window, not by
            // dropping the row.
            it.each([
                { label: 'an empty project, first turn', project: emptyProject, receipts: undefined },
                { label: 'an empty project, receipt turn', project: emptyProject, receipts: receiptEvidence },
                { label: 'a five-track project, first turn', project: fiveTrackProject, receipts: undefined },
                { label: 'a five-track project, receipt turn', project: fiveTrackProject, receipts: receiptEvidence },
            ])('fits $label in the local window with the reply reserve', async ({ project, receipts }) => {
                mocks.generateWebLlmCompletion.mockResolvedValue('[]');

                const { built, outcome, sent } = await sendLocalRequest(project(), receipts?.());

                expect(outcome).toMatchObject({ status: 'complete' });
                const [systemText, userText, options] = sent ?? [];
                if (typeof systemText !== 'string' || typeof userText !== 'string') {
                    throw new TypeError('Expected the local request to reach the engine.');
                }
                expect(userText).toBe(built.localMessage);
                const window = getWebLlmContextWindowSize();
                const promptTokens =
                    estimateConservativePromptTokens(systemText) +
                    estimateConservativePromptTokens(userText) +
                    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS;
                expect(promptTokens + LOCAL_PLANNING_REPLY_RESERVE_TOKENS).toBeLessThanOrEqual(window);
                expect(options).toMatchObject({
                    maxTokens: Math.min(readAgentResourceLimits().maxModelOutputTokens, window - promptTokens),
                    enableThinking: false,
                    estimatedPromptTokens: promptTokens,
                });
            });

            it('fits a five-track receipt turn carrying a full thread context, its oldest requests dropped', async () => {
                mocks.generateWebLlmCompletion.mockResolvedValue('[]');
                const thread = createFullThreadContext();

                const { built, outcome, sent } = await sendLocalRequest(fiveTrackProject(), receiptEvidence(), thread);

                expect(outcome).toMatchObject({ status: 'complete' });
                const [systemText, userText] = sent ?? [];
                if (typeof systemText !== 'string' || typeof userText !== 'string') {
                    throw new TypeError('Expected the local request to reach the engine.');
                }
                expect(userText).toBe(built.localMessage);
                expect(userText).toContain('thread_context:');
                const promptTokens =
                    estimateConservativePromptTokens(systemText) +
                    estimateConservativePromptTokens(userText) +
                    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS;
                expect(promptTokens + LOCAL_PLANNING_REPLY_RESERVE_TOKENS).toBeLessThanOrEqual(
                    getWebLlmContextWindowSize()
                );
                // The budget never charges more than a token a byte, so the request still fits with
                // the section at its cap at that rate, however identifier-dense the thread is.
                const local = built.evidence.included.thread?.local;
                const section = `\n\nthread_context:\n${userText.split('\n\nthread_context:\n')[1]?.split('\n\n')[0] ?? ''}`;
                const promptTokensWithoutThread =
                    estimateConservativePromptTokens(systemText) +
                    estimateConservativePromptTokens(userText.replace(section, '')) +
                    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS;
                expect(
                    promptTokensWithoutThread + THREAD_CONTEXT_MAX_BYTES.local + LOCAL_PLANNING_REPLY_RESERVE_TOKENS
                ).toBeLessThanOrEqual(getWebLlmContextWindowSize());
                expect(local?.omittedRequestCount).toBeGreaterThan(0);
                expect(local?.pendingCommandCount).toBeGreaterThan(0);
                expect(userText).toContain(threadRequest(thread.requests.length));
                expect(userText).not.toContain(threadRequest(1));
            });

            it('refuses a 64-track project with the typed code, before the engine loads or runs', async () => {
                mocks.isWebLlmLoaded.mockReturnValue(false);

                const { outcome, providerResults } = await sendLocalRequest(
                    createPlanningProject(getProjectContext(), 64)
                );

                expect(mocks.generateWebLlmCompletion).not.toHaveBeenCalled();
                expect(initWebLlmEngine).not.toHaveBeenCalled();
                if (outcome.status !== 'rejected') {
                    throw new Error('Expected the over-budget request to be refused.');
                }
                const figures = /needs about ([\d,]+) tokens.*the window holds ([\d,]+)\./.exec(outcome.reason);
                const needed = Number(figures?.[1]?.replaceAll(',', ''));
                const available = Number(figures?.[2]?.replaceAll(',', ''));
                expect(available).toBe(getWebLlmContextWindowSize());
                expect(needed).toBeGreaterThan(available);
                expect(outcome.reason).toContain('Use a hosted model');
                expect(providerResults).toHaveLength(1);
                expect(providerResults[0]?.failure).toMatchObject({
                    code: LOCAL_CONTEXT_WINDOW_EXCEEDED_FAILURE_CODE,
                    retryable: false,
                    safeMessage: outcome.reason,
                });
            });

            it.each(['Qwen3-1.7B-q4f16_1-MLC', 'Qwen3-8B-q4f16_1-MLC'])(
                'refuses a five-track request on %s and points at the local model whose window holds it',
                async (modelId) => {
                    engineState.activeModelId = modelId;
                    try {
                        const { outcome, providerResults } = await sendLocalRequest(fiveTrackProject());

                        expect(mocks.generateWebLlmCompletion).not.toHaveBeenCalled();
                        expect(outcome).toMatchObject({
                            status: 'rejected',
                            reason: expect.stringContaining(
                                `the window holds ${getWebLlmContextWindowSize(modelId).toLocaleString('en-US')}. Switch to the Standard local model, whose window holds it, or use a hosted model.`
                            ),
                        });
                        expect(providerResults[0]?.failure?.code).toBe(LOCAL_CONTEXT_WINDOW_EXCEEDED_FAILURE_CODE);
                    } finally {
                        engineState.activeModelId = DEFAULT_WEBLLM_MODEL_ID;
                    }
                }
            );

            it("refuses the request the same way when the engine's own count overflows the window", async () => {
                mocks.generateWebLlmCompletion.mockRejectedValue(
                    new Error(
                        'Prompt tokens exceed context window size: number of prompt tokens: 33000; context window size: 32768\nConsider shortening the prompt, or increase `context_window_size`, or using sliding window via `sliding_window_size`.'
                    )
                );

                const { outcome, providerResults } = await sendLocalRequest(fiveTrackProject());

                const reason = describeLocalContextWindowShortfall({
                    neededTokens: 33_000 + LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
                    windowTokens: 32_768,
                });
                expect(outcome).toEqual({ status: 'rejected', reason });
                expect(providerResults).toHaveLength(1);
                expect(providerResults[0]?.failure).toMatchObject({
                    code: LOCAL_CONTEXT_WINDOW_EXCEEDED_FAILURE_CODE,
                    safeMessage: reason,
                });
            });
        });

        describe('system prompt', () => {
            // The creative interpretation tool is built from the catalogue the request and the project
            // produce, as parsePromptToActions builds it, so its size is the production size.
            async function serializeWebLlmPrompt(prompt: string): Promise<{ advertised: ToolSchema[]; text: string }> {
                const catalog = prepareCreativeInterpretationCatalog({
                    prompt,
                    context: getProjectContext(),
                    projectRevision: 'revision-1',
                });
                const advertisedNames = await advertisedToWebLlm(prompt, catalog);
                const advertised = (mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? []) as ToolSchema[];
                expect(advertised).toHaveLength(advertisedNames.length);
                const { generateWebLlmToolCalls } = await vi.importActual<
                    typeof import('../../../repositories/webLlm/toolCalling')
                >('../../../repositories/webLlm/toolCalling');
                mocks.generateWebLlmCompletion.mockResolvedValue('[]');
                await generateWebLlmToolCalls(buildPlanningSystemPrompt(), prompt, advertised, 1024);
                const text = mocks.generateWebLlmCompletion.mock.calls[0]?.[0];
                if (typeof text !== 'string') {
                    throw new TypeError('Expected the WebLLM system prompt to be serialized.');
                }
                return { advertised, text };
            }

            it.each(['add an eq device to the vocals', 'the bass is muddy, clean it up'])(
                'spells every mandatory tool in the WebLLM system prompt for "%s"',
                async (prompt) => {
                    const { advertised, text } = await serializeWebLlmPrompt(prompt);

                    expect(advertised.length).toBeGreaterThanOrEqual(MANDATORY_PLANNING_TOOL_NAMES.length);
                    for (const name of MANDATORY_PLANNING_TOOL_NAMES) {
                        expect(text, `${name} must stay in the prompt`).toContain(`- ${name}:`);
                    }
                }
            );

            // Red when any tool description is shortened or dropped from the prompt: a description holds
            // the units, ranges and "alone" or "exactly one of" rules the schema cannot state, and a
            // handler that admits a value outside them edits the project with no receipt.
            it('spells every advertised tool with its whole description', async () => {
                const { advertised, text } = await serializeWebLlmPrompt('add an eq device to the vocals');

                expect(advertised.length).toBeGreaterThan(MANDATORY_PLANNING_TOOL_NAMES.length);
                for (const tool of advertised) {
                    expect(tool.function.description, `${tool.function.name} has a description`).toBeDefined();
                    expect(text, `${tool.function.name} keeps its whole description`).toContain(
                        `- ${tool.function.name}: ${tool.function.description} {`
                    );
                }
                expect(text).toContain('Return this call alone in its turn.');
            });

            it('sends the full schemas to the provider request that validates the reply', async () => {
                const { advertised } = await serializeWebLlmPrompt('add an eq device to the vocals');

                const proposal = advertised.find((tool) => tool.function.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME);
                expect(proposal?.function.parameters).toHaveProperty([
                    'properties',
                    'list',
                    'properties',
                    'items',
                    'maxItems',
                ]);
            });
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
