import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type ToolSchema } from '../../models/ToolDefinitions';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { chatStore } from '../../stores/chatStore';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { materializePromptCommandPlan } from '../agentRequestOrchestration/materializePromptCommandPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';

import { advertisedAnswerCandidateId } from './answerWireFixture';
import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import {
    configureMetricGoalProject,
    metricGoalAudioBuffer,
    metricGoalProviderPlan,
    readMetricPublication,
    resetMetricGoalProject,
} from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    updateDeviceParam: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));
vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted measured plan provider request.');
    }),
}));

const PROMPT = 'The backing vocals sound harsh in the chorus';
const SECTION_ID = 'private-harsh-chorus-section';
const RUN_ID = 'measured-harsh-backing-vocals';
const LEFT = 'backing-vocals-l';
const RIGHT = 'backing-vocals-r';
const TARGETS = [LEFT, RIGHT];
const METRICS = ['frequencyBandEnergy', 'spectralCentroid'];

/** Each track's own source levels, unequal so a figure read from the wrong target cannot pass for the right one. */
const SOURCE_LEVELS: Readonly<Record<string, { low: number; presence: number; air: number }>> = {
    [LEFT]: { low: 0.2, presence: 0.3, air: 0.1 },
    [RIGHT]: { low: 0.25, presence: 0.2, air: 0.15 },
};

beforeEach(() => {
    configureMetricGoalProject({
        label: 'harsh backing vocals',
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            createTrack({ id: LEFT, name: 'Backing Vocals L', kind: 'audio' }),
            createTrack({ id: RIGHT, name: 'Backing Vocals R', kind: 'audio' }),
        ],
        sections: [{ id: SECTION_ID, name: 'Chorus', startBeat: 0, endBeat: 4, color: '#ffffff' }],
    });
    aiBackendPreferenceStore.set('auto');
    vi.mocked(generateToolPlanningOutcome).mockReset();
    for (const port of Object.values(audio)) {
        port.mockReset();
    }
    audio.renderOffline.mockImplementation(async () => {
        throw new Error('Named backing vocals must use their isolated project render.');
    });
    audio.renderOfflineInput.mockImplementation(async () => {
        throw new Error('Named backing vocals must use their isolated preview render.');
    });
    // The isolated render of one target: its own source, shaped by the equalizers its own track holds.
    audio.renderTrackSubgraphOffline.mockImplementation(
        async (input: Parameters<typeof renderTrackSubgraphOffline>[0]) => {
            const target = input.renderTracks.find((track) => track.id === input.targetTrackId);
            const levels = SOURCE_LEVELS[input.targetTrackId];
            if (target === undefined || levels === undefined) {
                throw new Error('Missing actual isolated target.');
            }
            const gain = (paramId: string) =>
                10 **
                (target.devices
                    .filter((device) => device.type === 'builtin-eq')
                    .reduce((total, device) => total + (device.parameterValues[paramId] ?? 0), 0) /
                    20);
            const presence = levels.presence * gain('eq-mid-gain');
            const air = levels.air * gain('eq-high-gain');
            return metricGoalAudioBuffer(
                (seconds) =>
                    levels.low * Math.sin(2 * Math.PI * 150 * seconds) +
                    presence * Math.sin(2 * Math.PI * 4500 * seconds) +
                    air * Math.sin(2 * Math.PI * 10000 * seconds),
                (input.endBeat - input.startBeat) / 2
            );
        }
    );
});
afterEach(() => {
    vi.restoreAllMocks();
    aiBackendPreferenceStore.set('auto');
    resetMetricGoalProject();
});

type PreviewSource = { recipeCallIds: string[] } | { recipeCallId: string };

