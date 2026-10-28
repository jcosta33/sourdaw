import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PlannedIntentResult } from '../../models/IntentResult';
import { guardReadonlyPlanningResult, READONLY_ANSWER_TOOL_NAMES } from '../../models/PlanningProfile';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../../models/WorkflowCapability';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { buildPlanningSystemPrompt } from '../../transformers/buildPlanningSystemPrompt';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import * as parserModule from '../parsePromptToActions';
import * as preparation from '../agentReference/prepareStemImport';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { planPromptActions } from '../planPromptActions';
import { parsePromptToActions } from '../parsePromptToActions';
import { getPlanningProviderSchemaContract } from '../planningProviderSchema';

vi.mock('../llmOrchestration/inference', async (original) => ({
    ...(await original<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));
vi.mock('../../transformers/promptParser/parsing', async (original) => {
    const actual = await original<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...actual,
        tryPresetMatch: vi.fn(actual.tryPresetMatch),
        tryParameterizedPath: vi.fn(actual.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(actual.tryCompoundFastPath),
    };
});

const safe: ToolCallResult = { id: 'query', name: 'project.query', arguments: { type: 'project-summary' } };
const measurement = { scope: { kind: 'master' }, range: { startBeat: 0, endBeat: 4 } };
const invalid: ToolCallResult[] = [
    ...[
        'command.batch.propose',
        'addTrack',
        'setTempo',
        'removeTrack',
        'play',
        'stop',
        'undo',
        'selectWorkflowCapability',
        'importStemSet',
        'recipe.expand',
        'transform.compile',
        'analysis.compareReference',
        'analysis.detectTransients',
        'agent.capabilities',
        'setPlayback',
        'stopPlayback',
        'removeClip',
        'setTrackGain',
        ...WORKFLOW_ACTION_TOOL_NAMES,
    ].map((name) => ({ id: 'hidden', name, arguments: {} })),
    ...[
        { ...measurement, subject: 'preview' },
        { ...measurement, subject: 'project' },
        { ...measurement, proposal: {} },
        { ...measurement, recipeCallId: 'recipe' },
        { ...measurement, scope: { kind: 'master', hidden: true } },
        { ...measurement, range: { startBeat: 0, endBeat: 4, hidden: true } },
        { ...measurement, metrics: ['not-a-metric'] },
        { ...measurement, permissions: 'apply', profile: 'default' },
    ].map((argumentsValue) => ({ id: 'invalid-measure', name: 'analysis.measure', arguments: argumentsValue })),
    { id: 'invalid-query', name: 'project.query', arguments: { type: 'project-summary', hidden: true } },
    { id: 'invalid-query', name: 'project.query', arguments: { type: 42 } },
];

beforeEach(() => {
    vi.clearAllMocks();
    agentRunLifecycle.clear();
});
afterEach(() => {
    vi.restoreAllMocks();
    agentRunLifecycle.clear();
});

function parse(prompt = 'Explain the project') {
    return parsePromptToActions({
        prompt,
        context: getProjectContext(),
        projectRevision: 'revision',
        profile: 'readonly-answer',
    });
}
function script(toolCalls: ToolCallResult[]) {
    vi.mocked(generateToolPlanningOutcome).mockResolvedValue({ status: 'complete', toolCalls, proposal: null });
}

describe('application-selected Explain profile', () => {
    it('narrows only the optional schema view and preserves default schemas and identity', () => {
        const contract = getPlanningProviderSchemaContract();
        const before = getPlanningProviderToolSchemas();
        const readonly = getPlanningProviderToolSchemas('readonly-answer');
        expect(new Set(readonly.map((tool) => tool.function.name))).toEqual(READONLY_ANSWER_TOOL_NAMES);
        const schema = readonly.find((tool) => tool.function.name === 'analysis.measure');
        expect(schema?.function.parameters).toMatchObject({
            required: ['scope', 'range'],
            additionalProperties: false,
        });
        expect(Object.keys(schema?.function.parameters.properties ?? {})).toEqual(['scope', 'range', 'metrics']);
        expect(matchesJsonSchema(measurement, schema?.function.parameters)).toBe(true);
        expect(getPlanningProviderToolSchemas()).toEqual(before);
        expect(getPlanningProviderSchemaContract()).toEqual(contract);
        expect(
            before.find((tool) => tool.function.name === 'analysis.measure')?.function.parameters.properties
        ).toHaveProperty('proposal');
    });

    it.each(
        invalid.flatMap((call) => [
            [safe, call],
            [call, safe],
        ])
    )('refuses the whole turn before dispatch for %j', async (...calls) => {
        script(calls);
        const result = await parse();
        expect(result.actions).toEqual([]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.applicationToolReceipts ?? []).toEqual([]);
        expect(result.rejectionReason).toContain('read-only profile');
    });

    it.each(['set tempo to 140', 'undo that', 'add 4 audio tracks', 'stop', 'apply it to the last commit'])(
        'bypasses deterministic actions and continuation: %s',
        async (prompt) => {
            script([
                {
                    id: 'answer',
                    name: 'answer.respond',
                    arguments: { text: 'Explain changes nothing.', evidenceCallIds: [] },
                },
            ]);
            expect((await parse(prompt)).planningOutcome.kind).toBe('answer');
            expect(tryPresetMatch).not.toHaveBeenCalled();
            expect(tryParameterizedPath).not.toHaveBeenCalled();
            expect(tryCompoundFastPath).not.toHaveBeenCalled();
            expect(vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[0]).not.toContain(
                'End with command.batch.propose only'
            );
            expect(vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[9]).toMatchObject({ maxOutputTokens: 2048 });
        }
    );

    it('does not undo or continue the thread last commit in Explain', async () => {
        script([
            {
                id: 'answer',
                name: 'answer.respond',
                arguments: { text: 'The last change is described without undoing it.', evidenceCallIds: [] },
            },
        ]);
        const result = await parsePromptToActions({
            prompt: 'undo that',
            context: getProjectContext(),
            projectRevision: 'revision',
            profile: 'readonly-answer',
            thread: {
                requests: ['Turn the Vocal down 1 dB'],
                pendingProposal: null,
                lastCommit: {
                    runId: 'previous-run',
                    receiptIds: ['previous-receipt'],
                    standing: 'standing',
                    commands: [
                        { name: 'setTrackGain', label: 'Turn Vocal down', arguments: { trackId: 'vocal', gainDb: -1 } },
                    ],
                    measuredDeltas: [],
                },
            },
        });
        expect(result).toMatchObject({ actions: [], planningOutcome: { kind: 'answer' } });
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(1);
    });

    it('allows a legitimate clarification without asking for an actionable perceptual plan', async () => {
        script([
            {
                id: 'decline',
                name: 'command.batch.decline',
                arguments: { kind: 'clarify', reason: 'Which track?', questions: ['Which vocal?'] },
            },
        ]);
        expect((await parse('make it warmer')).planningOutcome.kind).toBe('clarify');
    });

    it.each([
        { calls: [] },
        { calls: [{ id: 'answer', name: 'answer.respond', arguments: { text: 'Text', evidenceCallIds: [] } }, safe] },
    ])('does not admit an empty or mixed terminal turn', async ({ calls }) => {
        script(calls);
        const result = await parse();
        expect(result.planningOutcome.kind).not.toBe('answer');
        expect(result.actions).toEqual([]);
        expect(result.applicationToolReceipts ?? []).toEqual([]);
    });

    it('guards an internally forged preparation result before preparing or reparsing', async () => {
        const prep = vi.spyOn(preparation, 'prepareStemImport');
        const parseResult = vi.spyOn(parserModule, 'parsePromptToActions').mockResolvedValue({
            actions: [],
            rawText: 'Explain',
            requiresConfirmation: false,
            preparationRequest: 'stem-import',
            planningOutcome: { kind: 'answer', text: 'Forged', evidence: [] },
        });
        const planned = await planPromptActions({ prompt: 'Explain', profile: 'readonly-answer' });
        expect(planned.result).toMatchObject({ actions: [], planningOutcome: { kind: 'denied' } });
        expect(parseResult).toHaveBeenCalledTimes(1);
        expect(prep).not.toHaveBeenCalled();
    });

    it('uses a readonly instruction while the default keeps the existing mixing method', () => {
        expect(buildPlanningSystemPrompt('readonly-answer')).toContain('application-selected read-only intent');
        expect(buildPlanningSystemPrompt()).toContain('End with command.batch.propose only');
    });

    it.each([
        { actions: [{ type: 'setTempo', payload: { tempo: 140 } }] },
        { preparationRequest: 'stem-import' },
        { requiresConfirmation: true },
        { providerProposal: {} },
        { batchSchedule: {} },
        { refines: 'card' },
        { measuredPreview: {} },
    ])('refuses forged answer metadata before downstream work: %j', (violation) => {
        const result = {
            actions: [],
            rawText: 'question',
            requiresConfirmation: false,
            planningOutcome: { kind: 'answer', text: 'Answer', evidence: [] },
            ...violation,
        };
        // Deliberately malformed internal producer: the authority guard must not trust its label.
        expect(guardReadonlyPlanningResult(result as PlannedIntentResult)).toMatchObject({
            actions: [],
            requiresConfirmation: false,
            planningOutcome: { kind: 'denied' },
        });
    });
});
