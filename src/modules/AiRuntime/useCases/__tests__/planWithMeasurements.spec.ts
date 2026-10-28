import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeVersionedCommandBatchEnvelope, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { chatStore } from '../../stores/chatStore';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';

import { advertisedAnswerCandidateId } from './answerWireFixture';
import {
    getApplicationToolReceipts,
    isRecord,
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from './highLevelIntentWorkflowFixture';
import {
    configureMetricGoalProject,
    metricGoalAudioBuffer,
    readMetricPublication,
    resetMetricGoalProject,
} from './metricGoalWorkflowFixture';

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

const PROMPT = 'Make Lead Vocal warmer over Chorus';
const SECTION_ID = 'private-warm-vocal-section';
const RUN_ID = 'measured-warm-vocal';

beforeEach(() => {
    configureMetricGoalProject({
        label: 'measured warm vocal',
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            createTrack({ id: 'vocal', name: 'Lead Vocal', kind: 'audio' }),
        ],
        sections: [{ id: SECTION_ID, name: 'Chorus', startBeat: 0, endBeat: 4, color: '#ffffff' }],
    });
    vi.mocked(generateToolPlanningOutcome).mockReset();
    for (const port of Object.values(audio)) {
        port.mockReset();
    }
    audio.renderOffline.mockImplementation(async () => {
        throw new Error('Named vocal must use its isolated project render.');
    });
    audio.renderOfflineInput.mockImplementation(async () => {
        throw new Error('Named vocal must use its isolated preview render.');
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    resetMetricGoalProject();
});

describe('configured mixing plan with actual measurements', () => {
    it.each(['matched', 'contradicted', 'render-failed'] as const)(
        'keeps the real five-turn warm-vocal plan visible and verifies %s evidence',
        async (mode) => {
            let renderStarts = 0;
            audio.renderTrackSubgraphOffline.mockImplementation(
                async (input: Parameters<typeof renderTrackSubgraphOffline>[0]) => {
                    renderStarts += 1;
                    const vocal = input.renderTracks.find((track) => track.id === input.targetTrackId);
                    if (vocal === undefined) {
                        throw new Error('Missing actual isolated target.');
                    }
                    const eq = vocal.devices.find((device) => device.type === 'builtin-eq');
                    if (eq !== undefined && mode === 'render-failed') {
                        throw new Error('Controlled preview renderer unavailable.');
                    }
                    let lowDb = 0;
                    let highDb = 0;
                    if (mode !== 'contradicted') {
                        lowDb = eq?.parameterValues['eq-low-gain'] ?? 0;
                        highDb = eq?.parameterValues['eq-high-gain'] ?? 0;
                    }
                    const low = 0.2 * 10 ** (lowDb / 20);
                    const high = 0.2 * 10 ** (highDb / 20);
                    return metricGoalAudioBuffer(
                        (seconds) =>
                            low * Math.sin(2 * Math.PI * 150 * seconds) +
                            high * Math.sin(2 * Math.PI * 10000 * seconds),
                        (input.endBeat - input.startBeat) / 2
                    );
                }
            );
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
                messages: [{ id: 'warm-assistant', role: 'assistant', content: 'Planning', timestamp: 1 }],
                isGenerating: false,
                enableReasoning: true,
                chatMode: 'prompt',
            });
            const context = getProjectContext();
            const revision = captureProjectRevision();
            const before = {
                revision,
                tracks: structuredClone(trackStore.value),
                undo: structuredClone(undoHistoryStore.value),
                transport: structuredClone(transportStore.value),
            };
            const turns: string[] = [];
            vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
                turns.push(userMessage);
                expect(JSON.stringify(schemas)).not.toContain(SECTION_ID);
                expect(userMessage).not.toContain(SECTION_ID);
                expect(userMessage).not.toContain('recipeDigest');
                const turn = turns.length;
                if (turn === 1) {
                    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
                    const base = selectCreativeInterpretationCall({
                        catalog,
                        modeId: 'edit',
                        targetObjectIds: ['vocal'],
                        dimensions: ['processing'],
                        creationSlotObjectTypes: ['device'],
                    });
                    const schema = schemas.find((candidate) => candidate.function.name === base.name);
                    if (schema === undefined) {
                        throw new Error('Missing actual joint schema.');
                    }
                    const objective = readMetricPublication(schema).find(
                        (candidate) => candidate.recipeId === 'vocal-warm'
                    );
                    if (objective === undefined) {
                        throw new Error('Missing actual authored vocal criterion.');
                    }
                    const call = {
                        ...base,
                        id: 'warm-intake',
                        arguments: {
                            ...base.arguments,
                            answer: null,
                            metricIntent: {
                                kind: 'perceptual',
                                uncertainty: 'none',
                                objectives: [
                                    {
                                        objectiveId: objective.id,
                                        scopeCandidateId: advertisedAnswerCandidateId([schemas, userMessage], 'vocal'),
                                        referenceScopeCandidateId: null,
                                        rangeCandidateId: advertisedAnswerCandidateId(
                                            [schemas, userMessage],
                                            'Chorus',
                                            'ranges'
                                        ),
                                    },
                                ],
                            },
                        },
                    };
                    expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
                    return { status: 'complete', toolCalls: [call] };
                }
                if (turn === 2) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'warm-baseline',
                                name: 'analysis.measure',
                                arguments: {
                                    scope: { kind: 'tracks', ids: ['vocal'] },
                                    range: { startBeat: 0, endBeat: 4 },
                                    metrics: ['frequencyBandEnergy', 'spectralCentroid'],
                                },
                            },
                            {
                                id: 'warm-discovery',
                                name: 'recipe.discover',
                                arguments: { descriptors: ['warm'], targetId: 'vocal', limit: 1 },
                            },
                        ],
                    };
                }
                if (turn === 3) {
                    const receipt = getApplicationToolReceipts(userMessage).find(
                        (entry) => isRecord(entry) && entry.callId === 'warm-discovery'
                    );
                    expect(receipt).toMatchObject({ status: 'success' });
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'warm-expansion',
                                name: 'recipe.expand',
                                arguments: { recipeId: 'vocal-warm', targetId: 'vocal' },
                            },
                        ],
                    };
                }
                if (turn === 4) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'warm-preview',
                                name: 'analysis.measure',
                                arguments: {
                                    subject: 'preview',
                                    recipeCallId: 'warm-expansion',
                                    scope: { kind: 'tracks', ids: ['vocal'] },
                                    range: { startBeat: 0, endBeat: 4 },
                                    metrics: ['frequencyBandEnergy', 'spectralCentroid'],
                                },
                            },
                        ],
                    };
                }
                if (turn === 5) {
                    let adopted = 'warm-preview';
                    if (mode === 'render-failed') {
                        adopted = 'warm-expansion';
                    }
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'warm-proposal',
                                name: 'command.batch.propose',
                                arguments: { commands: [], compiledCallIds: [adopted] },
                            },
                        ],
                    };
                }
                throw new Error('Mix plan exceeded the earned fifth turn.');
            });
            const planned = await parsePromptToActions({
                prompt: PROMPT,
                context,
                projectRevision: revision,
                streamIdentity: { runId: RUN_ID, requestId: 'warm-request', cancellationGeneration: 0 },
                onMeasurementAttempt: agentWorkBudget.admitMeasurement(RUN_ID),
            });
            expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
            expect(turns).toHaveLength(5);
            expect(planned.actions).toHaveLength(5);
            expect(planned.actions[0]).toMatchObject({
                type: 'addDevice',
                payload: { trackId: 'vocal', deviceType: 'builtin-eq' },
            });
            expect(renderStarts).toBe(3);
            expect({
                revision: captureProjectRevision(),
                tracks: trackStore.value,
                undo: undoHistoryStore.value,
                transport: transportStore.value,
            }).toEqual(before);
            const compiled = compileAgentActionExecution({
                actions: planned.actions,
                actionLabels: planned.actions.map((action) => action.type),
                actionCommandGraph: planned.actionCommandGraph,
                context,
                intent: PROMPT,
                group: { groupId: 'warm-plan', groupLabel: PROMPT },
                projectRevision: revision,
                runId: RUN_ID,
                requiresConfirmation: true,
                metricGoalState: planned.metricGoalState,
            });
            const state = metricGoalStateCodec(compiled.metricGoalState);
            expect(state?.authorities[0]?.goals).toMatchObject([
                {
                    metricId: 'frequencyBandEnergy',
                    band: 'bass',
                    relation: 'increase',
                    range: { sectionId: SECTION_ID },
                    source: { kind: 'recipe', recipeId: 'vocal-warm', recipeDigest: expect.any(String) },
                },
                { metricId: 'spectralCentroid', relation: 'decrease' },
            ]);
            const evaluation = evaluateMetricGoalAdmission({
                state,
                commandBatch: compiled.commandBatch,
                currentRevision: revision,
            });
            if (mode === 'matched') {
                expect(evaluation).toMatchObject({
                    status: 'verified',
                    criteria: [
                        { status: 'verified', unit: 'ratio' },
                        { status: 'verified', unit: 'hertz' },
                    ],
                });
                expect(state?.proofs).toHaveLength(1);
            } else {
                expect(evaluation.status).toBe('blocked');
                expect(state?.proofs).toHaveLength(mode === 'render-failed' ? 0 : 1);
            }
            expect(compiled.requiresConfirmation).toBe(true);
            if (compiled.agentApproval === null) {
                throw new Error('Expected real recipe approval.');
            }
            const parsed = parseVersionedCommandBatchEnvelope(
                compiled.commandBatch.serialized,
                compiled.commandBatch.authority
            );
            if (parsed.status !== 'valid') {
                throw new Error('Expected actual bound command batch.');
            }
            const confirmationId = persistPromptActionConfirmation({
                runId: RUN_ID,
                prompt: PROMPT,
                assistantMessageId: 'warm-assistant',
                actions: planned.actions,
                actionLabels: planned.actions.map((action) => action.type),
                commandEnvelopes: compiled.commandEnvelopes,
                commandBatch: compiled.commandBatch,
                agentApproval: compiled.agentApproval,
                metricGoalState: compiled.metricGoalState,
                affectedIds: ['vocal'],
                protectedUnchanged: [],
                measuredPreview: planned.measuredPreview,
                adoptedRecipes: planned.adoptedRecipes,
                executionMode: 'atomic',
                group: { groupId: 'warm-plan', groupLabel: PROMPT },
                projectRevision: revision,
                parsedCommandBatch: parsed,
                content: 'Warm vocal proposal',
            });
            if (confirmationId === null) {
                throw new Error('Expected visible retained proposal.');
            }
            const view = getAgentApprovalView({ confirmationId });
            expect(view).not.toBeNull();
            expect(view?.actionLabels).toHaveLength(5);
            expect(view?.canConfirm).toBe(mode === 'matched');
            expect(view?.metricGoals.criteria[0]?.criterionText).toContain('frequency-band energy');
            expect(view?.metricGoals.criteria[0]?.criterionText).toContain('Lead Vocal');
            expect(view?.metricGoals.criteria[0]?.criterionText).not.toContain('recipeDigest');
            expect(
                agentRunLifecycle.get(RUN_ID)?.budgetAttempts.some((attempt) => attempt.category === 'localAnalysis')
            ).toBe(true);
            // Even verified criteria do not self-approve an otherwise confirmation-required recipe.
            expect((await executeVersionedCommandBatchEnvelope(compiled.commandBatch)).status).toBe('rejected');
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
        }
    );
});