/** The intake turn: one vocal-dark objective per backing vocal, over the chorus. */
function intakeCall(userMessage: string, schemas: readonly ToolSchema[]) {
    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
    const base = selectCreativeInterpretationCall({
        catalog,
        modeId: 'edit',
        targetObjectIds: TARGETS,
        dimensions: ['processing'],
        creationSlotObjectTypes: ['device'],
    });
    const schema = schemas.find((candidate) => candidate.function.name === base.name);
    if (schema === undefined) {
        throw new Error('Missing actual joint schema.');
    }
    const objective = readMetricPublication(schema).find((candidate) => candidate.recipeId === 'vocal-dark');
    if (objective === undefined) {
        throw new Error('Missing actual authored vocal-dark objective.');
    }
    const call = {
        ...base,
        id: 'harsh-intake',
        arguments: {
            ...base.arguments,
            creationSlotIds: catalog.creationSlots
                .filter(
                    (slot) =>
                        slot.objectType === 'device' &&
                        catalog.targets.some(
                            (target) =>
                                target.candidateId === slot.parentCandidateId &&
                                target.objectIds.length === 1 &&
                                TARGETS.includes(target.objectIds[0]!)
                        )
                )
                .map((slot) => slot.candidateId),
            answer: null,
            metricIntent: {
                kind: 'perceptual',
                uncertainty: 'none',
                objectives: TARGETS.map((targetId) => ({
                    objectiveId: objective.id,
                    scopeCandidateId: advertisedAnswerCandidateId([schemas, userMessage], targetId),
                    referenceScopeCandidateId: null,
                    rangeCandidateId: advertisedAnswerCandidateId([schemas, userMessage], 'Chorus', 'ranges'),
                })),
            },
        },
    };
    expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
    return call;
}

/**
 * The four-turn plan the issue describes: intake, one vocal-dark expansion per backing vocal in
 * one turn, one preview, and a proposal adopting the call ids `adopted` names.
 */
