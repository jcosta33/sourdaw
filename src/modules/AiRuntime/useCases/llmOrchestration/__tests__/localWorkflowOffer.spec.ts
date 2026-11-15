import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { type BassProcessingCopyCapability } from '../../../models/BassProcessingCopyCapability';
import { type ProjectContext } from '../../../models/ProjectContext';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import {
    WORKFLOW_ACTION_TOOL_NAMES,
    WORKFLOW_CAPABILITY_IDS,
    WORKFLOW_CAPABILITY_TOOL_NAME,
} from '../../../models/WorkflowCapability';
import { AUTO_TOOL_CHOICE } from '../../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import { buildPlanningSystemPrompt } from '../../../transformers/buildPlanningSystemPrompt';
import { type LlmActionCapabilityData } from '../../../transformers/llmActionBridge';
import { createPlanningProject } from '../../__tests__/planningProjectFixture';
import { runApplicationOwnedToolLoop } from '../../applicationOwnedToolLoop';
import { buildAgentContext } from '../../buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../../createPlanningInterpretationToolSchema';
import { getPlanningProviderToolSchemas } from '../../getPlanningProviderToolSchemas';
import { getProjectContext } from '../../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../../prepareCreativeInterpretationCatalog';
import { projectPlanningProviderToolSchemas } from '../../projectPlanningProviderToolSchemas';
import { generateToolPlanningOutcome, WEBLLM_TOOL_BUDGET } from '../inference';

registerDeviceEnginePorts();

const mocks = vi.hoisted(() => ({
    backendChain: { value: ['webllm'] as ('cloud' | 'webllm')[] },
    completion: vi.fn(),
    toolCalls: vi.fn(),
    cloudToolCalls: vi.fn(),
}));
vi.mock('../backendResolution/getBackendChain', () => ({ getBackendChain: () => mocks.backendChain.value }));
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.completion,
}));
vi.mock('../../../repositories/webLlm/toolCalling', () => ({ generateWebLlmToolCalls: mocks.toolCalls }));
vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: mocks.cloudToolCalls,
}));
vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'openai-compatible', model: 'hosted-model' }),
}));
vi.mock('../../../repositories/cloudLlm/usesStrictCloudToolSchemas', () => ({
    usesStrictCloudToolSchemas: () => false,
}));

const REVISION = 'revision-1';
const NOT_ADVERTISED = 'Provider requested a tool that was not advertised for this request.';

function bassProcessingCopyCapability(project: ProjectContext): BassProcessingCopyCapability {
    const bass = project.tracks[1]!;
    return {
        schemaVersion: 1,
        baseRevision: REVISION,
        actionType: 'addAdjustmentRegion',
        sourceSection: { id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16 },
        targetSection: { id: 'section-chorus', name: 'Chorus', startBeat: 16, endBeat: 32 },
        bassTracks: [{ id: bass.id, name: bass.name }],
        sourceProcessing: [],
        exactPlan: [],
        protectedAutomationLanes: [],
        protectedObjectIds: [],
        constraints: {
            preserveSourceProcessing: true,
            preserveTargetDistortionAutomation: true,
            requireFreshConfirmation: true,
        },
    };
}

type Turn = {
    prompt: string;
    reply?: unknown[];
    capabilityData?: (project: ProjectContext) => LlmActionCapabilityData;
};

/** One production-shaped planning turn: its context, tools and local message, as parsePromptToActions builds them. */
function planningTurn({ prompt, capabilityData }: Turn) {
    const context = createPlanningProject(getProjectContext(), 5);
    const system = buildPlanningSystemPrompt(undefined, 'planning');
    const built = buildAgentContext({
        fixedPolicy: system,
        prompt,
        context,
        projectRevision: REVISION,
        capabilityData: capabilityData?.(context),
    });
    const creative = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: REVISION });
    const tools = projectPlanningProviderToolSchemas(
        [
            ...getPlanningProviderToolSchemas(),
            createPlanningInterpretationToolSchema({ creative, answer, binding: built.planningBinding }),
        ],
        'planning'
    );
    return { context, system, built, creative, tools };
}

