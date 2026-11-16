import { describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { BRIEF_COMPILE_TOOL_NAME } from '../../../models/AgentToolCatalogNames';
import { createCreativeInterpretationToolSchema } from '../../../models/CreativeInterpretation';
import {
    LOCAL_PLANNING_PROMPT_HEADROOM_FLOOR_TOKENS,
    LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
} from '../../../models/LocalPlanningBudget';
import { THREAD_CONTEXT_MAX_BYTES } from '../../../models/ThreadContext';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { getWebLlmContextWindowSize } from '../../../repositories/webLlm/getWebLlmContextWindowSize';
import { buildPlanningSystemPrompt } from '../../../transformers/buildPlanningSystemPrompt';
import { estimateConservativePromptTokens } from '../../../transformers/estimateConservativePromptTokens';
import { createPlanningProject, fixtureUuid } from '../../__tests__/planningProjectFixture';
import { createFullThreadContext } from '../../__tests__/threadContextFixture';
import { buildAgentContext } from '../../buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../../createPlanningInterpretationToolSchema';
import { getPlanningProviderToolSchemas } from '../../getPlanningProviderToolSchemas';
import { getProjectContext } from '../../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../../prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../../prepareMetricIntentCatalog';
import { preparePlanningMetricIntentCatalog } from '../../preparePlanningMetricIntentCatalog';
import { projectPlanningProviderToolSchemas } from '../../projectPlanningProviderToolSchemas';
import { generateToolPlanningOutcome, WEBLLM_TOOL_BUDGET } from '../inference';

registerDeviceEnginePorts();

const mocks = vi.hoisted(() => ({ completion: vi.fn(), toolCalls: vi.fn() }));
vi.mock('../backendResolution/getBackendChain', () => ({ getBackendChain: () => ['webllm'] }));
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.completion,
}));
vi.mock('../../../repositories/webLlm/toolCalling', () => ({ generateWebLlmToolCalls: mocks.toolCalls }));

type LocalPlanningTurn = { systemText: string; userText: string; tools: ToolSchema[]; groupId: string };

/**
 * Sends one local planning turn shaped as production sends it: the VCA and metronome project, a receipt
 * turn, a full thread, the brief compiler offered and the joint intake tool carrying the metric catalog
 * built from the request's own prompt and answer catalog.
 */
async function sendLocalPlanningTurn(prompt: string): Promise<LocalPlanningTurn> {
    mocks.completion.mockClear();
    mocks.toolCalls.mockClear();
    const base = createPlanningProject(getProjectContext(), 5);
    const groupId = `vca-${fixtureUuid('direct-level-window')}`;
    const context = {
        ...base,
        metronomeVolume: 0.5,
        vcaGroups: [{ id: groupId, name: 'Drums VCA', gain: 0.75, muted: false, trackIds: [base.tracks[0]!.id] }],
    };
    const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' });
    const advertised = projectPlanningProviderToolSchemas(
        [
            ...getPlanningProviderToolSchemas(undefined, { offersBrief: true }),
            createCreativeInterpretationToolSchema(catalog),
        ],
        'planning'
    );
    const system = buildPlanningSystemPrompt(undefined, 'planning');
    const receipt = {
        callId: 'call-1',
        toolName: 'project.query',
        status: 'success',
        data: { trackId: 'track-3', name: 'Lead Vocal', gainDb: -6.2, devices: ['builtin-eq'] },
    };
    const summary =
        `Application-owned tool receipts from turn 1 follow as JSON.\n${JSON.stringify({ receipts: Array.from({ length: 64 }, () => receipt) })}`.slice(
            0,
            8192
        );
    const built = buildAgentContext({
        fixedPolicy: system,
        prompt,
        context,
        projectRevision: 'revision-1',
        receipts: [{ id: 'application-tool-loop', summary }],
        capabilitySchemas: advertised.map((tool) => ({ name: tool.function.name, schemaVersion: 1 })),
        thread: createFullThreadContext(),
    });
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' });
    const tools = projectPlanningProviderToolSchemas(
        [
            ...getPlanningProviderToolSchemas(undefined, { offersBrief: true }),
            createPlanningInterpretationToolSchema({
                creative: catalog,
                answer,
                binding: built.planningBinding,
                metric: preparePlanningMetricIntentCatalog({ prompt, answer }),
            }),
        ],
        'planning'
    );
    const actual = await vi.importActual<typeof import('../../../repositories/webLlm/toolCalling')>(
        '../../../repositories/webLlm/toolCalling'
    );
    mocks.toolCalls.mockImplementation(actual.generateWebLlmToolCalls);
    mocks.completion.mockResolvedValue('[]');
    const outcome = await generateToolPlanningOutcome(
        system,
        built.message,
        tools,
        undefined,
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        built.localMessage,
        { keptCapabilityIds: built.localWorkflowCapabilityIds }
    );
    expect(outcome).toMatchObject({ status: 'complete' });
    const [systemText, userText] = mocks.completion.mock.calls[0] ?? [];
    if (typeof systemText !== 'string' || typeof userText !== 'string') {
        throw new TypeError('Expected the local request to reach the engine.');
    }
    expect(userText).toBe(built.localMessage);
    return { systemText, userText, tools: mocks.toolCalls.mock.calls[0]?.[2] ?? [], groupId };
}

/** What the budget charges for the turn, the thread section counted at its reserve rather than its text. */
function chargeLocalPlanningTurn({ systemText, userText }: LocalPlanningTurn): number {
    const section = `\n\nthread_context:\n${userText.split('\n\nthread_context:\n')[1]?.split('\n\n')[0] ?? ''}`;
    return (
        estimateConservativePromptTokens(systemText) +
        estimateConservativePromptTokens(userText.replace(section, '')) +
        LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS +
        THREAD_CONTEXT_MAX_BYTES.local +
        LOCAL_PLANNING_REPLY_RESERVE_TOKENS
    );
}