async function planHarshBackingVocals(input: { source: PreviewSource; adopted: string[] }) {
    expect(
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: PROMPT,
            mode: 'apply',
            createdRevision: captureProjectRevision(),
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
    chatStore.set({
        messages: [{ id: 'harsh-assistant', role: 'assistant', content: 'Planning', timestamp: 1 }],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
    flushAutomergeStorageWrites();
    const context = getProjectContext();
    const revision = captureProjectRevision();
    let turns = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        turns += 1;
        if (turns === 1) {
            return { status: 'complete', proposal: null, toolCalls: [intakeCall(userMessage, schemas)] };
        }
        if (turns === 2) {
            return {
                status: 'complete',
                proposal: null,
                toolCalls: [
                    { id: 'dark-l', name: 'recipe.expand', arguments: { recipeId: 'vocal-dark', targetId: LEFT } },
                    { id: 'dark-r', name: 'recipe.expand', arguments: { recipeId: 'vocal-dark', targetId: RIGHT } },
                ],
            };
        }
        if (turns === 3) {
            return {
                status: 'complete',
                proposal: null,
                toolCalls: [
                    {
                        id: 'harsh-preview',
                        name: 'analysis.measure',
                        arguments: {
                            subject: 'preview',
                            scope: { kind: 'tracks', ids: TARGETS },
                            range: { startBeat: 0, endBeat: 4 },
                            metrics: METRICS,
                            ...input.source,
                        },
                    },
                ],
            };
        }
        if (turns === 4) {
            return {
                status: 'complete',
                proposal: null,
                toolCalls: [
                    {
                        id: 'harsh-proposal',
                        name: 'command.batch.propose',
                        arguments: {
                            commands: [],
                            compiledCallIds: input.adopted,
                            plan: metricGoalProviderPlan(PROMPT, TARGETS),
                        },
                    },
                ],
            };
        }
        throw new Error('The two-target plan exceeded its four scripted turns.');
    });
    const planned = await parsePromptToActions({
        prompt: PROMPT,
        context,
        projectRevision: revision,
        streamIdentity: { runId: RUN_ID, requestId: 'harsh-request', cancellationGeneration: 0 },
        onMeasurementAttempt: agentWorkBudget.admitMeasurement(RUN_ID),
    });
    expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
    expect(turns).toBe(4);
    const materialized = materializePromptCommandPlan({
        userText: PROMPT,
        runId: RUN_ID,
        assistantMessageId: 'harsh-assistant',
        interactionMode: 'apply',
        trustCeiling: undefined,
        resume: undefined,
        onResumedPlanAccepted: undefined,
        projectRevision: revision,
        context,
        result: { ...planned, planningOutcome: { kind: 'proposal' } },
        actionLabels: planned.actions.map((action) => action.type),
        protectedTargetIds: [],
    });
    if (materialized.status === 'terminal') {
        await materialized.completion;
        throw new Error('The measured two-target plan must remain available for approval.');
    }
    const compiled = materialized.compiledActionExecution;
    const state = metricGoalStateCodec(compiled.metricGoalState);
    const evaluation = evaluateMetricGoalAdmission({
        state,
        commandBatch: compiled.commandBatch,
        currentRevision: revision,
    });
    return { planned, state, evaluation };
}

describe('a measured preview of several retained recipes', () => {
    // Listed in either order, the expansions are measured in the order the run admitted them, which
    // is the order the plan's recipe steps take, so every step's prefix is a prefix of the batch.
    it.each([[['dark-l', 'dark-r']], [['dark-r', 'dark-l']]])(
        'admits and verifies a two-target request listed as %j against each target’s own figures',
        async (recipeCallIds) => {
            const before = { tracks: structuredClone(trackStore.value), undo: structuredClone(undoHistoryStore.value) };
            const { planned, state, evaluation } = await planHarshBackingVocals({
                source: { recipeCallIds },
                adopted: ['harsh-preview'],
            });

            expect(planned.actions.filter((action) => action.type === 'addDevice')).toMatchObject([
                { payload: { trackId: LEFT, deviceType: 'builtin-eq' } },
                { payload: { trackId: RIGHT, deviceType: 'builtin-eq' } },
            ]);
            expect(planned.adoptedRecipes).toMatchObject([
                { recipeId: 'vocal-dark', targetId: LEFT },
                { recipeId: 'vocal-dark', targetId: RIGHT },
            ]);
            expect(state?.steps.map((step) => step.stepId)).toEqual([
                `recipe:vocal-dark:${LEFT}`,
                `recipe:vocal-dark:${RIGHT}`,
            ]);
            expect(state?.binding?.prefixes).toHaveLength(2);
            expect(state?.binding?.prefixes.at(-1)?.after).toBe(planned.measuredPreview?.batchContentHash);
            expect(evaluation, JSON.stringify(evaluation)).toMatchObject({ status: 'verified', failure: null });
            // Every goal is read on its own target: each step's figures move only that target's sound.
            const criteria = evaluation.criteria.map((criterion) => ({
                metricId: criterion.metricId,
                band: criterion.band,
                targetIds: criterion.targetIds,
                from: criterion.baseline,
                to: criterion.observed,
            }));
            expect(criteria).toHaveLength(4);
            for (const criterion of criteria) {
                expect(criterion.targetIds).toHaveLength(1);
                expect(criterion.to[0]).toBeLessThan(criterion.from[0]!);
            }
            const centroids = criteria.filter((criterion) => criterion.metricId === 'spectralCentroid');
            expect(centroids.map((criterion) => criterion.targetIds[0])).toEqual([LEFT, RIGHT]);
            // Unequal sources: the two targets' figures differ, so neither was read from the other's render.
            expect(centroids[0]?.from[0]).not.toBe(centroids[1]?.from[0]);
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
        }
    );

    it('still refuses as incomparable a preview missing one target’s recipe when the proposal holds both', async () => {
        const { planned, state, evaluation } = await planHarshBackingVocals({
            source: { recipeCallId: 'dark-l' },
            adopted: ['harsh-preview', 'dark-r'],
        });

        expect(planned.actions.filter((action) => action.type === 'addDevice')).toHaveLength(2);
        expect(state?.binding?.prefixes).toHaveLength(2);
        expect(planned.measuredPreview?.batchContentHash).toBe(state?.binding?.prefixes[0]?.after);
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'incomparable' });
    });
});