async function sendLocalTurn(turn: Turn) {
    const planned = planningTurn(turn);
    mocks.completion.mockResolvedValue(JSON.stringify(turn.reply ?? []));
    const outcome = await generateToolPlanningOutcome(
        planned.system,
        planned.built.message,
        planned.tools,
        undefined,
        turn.prompt,
        undefined,
        undefined,
        undefined,
        AUTO_TOOL_CHOICE,
        { firstUserMessage: planned.built.message, history: [], budgetNote: '', answersSchemaInvalidCalls: true },
        planned.built.localMessage,
        { keptCapabilityIds: planned.built.localWorkflowCapabilityIds }
    );
    const advertised = (mocks.toolCalls.mock.calls[0]?.[2] ?? []) as ToolSchema[];
    return { ...planned, outcome, advertised, names: advertised.map((tool) => tool.function.name) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The workflow ids the selector among `tools` lets a reply name. */
function selectableWorkflows(tools: readonly ToolSchema[]): unknown[] {
    const selector = tools.find((tool) => tool.function.name === WORKFLOW_CAPABILITY_TOOL_NAME);
    const capabilityId = selector?.function.parameters.properties.capabilityId;
    if (!isRecord(capabilityId) || !Array.isArray(capabilityId.oneOf)) {
        return [];
    }
    return capabilityId.oneOf.map((choice: unknown) => (isRecord(choice) ? choice.const : undefined));
}

function expectAdmittedCalls(outcome: Awaited<ReturnType<typeof sendLocalTurn>>['outcome'], names: string[]) {
    if (outcome.status !== 'complete') {
        throw new Error(`Expected the local turn to complete, got ${JSON.stringify(outcome)}`);
    }
    expect(outcome.toolCalls.map((call) => call.name)).toEqual(names);
    for (const call of outcome.toolCalls) {
        expect(call.argumentSchemaViolation, `${call.name} fills its schema`).toBeUndefined();
    }
}

describe('local workflow offer', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.backendChain.value = ['webllm'];
        const actual = await vi.importActual<typeof import('../../../repositories/webLlm/toolCalling')>(
            '../../../repositories/webLlm/toolCalling'
        );
        mocks.toolCalls.mockImplementation(actual.generateWebLlmToolCalls);
    });

    describe('a request no workflow capability grounds', () => {
        it('offers only the stem import kickoff and no workflow action tool', async () => {
            const { names, advertised } = await sendLocalTurn({ prompt: 'list the tracks' });

            expect(selectableWorkflows(advertised)).toEqual(['stem-import-starting-mix']);
            expect(names.filter((name) => WORKFLOW_ACTION_TOOL_NAMES.has(name))).toEqual([]);
        });

        it.each([
            {
                label: 'a literal edit through a proposal list',
                prompt: 'mute the bass',
                reply: (context: ProjectContext) => [
                    {
                        id: 'propose',
                        name: 'command.batch.propose',
                        arguments: {
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'mute-bass',
                                        name: 'muteTrack',
                                        arguments: { trackId: context.tracks[1]!.id, muted: true },
                                    },
                                ],
                            },
                        },
                    },
                ],
                names: ['command.batch.propose'],
            },
            {
                label: 'a mix outcome through measurement and recipes',
                prompt: 'the bass is muddy, clean it up',
                reply: (context: ProjectContext) => [
                    {
                        id: 'measure',
                        name: 'analysis.measure',
                        arguments: {
                            scope: { kind: 'tracks', ids: [context.tracks[1]!.id] },
                            range: { startBeat: 0, endBeat: 16 },
                            metrics: ['spectralCentroid'],
                        },
                    },
                    {
                        id: 'discover',
                        name: 'recipe.discover',
                        arguments: { descriptors: ['muddy'], role: 'bass' },
                    },
                ],
                names: ['analysis.measure', 'recipe.discover'],
            },
            {
                label: 'an information request',
                prompt: 'how many tracks are there?',
                reply: () => [{ id: 'answer', name: 'answer.respond', arguments: {} }],
                names: ['answer.respond'],
            },
        ])('offers and admits $label', async ({ prompt, reply, names }) => {
            const context = createPlanningProject(getProjectContext(), 5);
            const sent = await sendLocalTurn({ prompt, reply: reply(context) });

            for (const name of names) {
                expect(sent.names).toContain(name);
            }
            expectAdmittedCalls(sent.outcome, names);
        });

        it('offers and admits a creative interpretation', async () => {
            const prompt = 'make the chorus feel bigger';
            const { creative } = planningTurn({ prompt });
            const sent = await sendLocalTurn({
                prompt,
                reply: [
                    {
                        id: 'interpret',
                        name: 'selectCreativeInterpretation',
                        arguments: {
                            catalogId: creative.catalogId,
                            modeId: 'create',
                            targetCandidateIds: [],
                            editDimensionCandidateIds: [],
                            constraintCandidateIds: [],
                            creationSlotIds: [],
                            uncertainty: 'none',
                        },
                    },
                ],
            });

            expect(sent.names).toContain('selectCreativeInterpretation');
            expectAdmittedCalls(sent.outcome, ['selectCreativeInterpretation']);
        });

        // Red when an ungroundable workflow stays selectable: the reply would be admitted and the
        // workflow planned with no capability data to ground it.
        it('answers a selection of a workflow the project cannot ground with a retryable receipt', async () => {
            const sent = await sendLocalTurn({
                prompt: 'route the drums to the drum bus',
                reply: [
                    { id: 'select', name: WORKFLOW_CAPABILITY_TOOL_NAME, arguments: { capabilityId: 'drum-routing' } },
                ],
            });
            if (sent.outcome.status !== 'complete') {
                throw new Error(`Expected the call to be admitted as data, got ${JSON.stringify(sent.outcome)}`);
            }
            expect(sent.outcome.toolCalls[0]?.argumentSchemaViolation).toBeDefined();

            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-local-ungroundable-workflow',
                terminalToolNames: new Set([WORKFLOW_CAPABILITY_TOOL_NAME]),
                requestTurn: vi
                    .fn()
                    .mockResolvedValueOnce(sent.outcome)
                    .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
            });

            expect(result.receipts.find((receipt) => receipt.callId === 'select')).toMatchObject({
                status: 'failure',
                error: { code: 'invalid-tool-arguments', retryable: true },
            });
        });

        // Red when the workflow action tools are offered without a groundable workflow.
        it('refuses a workflow action tool the turn did not offer, running nothing', async () => {
            const context = createPlanningProject(getProjectContext(), 5);
            const sent = await sendLocalTurn({
                prompt: 'list the tracks',
                reply: [
                    {
                        id: 'send',
                        name: 'addSend',
                        arguments: { trackId: context.tracks[1]!.id, busId: context.tracks[0]!.id },
                    },
                ],
            });

            expect(sent.names).not.toContain('addSend');
            expect(sent.outcome).toEqual({ status: 'rejected', reason: NOT_ADVERTISED });
        });
    });

    describe('a workflow-shaped project', () => {
        const prompt = 'copy the bass processing from the verse to the chorus';
        function capabilityData(project: ProjectContext): LlmActionCapabilityData {
            return { bassProcessingCopyCapability: bassProcessingCopyCapability(project) };
        }

        it('offers the grounded workflow and every workflow action tool, within the budget', async () => {
            const { names, advertised } = await sendLocalTurn({ prompt, capabilityData });

            expect(selectableWorkflows(advertised)).toEqual(['bass-processing-copy', 'stem-import-starting-mix']);
            expect(names.filter((name) => WORKFLOW_ACTION_TOOL_NAMES.has(name)).sort()).toEqual(
                [...WORKFLOW_ACTION_TOOL_NAMES].sort()
            );
            expect(names.length).toBeLessThanOrEqual(WEBLLM_TOOL_BUDGET);
        });

        it('admits a scripted selection of that workflow and its action plan', async () => {
            const context = createPlanningProject(getProjectContext(), 5);
            const sent = await sendLocalTurn({
                prompt,
                capabilityData,
                reply: [
                    {
                        id: 'select',
                        name: WORKFLOW_CAPABILITY_TOOL_NAME,
                        arguments: { capabilityId: 'bass-processing-copy' },
                    },
                    { id: 'mute', name: 'muteTrack', arguments: { trackId: context.tracks[1]!.id, muted: false } },
                ],
            });

            expectAdmittedCalls(sent.outcome, [WORKFLOW_CAPABILITY_TOOL_NAME, 'muteTrack']);
        });
    });

    // Red when the hosted request is narrowed or compacted the way a local one is.
    it('sends the hosted provider every tool unchanged for the same request', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.cloudToolCalls.mockResolvedValue({ calls: [], strictToolSchemas: false, assistantItems: [] });
        const planned = planningTurn({ prompt: 'list the tracks' });

        await generateToolPlanningOutcome(
            planned.system,
            planned.built.message,
            planned.tools,
            undefined,
            'list the tracks',
            undefined,
            undefined,
            undefined,
            AUTO_TOOL_CHOICE,
            undefined,
            planned.built.localMessage,
            { keptCapabilityIds: planned.built.localWorkflowCapabilityIds }
        );

        const hostedCall: unknown[] = mocks.cloudToolCalls.mock.calls[0] ?? [];
        const [systemPrompt, userMessage, sentTools] = hostedCall;
        expect(systemPrompt).toBe(planned.system);
        expect(userMessage).toBe(planned.built.message);
        expect(sentTools).toEqual(planned.tools);
        expect(selectableWorkflows(planned.tools)).toEqual(
            WORKFLOW_CAPABILITY_IDS.filter((capabilityId) => capabilityId !== 'sidechain-routing')
        );
        expect(JSON.stringify(sentTools)).not.toContain('"$ref"');
    });
});