describe('direct level context window', () => {
    it('offers the VCA and metronome context, the brief compiler and no workflow action tool', async () => {
        const turn = await sendLocalPlanningTurn('make the chorus wider and tame the harshness on the lead vocal');
        // A local chat request offers the brief compiler. No workflow capability grounds this
        // request, so the offer is the selector (stem import only), the mandatory planning tools,
        // command-index search, catalog discovery, the joint interpretation tool, the brief compiler
        // and the one prompt-selected slot: no workflow action tool.
        expect(turn.tools).toHaveLength(15);
        expect(turn.tools.map((tool) => tool.function.name)).toContain(BRIEF_COMPILE_TOOL_NAME);
        expect(turn.tools.length).toBeLessThanOrEqual(WEBLLM_TOOL_BUDGET);
        expect(turn.userText).toContain(turn.groupId);
        expect(turn.userText).toContain('metronomeVolumeDb');
    });

    it.each([
        'make the chorus wider and tame the harshness on the lead vocal',
        'tame the harshness on the lead vocal',
        'make the vocal warmer',
        'make the lead vocal brighter than the snare',
    ])('leaves the headroom floor for %j with the metric catalog production sends', async (prompt) => {
        const cost = chargeLocalPlanningTurn(await sendLocalPlanningTurn(prompt));
        const windowTokens = getWebLlmContextWindowSize();
        expect(
            windowTokens - cost,
            `local planning prompt leaves ${String(windowTokens - cost)} tokens of headroom: cost ${String(cost)} in a ${String(windowTokens)}-token window, floor ${String(LOCAL_PLANNING_PROMPT_HEADROOM_FLOOR_TOKENS)}`
        ).toBeGreaterThanOrEqual(LOCAL_PLANNING_PROMPT_HEADROOM_FLOOR_TOKENS);
    });
});

/** Bounds the comparison objectives' share of the full metric catalog; the window cases above hold the floor. */
const COMPARISON_OBJECTIVES_MAX_EXTRA_TOKENS = 500;

/** The local planning prompt's cost for one request, built as production builds it, metric catalog included. */
async function measureMetricAwareLocalPromptCost(prompt: string): Promise<number> {
    mocks.completion.mockClear();
    mocks.toolCalls.mockClear();
    const base = createPlanningProject(getProjectContext(), 5);
    const context = { ...base, metronomeVolume: 0.5 };
    const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' });
    const advertised = projectPlanningProviderToolSchemas(
        [
            ...getPlanningProviderToolSchemas(undefined, { offersBrief: true }),
            createCreativeInterpretationToolSchema(catalog),
        ],
        'planning'
    );
    const system = buildPlanningSystemPrompt(undefined, 'planning');
    const built = buildAgentContext({
        fixedPolicy: system,
        prompt,
        context,
        projectRevision: 'revision-1',
        receipts: [],
        capabilitySchemas: advertised.map((tool) => ({ name: tool.function.name, schemaVersion: 1 })),
        thread: createFullThreadContext(),
    });
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' });
    const tools = projectPlanningProviderToolSchemas(
        [
            ...getPlanningProviderToolSchemas(undefined, { offersBrief: true }),
            createPlanningInterpretationToolSchema({
                creative: catalog,
                answer,
                binding: built.planningBinding,
                metric: prepareMetricIntentCatalog({ prompt, answer }),
            }),
        ],
        'planning'
    );
    const actual = await vi.importActual<typeof import('../../../repositories/webLlm/toolCalling')>(
        '../../../repositories/webLlm/toolCalling'
    );
    mocks.toolCalls.mockImplementation(actual.generateWebLlmToolCalls);
    mocks.completion.mockResolvedValue('[]');
    await generateToolPlanningOutcome(
        system,
        built.message,
        tools,
        undefined,
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        built.localMessage,
        { keptCapabilityIds: built.localWorkflowCapabilityIds }
    );
    const [systemText, userText] = mocks.completion.mock.calls[0] ?? [];
    if (typeof systemText !== 'string' || typeof userText !== 'string') {
        throw new TypeError('Expected the local request to reach the engine.');
    }
    const section = `\n\nthread_context:\n${userText.split('\n\nthread_context:\n')[1]?.split('\n\n')[0] ?? ''}`;
    return (
        estimateConservativePromptTokens(systemText) +
        estimateConservativePromptTokens(userText.replace(section, '')) +
        LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS +
        THREAD_CONTEXT_MAX_BYTES.local +
        LOCAL_PLANNING_REPLY_RESERVE_TOKENS
    );
}

describe('comparison objectives in the local planning prompt', () => {
    it('adds a bounded number of tokens when the request names the comparison qualities', async () => {
        const named = await measureMetricAwareLocalPromptCost(
            'make the chorus wider, louder, brighter and punchier than the verse'
        );
        const unnamed = await measureMetricAwareLocalPromptCost(
            'make the chorus thicker, fuller, warmer and tighter than the verse'
        );
        const extra = named - unnamed;
        expect(extra, `the comparison objectives add ${String(extra)} tokens to the local prompt`).toBeGreaterThan(0);
        expect(
            extra,
            `the comparison objectives add ${String(extra)} tokens, bound ${String(COMPARISON_OBJECTIVES_MAX_EXTRA_TOKENS)}`
        ).toBeLessThanOrEqual(COMPARISON_OBJECTIVES_MAX_EXTRA_TOKENS);
    });
});
