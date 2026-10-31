import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, normalizeClip } from '#/modules/Arrangement/useCases';
import {
    cacheAudioBuffer,
    configureOfflinePpqEndpointProjection,
    type renderTrackSubgraphOffline,
    type renderOfflineInput,
    type captureOfflineRenderInput,
} from '#/modules/AudioEngine/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeVersionedCommandBatchEnvelope, undo } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { projectPpqEndpoints, resolveTempoAtBeat } from '#/modules/Transport/useCases';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { readAgentRunState, persistAgentRunState } from '../../stores/agentRunStore';
import { aiActionHistoryStore } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    pendingActionConfirmationStore,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { materializePromptCommandPlan } from '../agentRequestOrchestration/materializePromptCommandPlan';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { readChatThreadContext } from '../readChatThreadContext';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

import { advertisedAnswerCandidateId } from './answerWireFixture';
import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import {
    configureMetricGoalProject,
    resetMetricGoalProject,
    metricGoalAudioBuffer,
    metricGoalProviderPlan,
    readMetricPublication,
    literalMetricIntakeTurn,
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
        throw new Error('Unscripted comparison provider request.');
    }),
}));

const PROMPT = 'Match Drums loudness to Bass over Chorus';
const RUN_ID = 'metric-comparison-run';
const SECTION_ID = 'private-comparison-section';

function sine(amplitude: number, seconds: number): AudioBuffer {
    return metricGoalAudioBuffer((time) => amplitude * Math.sin(2 * Math.PI * 1000 * time), seconds);
}

type RenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];

beforeEach(() => {
    configureMetricGoalProject({
        label: 'metric comparison test',
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: 'drums', name: 'Drums', kind: 'audio' }),
                devices: [
                    {
                        id: 'drums-trim',
                        name: 'Drums Trim',
                        type: 'builtin-gain',
                        bypassed: false,
                        parameterValues: { 'gain-level': 0 },
                    },
                ],
            },
            {
                ...createTrack({ id: 'bass', name: 'Bass', kind: 'audio' }),
                gain: 0.4,
                devices: [
                    {
                        id: 'bass-trim',
                        name: 'Bass Trim',
                        type: 'builtin-gain',
                        bypassed: false,
                        parameterValues: { 'gain-level': 0 },
                    },
                ],
            },
        ],
        sections: [{ id: SECTION_ID, name: 'Chorus', startBeat: 0, endBeat: 4, color: '#ffffff' }],
    });
    expect(trackStore.value?.tracks.find((track) => track.id === 'drums')?.gain).toBe(0.8);
    expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.gain).toBe(0.4);
    vi.mocked(generateToolPlanningOutcome).mockReset();
    audio.updateDeviceParam.mockReset();
    audio.renderTrackSubgraphOffline.mockReset();
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('Named track comparison must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('Named track comparison must not substitute source audio.');
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    resetMetricGoalProject();
});

describe('actual current-preview comparison approval', () => {
    it('keeps a literal mute beside an unsupported perceptual gain proposal visible with Confirm blocked', async () => {
        const prompt = 'mute Vocals and lower Guitar';
        const runId = 'mixed-literal-perceptual';
        configureMetricGoalProject({
            label: runId,
            tracks: [
                createTrack({ id: 'vocals', name: 'Vocals', kind: 'audio' }),
                createTrack({ id: 'guitar', name: 'Guitar', kind: 'audio' }),
            ],
            sections: [],
        });
        const context = getProjectContext();
        const revision = captureProjectRevision();
        const before = {
            tracks: structuredClone(trackStore.value),
            undo: structuredClone(undoHistoryStore.value),
            revision,
        };
        expect(agentRunLifecycle.create({ runId, request: prompt, mode: 'apply', createdRevision: revision })).toEqual({
            status: 'created',
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
        let turn = 0;
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, message, schemas) => {
            const phase = turn % 3;
            turn += 1;
            if (phase === 0) {
                const catalog = readCreativeInterpretationCatalog(message, schemas);
                const base = selectCreativeInterpretationCall({
                    catalog,
                    modeId: 'edit',
                    targetObjectIds: ['vocals', 'guitar'],
                    dimensions: ['processing'],
                });
                const schema = schemas.find(
                    (entry: Parameters<typeof generateToolPlanningOutcome>[2][number]) =>
                        entry.function.name === base.name
                );
                if (schema === undefined) {
                    throw new TypeError('Expected the actual published joint selector.');
                }
                const objective = readMetricPublication(schema).find((entry) => entry.kind === 'unsupported');
                if (objective === undefined) {
                    throw new TypeError('Expected the actual published unsupported metric objective.');
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            ...base,
                            id: 'mixed-intake',
                            arguments: {
                                ...base.arguments,
                                answer: null,
                                metricIntent: {
                                    kind: 'perceptual',
                                    uncertainty: 'none',
                                    objectives: [
                                        {
                                            objectiveId: objective.id,
                                            scopeCandidateId: null,
                                            referenceScopeCandidateId: null,
                                            rangeCandidateId: null,
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                };
            }
            if (phase === 1) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'mixed-discovery',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['muteTrack', 'setTrackGain'] },
                        },
                    ],
                };
            }
            return {
                status: 'complete',
                toolCalls: [
                    {
                        id: 'mixed-proposal',
                        name: 'command.batch.propose',
                        arguments: {
                            commands: [
                                { name: 'muteTrack', arguments: { trackId: 'vocals', muted: true } },
                                { name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.6 } },
                            ],
                            plan: metricGoalProviderPlan(prompt, ['vocals', 'guitar']),
                        },
                    },
                ],
            };
        });
        const planned = await parsePromptToActions({
            prompt,
            context,
            projectRevision: revision,
            streamIdentity: { runId, requestId: runId, cancellationGeneration: 0 },
        });
        expect(planned.planningOutcome, planned.rejectionReason).toEqual({ kind: 'proposal' });
        expect(planned.actions.map((action) => action.type)).toEqual(['muteTrack', 'setTrackGain']);
        expect(metricGoalStateCodec(planned.metricGoalState)?.authorities).toMatchObject([
            {
                kind: 'perceptual',
                goals: [{ relation: 'unsupported' }],
            },
        ]);
        expect(
            metricGoalStateCodec(planned.metricGoalState)?.authorities[0]?.creativeAuthority?.targets
        ).toContainEqual(expect.objectContaining({ objectIds: ['guitar'] }));
        const materialized = materializePromptCommandPlan({
            userText: prompt,
            runId,
            assistantMessageId: runId,
            interactionMode: 'apply',
            trustCeiling: undefined,
            resume: undefined,
            onResumedPlanAccepted: undefined,
            projectRevision: revision,
            context,
            result: planned,
            actionLabels: planned.actions.map((action) => action.type),
            protectedTargetIds: [],
        });
        if (materialized.status !== 'prepared' || materialized.compiledActionExecution.agentApproval === null) {
            throw new TypeError('Expected the whole mixed plan to remain available for review.');
        }
        const compiled = materialized.compiledActionExecution;
        chatStore.set({
            messages: [{ id: runId, role: 'assistant', content: prompt, timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
        const confirmationId = persistPromptActionConfirmation({
            runId,
            prompt,
            assistantMessageId: runId,
            actions: planned.actions,
            actionLabels: planned.actions.map((action) => action.type),
            commandEnvelopes: compiled.commandEnvelopes,
            commandBatch: compiled.commandBatch,
            agentApproval: compiled.agentApproval,
            metricGoalState: compiled.metricGoalState,
            affectedIds: ['vocals', 'guitar'],
            protectedUnchanged: [],
            groundingBasis: planned.groundingBasis,
            executionMode: 'atomic',
            group: materialized.commandGroup,
            projectRevision: revision,
            parsedCommandBatch: materialized.parsedCommandBatch,
            content: prompt,
        });
        if (confirmationId === null) {
            throw new TypeError('Expected a persisted mixed proposal.');
        }
        expect(getAgentApprovalView({ confirmationId })?.canConfirm).toBe(false);
        agentRunLifecycle.transitionPhase({ runId, phase: 'waiting-for-approval' });
        expect(await confirmPendingChatActions({ confirmationId })).toMatchObject({
            status: 'failed',
            reason: expect.stringMatching(/objective|metric|measure/u),
        });
        expect(trackStore.value).toEqual(before.tracks);
        expect(undoHistoryStore.value).toEqual(before.undo);
        expect(captureProjectRevision()).toBe(before.revision);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('keeps an unadmitted numeric true-peak constraint visible but blocks Confirm before gain writes', async () => {
        const prompt = 'Raise Drums by 1 dB while keeping true peak below -1 dBTP';
        const runId = 'literal-numeric-run';
        const context = getProjectContext();
        const revision = captureProjectRevision();
        expect(agentRunLifecycle.create({ runId, request: prompt, mode: 'apply', createdRevision: revision })).toEqual({
            status: 'created',
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });

        let turns = 0;
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
            turns += 1;
            if (turns === 1) {
                expect(userMessage).toContain(prompt);
                expect(JSON.stringify(schemas)).toContain('-1 dBTP');
                const calls = literalMetricIntakeTurn(userMessage, schemas);
                expect(calls[0]?.arguments.metricIntent).toEqual({
                    kind: 'literal',
                    uncertainty: 'none',
                    objectives: [],
                });
                return { status: 'complete', toolCalls: calls.map((call) => ({ ...call, id: 'numeric-intake' })) };
            }
            if (turns === 2) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'numeric-discovery',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['setTrackGain'] },
                        },
                    ],
                };
            }
            if (turns === 3) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'numeric-proposal',
                            name: 'command.batch.propose',
                            arguments: {
                                commands: [
                                    {
                                        name: 'setTrackGain',
                                        arguments: { trackId: 'drums', deltaDb: 1 },
                                    },
                                ],
                                plan: metricGoalProviderPlan(prompt, ['drums']),
                            },
                        },
                    ],
                };
            }
            throw new Error('The literal numeric route exceeded its three scripted provider turns.');
        });

        const before = structuredClone(trackStore.value);
        const planned = await parsePromptToActions({
            prompt,
            context,
            projectRevision: revision,
            streamIdentity: { runId, requestId: 'literal-numeric-request', cancellationGeneration: 0 },
            onMeasurementAttempt: agentWorkBudget.admitMeasurement(runId),
        });
        expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
        expect(planned.actions).toMatchObject([
            { type: 'setTrackGain', payload: { trackId: 'drums', deltaDb: 1, expectedGain: 0.8 } },
        ]);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(audio.renderOffline).not.toHaveBeenCalled();
        expect(audio.renderOfflineInput).not.toHaveBeenCalled();

        const state = metricGoalStateCodec(planned.metricGoalState);
        expect(state?.authorities).toMatchObject([{ kind: 'literal', goals: [] }]);
        expect(state?.proofs).toEqual([]);
        const materialized = materializePromptCommandPlan({
            userText: prompt,
            runId,
            assistantMessageId: 'literal-numeric-assistant',
            interactionMode: 'apply',
            trustCeiling: undefined,
            resume: undefined,
            onResumedPlanAccepted: undefined,
            projectRevision: revision,
            context,
            result: { ...planned, requiresConfirmation: true, planningOutcome: { kind: 'proposal' } },
            actionLabels: planned.actions.map((action) => action.type),
            protectedTargetIds: [],
        });
        if (materialized.status !== 'prepared' || materialized.compiledActionExecution.agentApproval === null) {
            throw new Error('Expected a persisted approval card for the literal numeric command.');
        }
        const compiled = materialized.compiledActionExecution;
        expect(
            evaluateMetricGoalAdmission({
                state: metricGoalStateCodec(compiled.metricGoalState),
                commandBatch: compiled.commandBatch,
                currentRevision: revision,
            })
        ).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('-1 dBTP'),
        });
        chatStore.set({
            messages: [{ id: 'literal-numeric-assistant', role: 'assistant', content: 'Literal plan', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
        const confirmationId = persistPromptActionConfirmation({
            runId,
            prompt,
            assistantMessageId: 'literal-numeric-assistant',
            actions: planned.actions,
            actionLabels: planned.actions.map((action) => action.type),
            commandEnvelopes: compiled.commandEnvelopes,
            commandBatch: compiled.commandBatch,
            agentApproval: compiled.agentApproval,
            metricGoalState: compiled.metricGoalState,
            affectedIds: ['drums'],
            protectedUnchanged: [],
            groundingBasis: planned.groundingBasis,
            executionMode: 'atomic',
            group: materialized.commandGroup,
            projectRevision: revision,
            parsedCommandBatch: materialized.parsedCommandBatch,
            content: 'Raise Drums by 1 dB while keeping true peak below -1 dBTP',
        });
        if (confirmationId === null) {
            throw new Error('The actual pending confirmation was not persisted.');
        }
        expect(getAgentApprovalView({ confirmationId })?.canConfirm).toBe(false);
        agentRunLifecycle.transitionPhase({ runId, phase: 'waiting-for-approval' });
        expect(await confirmPendingChatActions({ confirmationId })).toMatchObject({
            status: 'failed',
            reason: expect.stringContaining('-1 dBTP'),
        });
        expect(trackStore.value).toEqual(before);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it.each([
        'matched',
        'reference-changed',
        'one-sided',
        'unsupported-fader',
        'confirmation-matched',
        'confirmation-replaced-proof',
        'direct-replaced-proof',
        'refinement-literal',
        'scheduled-fresh-proof',
    ] as const)('verifies both real named subjects for %s instead of substituting reference baseline', async (mode) => {
        const confirmation = mode.startsWith('confirmation-') || mode === 'refinement-literal';
        const matched =
            mode === 'matched' || confirmation || mode === 'direct-replaced-proof' || mode === 'scheduled-fresh-proof';
        let renders = 0;
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            renders += 1;
            const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
            if (track === undefined) {
                throw new Error('Actual renderer target is absent.');
            }
            const levelDb = track.devices.reduce(
                (total, device) => total + (device.parameterValues['gain-level'] ?? 0),
                0
            );
            const gain = track.gain * 10 ** (levelDb / 20);
            return sine(0.5 * gain, (input.endBeat - input.startBeat) / 2);
        });
        let prompt = PROMPT;
        if (mode === 'reference-changed') {
            prompt += ', and lower Bass using Bass Trim';
        }
        const previewItems: Array<Record<string, unknown>> = [
            {
                id: 'match-drums',
                name: 'setDeviceParameter',
                arguments: { paramId: 'gain-level', value: 20 * Math.log10(0.5) },
                selector: {
                    targetArgument: 'deviceId',
                    entity: 'device',
                    where: { name: 'Drums Trim' },
                    quantity: { unit: 'targets', exactly: 1 },
                },
            },
        ];
        if (mode === 'reference-changed') {
            previewItems.push({
                id: 'lower-reference',
                name: 'setDeviceParameter',
                arguments: { paramId: 'gain-level', value: 20 * Math.log10(0.5) },
                selector: {
                    targetArgument: 'deviceId',
                    entity: 'device',
                    where: { name: 'Bass Trim' },
                    quantity: { unit: 'targets', exactly: 1 },
                },
            });
        }
        if (mode === 'unsupported-fader') {
            previewItems.splice(0, previewItems.length, {
                id: 'unsupported-fader',
                name: 'setTrackGain',
                arguments: { gain: 0.4 },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    where: { name: 'Drums' },
                    quantity: { unit: 'targets', exactly: 1 },
                },
            });
        }
        const context = getProjectContext();
        const revision = captureProjectRevision();
        expect(
            agentRunLifecycle.create({ runId: RUN_ID, request: prompt, mode: 'apply', createdRevision: revision })
        ).toEqual({ status: 'created' });
        agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });

        const before = {
            tracks: structuredClone(trackStore.value),
            undo: structuredClone(undoHistoryStore.value),
            transport: structuredClone(transportStore.value),
            revision,
            confirmations: structuredClone(pendingActionConfirmationStore.value),
            history: structuredClone(aiActionHistoryStore.value),
        };
        const outgoing: string[] = [];
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
            outgoing.push(userMessage);
            expect(userMessage).not.toContain(SECTION_ID);
            const turn = outgoing.length;
            if (turn === 1) {
                const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
                const base = selectCreativeInterpretationCall({
                    catalog,
                    modeId: 'edit',
                    targetObjectIds: mode === 'reference-changed' ? ['drums', 'bass'] : ['drums'],
                    dimensions: ['processing'],
                });
                const schema = schemas.find(
                    (candidate: Parameters<typeof generateToolPlanningOutcome>[2][number]) =>
                        candidate.function.name === base.name
                );
                if (schema === undefined) {
                    throw new Error('Expected actual joint selector.');
                }
                const objective = readMetricPublication(schema).find((candidate) =>
                    candidate.goals.some((goal) => goal.policyId === 'integrated-loudness-match-v1')
                );
                if (objective === undefined) {
                    throw new Error('Expected app-owned loudness criterion.');
                }
                const call = {
                    ...base,
                    id: 'comparison-intake',
                    arguments: {
                        ...base.arguments,
                        answer: null,
                        metricIntent: {
                            kind: 'comparative',
                            uncertainty: 'none',
                            objectives: [
                                {
                                    objectiveId: objective.id,
                                    scopeCandidateId: advertisedAnswerCandidateId([schemas, userMessage], 'drums'),
                                    referenceScopeCandidateId: advertisedAnswerCandidateId(
                                        [schemas, userMessage],
                                        'bass'
                                    ),
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
                const calls: ToolCallResult[] = [
                    {
                        id: 'comparison-preview',
                        name: 'analysis.measure',
                        arguments: {
                            subject: 'preview',
                            scope: { kind: 'tracks', ids: mode === 'one-sided' ? ['drums'] : ['drums', 'bass'] },
                            range: { startBeat: 0, endBeat: 4 },
                            metrics: ['integratedLoudness'],
                            proposal: { schemaVersion: 1, items: previewItems },
                        },
                    },
                ];
                if (mode === 'unsupported-fader') {
                    calls.push({
                        id: 'fader-discovery',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTrackGain'] },
                    });
                }
                return { status: 'complete', toolCalls: calls };
            }
            if (turn === 3) {
                let argumentsValue: Record<string, unknown> = {
                    commands: [],
                    compiledCallIds: ['comparison-preview'],
                };
                let targetIds = ['drums-trim'];
                if (mode === 'unsupported-fader') {
                    argumentsValue = {
                        commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', gain: 0.4 } }],
                    };
                    targetIds = ['drums'];
                } else if (mode === 'reference-changed') {
                    targetIds = ['drums-trim', 'bass-trim'];
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'comparison-proposal',
                            name: 'command.batch.propose',
                            arguments: {
                                ...argumentsValue,
                                plan: metricGoalProviderPlan(prompt, targetIds),
                            },
                        },
                    ],
                };
            }
            throw new Error('Comparison exceeded its scripted route.');
        });
        const planned = await parsePromptToActions({
            prompt,
            context,
            projectRevision: revision,
            streamIdentity: { runId: RUN_ID, requestId: 'comparison-request', cancellationGeneration: 0 },
            onMeasurementAttempt: agentWorkBudget.admitMeasurement(RUN_ID),
        });
        expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
        if (mode === 'unsupported-fader') {
            expect(planned.actions[0]).toMatchObject({
                type: 'setTrackGain',
                payload: { trackId: 'drums', gain: 0.4 },
            });
            expect(planned.applicationToolReceipts).toContainEqual(
                expect.objectContaining({
                    callId: 'comparison-preview',
                    status: 'failure',
                    error: expect.objectContaining({
                        code: 'preview-unavailable',
                        safeMessage:
                            'The proposal could not be previewed: Action cannot execute inside an isolated preview: setTrackGain',
                    }),
                })
            );
        } else {
            expect(planned.actions[0]).toMatchObject({
                type: 'setDeviceParameter',
                payload: { deviceId: 'drums-trim', paramId: 'gain-level', value: 20 * Math.log10(0.5) },
            });
        }
        expect(planned.actions).toHaveLength(mode === 'reference-changed' ? 2 : 1);
        if (mode === 'reference-changed') {
            expect(planned.actions[1]).toMatchObject({
                type: 'setDeviceParameter',
                payload: { deviceId: 'bass-trim', paramId: 'gain-level', value: 20 * Math.log10(0.5) },
            });
        }
        expect(outgoing).toHaveLength(3);
        let expectedRenders = 4;
        if (mode === 'one-sided') {
            expectedRenders = 2;
        }
        if (mode === 'unsupported-fader') {
            expectedRenders = 0;
        }
        expect(renders).toBe(expectedRenders);
        expect({
            tracks: trackStore.value,
            undo: undoHistoryStore.value,
            transport: transportStore.value,
            revision: captureProjectRevision(),
            confirmations: pendingActionConfirmationStore.value,
            history: aiActionHistoryStore.value,
        }).toEqual(before);
        const materialized = materializePromptCommandPlan({
            userText: prompt,
            runId: RUN_ID,
            assistantMessageId: 'comparison-assistant',
            interactionMode: 'apply',
            trustCeiling: undefined,
            resume: undefined,
            onResumedPlanAccepted: undefined,
            projectRevision: revision,
            context,
            result: {
                ...planned,
                requiresConfirmation: confirmation || planned.requiresConfirmation,
                planningOutcome: { kind: 'proposal' },
            },
            actionLabels: planned.actions.map((action) => action.type),
            protectedTargetIds: [],
        });
        if (materialized.status !== 'prepared') {
            await materialized.completion;
            throw new Error('The actual comparison plan must remain visible.');
        }
        const compiled = materialized.compiledActionExecution;
        const state = metricGoalStateCodec(compiled.metricGoalState);
        expect(state?.authorities[0]?.goals[0]).toMatchObject({
            targetIds: ['drums'],
            referenceTargetIds: ['bass'],
            range: { sectionId: SECTION_ID, startBeat: 0, endBeat: 4 },
            tolerance: 0.1,
        });
        if (mode === 'unsupported-fader') {
            expect(state?.proofs).toHaveLength(0);
        } else {
            expect(state?.proofs[0]?.preview.range.sectionId).toBe(SECTION_ID);
        }
        const evaluation = evaluateMetricGoalAdmission({
            state,
            commandBatch: compiled.commandBatch,
            currentRevision: revision,
        });
        if (!matched) {
            expect(evaluation).toMatchObject({
                status: 'blocked',
                failure: mode === 'reference-changed' ? 'out-of-tolerance' : 'incomparable',
            });
            expect(compiled.requiresConfirmation).toBe(true);
            if (mode === 'reference-changed') {
                if (compiled.agentApproval === null) {
                    throw new Error('Expected approval');
                }
                chatStore.set({
                    messages: [
                        { id: 'comparison-assistant', role: 'assistant', content: 'Comparison plan', timestamp: 1 },
                    ],
                    isGenerating: false,
                    enableReasoning: true,
                    chatMode: 'prompt',
                });
                const id = persistPromptActionConfirmation({
                    runId: RUN_ID,
                    prompt,
                    assistantMessageId: 'comparison-assistant',
                    actions: planned.actions,
                    actionLabels: planned.actions.map((action) => action.type),
                    commandEnvelopes: compiled.commandEnvelopes,
                    commandBatch: compiled.commandBatch,
                    agentApproval: compiled.agentApproval,
                    metricGoalState: compiled.metricGoalState,
                    affectedIds: ['drums', 'bass'],
                    protectedUnchanged: [],
                    groundingBasis: planned.groundingBasis,
                    executionMode: 'atomic',
                    group: materialized.commandGroup,
                    projectRevision: revision,
                    parsedCommandBatch: materialized.parsedCommandBatch,
                    content: 'Compare Drums with Bass',
                });
                if (id === null) {
                    throw new Error('Expected persisted comparison');
                }
                expect(getAgentApprovalView({ confirmationId: id })?.canConfirm).toBe(false);
                agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'waiting-for-approval' });
                const writesBefore = audio.updateDeviceParam.mock.calls.length;
                const refused = await confirmPendingChatActions({ confirmationId: id });
                expect(refused).toMatchObject({
                    status: 'failed',
                    reason: expect.stringContaining('Actual preview measurements do not satisfy'),
                });
                expect(audio.updateDeviceParam.mock.calls.length).toBe(writesBefore);
                expect(captureProjectRevision()).toBe(revision);
            } else {
                const refused = await executeVersionedCommandBatchEnvelope(compiled.commandBatch);
                expect(refused.status).toBe('rejected');
            }
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
            return;
        }
        expect(evaluation).toMatchObject({
            status: 'verified',
            criteria: [{ unit: 'LUFS', reference: [expect.any(Number)], observed: [expect.any(Number)] }],
        });
        expect(
            Math.abs(evaluation.criteria[0]!.observed[0]! - evaluation.criteria[0]!.reference[0]!)
        ).toBeLessThanOrEqual(0.1);
        if (state === null) {
            throw new Error('Expected actual retained comparison proof.');
        }
        function replaceRecordedProof(): void {
            const stored = readAgentRunState();
            persistAgentRunState({
                ...stored,
                runs: stored.runs.map((run) => {
                    if (run.runId !== RUN_ID || run.plan === null) {
                        return run;
                    }
                    return { ...run, plan: { ...run.plan, metricGoalState: JSON.stringify({ ...state, proofs: [] }) } };
                }),
            });
        }
        if (mode === 'scheduled-fresh-proof') {
            const first = compileAgentActionExecution({
                actions: planned.actions,
                actionCommandGraph: planned.actionCommandGraph,
                actionLabels: planned.actions.map((action) => action.type),
                context,
                intent: prompt,
                projectRevision: revision,
                runId: RUN_ID,
                group: { groupId: 'metric-schedule-first', groupLabel: prompt },
                requiresConfirmation: false,
                metricGoalState: planned.metricGoalState,
                schedulePosition: 1,
            });
            const firstState = metricGoalStateCodec(first.metricGoalState);
            expect(firstState?.binding?.schedulePosition).toBe(1);
            expect(firstState?.proofs).toHaveLength(1);
            expect(
                evaluateMetricGoalAdmission({
                    state: firstState,
                    commandBatch: first.commandBatch,
                    currentRevision: revision,
                })
            ).toMatchObject({ status: 'verified' });
            const next = compileAgentActionExecution({
                actions: planned.actions,
                actionCommandGraph: planned.actionCommandGraph,
                actionLabels: planned.actions.map((action) => action.type),
                context,
                intent: prompt,
                projectRevision: revision,
                runId: RUN_ID,
                group: { groupId: 'metric-schedule-next', groupLabel: prompt },
                requiresConfirmation: false,
                metricGoalState: first.metricGoalState,
                schedulePosition: 2,
            });
            const nextState = metricGoalStateCodec(next.metricGoalState);
            expect(nextState?.authorities).toEqual(firstState?.authorities);
            expect(nextState?.binding?.schedulePosition).toBe(2);
            expect(nextState?.proofs).toEqual([]);
            expect(next.requiresConfirmation).toBe(true);
            expect((await executeVersionedCommandBatchEnvelope(next.commandBatch)).status).toBe('rejected');
            if (nextState === null) {
                throw new Error('Expected the later batch to retain its frozen goal.');
            }
            const refreshed = await prepareMetricGoalPreview({
                state: nextState,
                commandBatch: next.commandBatch,
                context,
                prompt,
                runId: RUN_ID,
            });
            expect(refreshed.state.binding?.schedulePosition).toBe(2);
            expect(refreshed.state.proofs).toHaveLength(1);
            expect(
                evaluateMetricGoalAdmission({
                    state: refreshed.state,
                    commandBatch: next.commandBatch,
                    currentRevision: revision,
                })
            ).toMatchObject({ status: 'verified' });
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
            return;
        }
        if (mode === 'refinement-literal') {
            if (compiled.agentApproval === null) {
                throw new Error('Expected the real comparative confirmation binding.');
            }
            chatStore.set({
                messages: [
                    {
                        id: 'comparison-user',
                        role: 'user',
                        content: prompt,
                        timestamp: 1,
                        projectId: captureProjectIdentity(),
                    },
                    {
                        id: 'comparison-assistant',
                        role: 'assistant',
                        content: 'Comparison plan',
                        timestamp: 2,
                        agentRunId: RUN_ID,
                        projectId: captureProjectIdentity(),
                    },
                ],
                isGenerating: false,
                enableReasoning: true,
                chatMode: 'prompt',
            });
            const originalId = persistPromptActionConfirmation({
                runId: RUN_ID,
                prompt,
                assistantMessageId: 'comparison-assistant',
                actions: planned.actions,
                actionLabels: planned.actions.map((action) => action.type),
                commandEnvelopes: compiled.commandEnvelopes,
                commandBatch: compiled.commandBatch,
                agentApproval: compiled.agentApproval,
                metricGoalState: compiled.metricGoalState,
                affectedIds: ['drums'],
                protectedUnchanged: [],
                groundingBasis: planned.groundingBasis,
                executionMode: 'atomic',
                group: materialized.commandGroup,
                projectRevision: revision,
                parsedCommandBatch: materialized.parsedCommandBatch,
                content: 'Compare Drums with Bass',
            });
            if (originalId === null) {
                throw new Error('Expected the actual original card to be persisted.');
            }
            const thread = readChatThreadContext();
            expect(thread?.pendingProposal?.confirmationId).toBe(originalId);
            const refinedPrompt = 'Set device drums-trim gain-level to -6.020599913279624 over Chorus';
            const refinedRun = 'metric-refinement-run';
            expect(
                agentRunLifecycle.create({
                    runId: refinedRun,
                    request: refinedPrompt,
                    mode: 'apply',
                    createdRevision: revision,
                })
            ).toEqual({ status: 'created' });
            agentRunLifecycle.transitionPhase({ runId: refinedRun, phase: 'planning' });
            let requests = 0;
            vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, message, schemas) => {
                requests += 1;
                if (requests === 1) {
                    return {
                        status: 'complete',
                        toolCalls: literalMetricIntakeTurn(message, schemas).map((call) => ({
                            ...call,
                            id: 'refinement-intake',
                        })),
                    };
                }
                if (requests === 2) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'refinement-discovery',
                                name: 'agent.catalog.discover',
                                arguments: { category: 'command', names: ['setDeviceParameter'] },
                            },
                        ],
                    };
                }
                if (requests === 3) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'refinement-proposal',
                                name: 'command.batch.propose',
                                arguments: {
                                    list: { schemaVersion: 1, items: previewItems },
                                    refines: originalId,
                                    plan: metricGoalProviderPlan(refinedPrompt, ['drums-trim']),
                                },
                            },
                        ],
                    };
                }
                throw new Error('Refinement exceeded its three actual provider turns.');
            });
            const refined = await parsePromptToActions({
                prompt: refinedPrompt,
                context,
                projectRevision: revision,
                thread,
                streamIdentity: { runId: refinedRun, requestId: 'metric-refinement', cancellationGeneration: 0 },
                onMeasurementAttempt: agentWorkBudget.admitMeasurement(refinedRun),
            });
            expect(refined.rejectionReason, JSON.stringify(refined.applicationToolReceipts)).toBeUndefined();
            expect(refined.actions).toHaveLength(1);
            expect(refined.refines).toBe(originalId);
            const admitted = metricGoalStateCodec(refined.metricGoalState);
            expect(admitted?.authorities[0]).toEqual(state.authorities[0]);
            expect(admitted?.authorities[1]).toMatchObject({ kind: 'literal', goals: [] });
            expect(admitted?.proofs).toEqual([]);
            const next = materializePromptCommandPlan({
                userText: refinedPrompt,
                runId: refinedRun,
                assistantMessageId: 'refinement-assistant',
                interactionMode: 'apply',
                trustCeiling: undefined,
                resume: undefined,
                onResumedPlanAccepted: undefined,
                projectRevision: revision,
                context,
                result: { ...refined, planningOutcome: { kind: 'proposal' } },
                actionLabels: refined.actions.map((action) => action.type),
                protectedTargetIds: [],
            });
            if (next.status !== 'prepared' || next.compiledActionExecution.agentApproval === null) {
                throw new Error('Expected a visible unverified refined comparison.');
            }
            const execution = next.compiledActionExecution;
            expect(execution.requiresConfirmation).toBe(true);
            expect(
                evaluateMetricGoalAdmission({
                    state: metricGoalStateCodec(execution.metricGoalState),
                    commandBatch: execution.commandBatch,
                })
            ).toMatchObject({ status: 'blocked' });
            const nextId = persistPromptActionConfirmation({
                runId: refinedRun,
                prompt: refinedPrompt,
                assistantMessageId: 'refinement-assistant',
                actions: refined.actions,
                actionLabels: refined.actions.map((action) => action.type),
                commandEnvelopes: execution.commandEnvelopes,
                commandBatch: execution.commandBatch,
                agentApproval: next.compiledActionExecution.agentApproval,
                metricGoalState: execution.metricGoalState,
                affectedIds: ['drums'],
                protectedUnchanged: [],
                groundingBasis: refined.groundingBasis,
                executionMode: 'atomic',
                group: next.commandGroup,
                projectRevision: revision,
                parsedCommandBatch: next.parsedCommandBatch,
                content: 'Refined comparison',
                supersedes: originalId,
            });
            if (nextId === null) {
                throw new Error('Expected the real refined proposal to be retained.');
            }
            expect(getAgentApprovalView({ confirmationId: nextId })?.canConfirm).toBe(false);
            const refreshed = await reproposePendingChatActions({ confirmationId: nextId });
            expect(refreshed).toMatchObject({ status: 'reproposed' });
            if (refreshed.status !== 'reproposed') {
                throw new Error('Expected actual fresh comparison measurements for the refined batch.');
            }
            expect(getAgentApprovalView({ confirmationId: refreshed.confirmationId })?.canConfirm).toBe(true);
            expect(requests).toBe(3);
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
            return;
        }
        if (confirmation) {
            if (compiled.agentApproval === null) {
                throw new Error('Expected a real explicit approval binding.');
            }
            chatStore.set({
                messages: [{ id: 'comparison-assistant', role: 'assistant', content: 'Comparison plan', timestamp: 1 }],
                isGenerating: false,
                enableReasoning: true,
                chatMode: 'prompt',
            });
            const entered = Promise.withResolvers<void>();
            const resume = Promise.withResolvers<void>();
            const resourceRelease = vi.fn();
            const proposed = proposePendingActionConfirmation({
                id: 'comparison-confirmation',
                runId: RUN_ID,
                prompt,
                assistantMessageId: 'comparison-assistant',
                actions: planned.actions,
                actionLabels: planned.actions.map((action) => action.type),
                commandBatch: compiled.commandBatch,
                commandEnvelopes: compiled.commandEnvelopes,
                agentApproval: compiled.agentApproval,
                metricGoalState: compiled.metricGoalState,
                projectRevision: revision,
                executionMode: 'atomic',
                groupId: materialized.commandGroup.groupId,
                groupLabel: materialized.commandGroup.groupLabel,
                resourceLease: {
                    bytes: 1,
                    prepareForCommit: async () => {
                        entered.resolve();
                        await resume.promise;
                    },
                    release: resourceRelease,
                },
            });
            expect(proposed?.id).toBe('comparison-confirmation');
            agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'waiting-for-approval' });
            const writesBefore = audio.updateDeviceParam.mock.calls.length;
            const execution = confirmPendingChatActions({ confirmationId: 'comparison-confirmation' });
            await Promise.race([
                entered.promise,
                execution.then((result) => {
                    throw new Error(
                        `Execution never reached actual awaited resource preparation: ${JSON.stringify(result)}`
                    );
                }),
            ]);
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
            if (mode === 'confirmation-replaced-proof') {
                replaceRecordedProof();
            }
            resume.resolve();
            const outcome = await execution;
            if (mode === 'confirmation-replaced-proof') {
                expect(outcome).toMatchObject({
                    status: 'invalidated',
                    reason: 'The project changed after this proposal was created. Review and submit the command again.',
                });
                expect(audio.updateDeviceParam.mock.calls.length).toBe(writesBefore);
                expect(trackStore.value).toEqual(before.tracks);
                expect(undoHistoryStore.value).toEqual(before.undo);
                expect(transportStore.value).toEqual(before.transport);
                expect(captureProjectRevision()).toBe(revision);
            } else {
                expect(outcome).toMatchObject({ status: 'executed' });
                expect(
                    trackStore.value?.tracks
                        .find((track) => track.id === 'drums')
                        ?.devices.find((device) => device.id === 'drums-trim')?.parameterValues['gain-level']
                ).toBe(20 * Math.log10(0.5));
                expect(await undo()).toMatchObject({ headConsumed: true });
                expect(
                    trackStore.value?.tracks
                        .find((track) => track.id === 'drums')
                        ?.devices.find((device) => device.id === 'drums-trim')?.parameterValues['gain-level']
                ).toBe(0);
            }
            return;
        }
        if (mode === 'direct-replaced-proof') {
            const entered = Promise.withResolvers<void>();
            const resume = Promise.withResolvers<void>();
            const digest = crypto.subtle.digest.bind(crypto.subtle);
            let held = false;
            vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
                if (!held) {
                    held = true;
                    entered.resolve();
                    await resume.promise;
                }
                return digest(algorithm, data);
            });
            const writesBefore = audio.updateDeviceParam.mock.calls.length;
            const execution = executeVersionedCommandBatchEnvelope(compiled.commandBatch);
            await Promise.race([
                entered.promise,
                execution.then((result) => {
                    throw new Error(
                        `Direct execution never awaited its actual content hash: ${JSON.stringify(result)}`
                    );
                }),
            ]);
            replaceRecordedProof();
            resume.resolve();
            expect(await execution).toMatchObject({
                status: 'rejected',
                reason: expect.stringContaining('metric goal or proof changed'),
            });
            expect(audio.updateDeviceParam.mock.calls.length).toBe(writesBefore);
            expect(trackStore.value).toEqual(before.tracks);
            expect(undoHistoryStore.value).toEqual(before.undo);
            expect(transportStore.value).toEqual(before.transport);
            expect(captureProjectRevision()).toBe(revision);
            return;
        }
        const invalidProofs = [
            [
                'wrong-scope',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: { ...proof.preview, scope: { kind: 'buses', ids: ['drums', 'bass'] } },
                }),
            ],
            [
                'wrong-range',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: { ...proof.preview, range: { ...proof.preview.range, endBeat: 8 } },
                }),
            ],
            [
                'stale-revision',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: { ...proof.preview, revision: 'another-revision' },
                }),
            ],
            ['missing-receipt', (proof: (typeof state.proofs)[number]) => ({ ...proof, receiptDigest: '' })],
            [
                'missing-artifact',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: { ...proof.preview, provenance: { ...proof.preview.provenance, targets: [] } },
                }),
            ],
            [
                'wrong-run',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        provenance: { ...proof.preview.provenance, runId: 'another-run' },
                    },
                }),
            ],
            [
                'wrong-unit',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        targets: proof.preview.targets.map((target) => ({
                            ...target,
                            preview: {
                                integratedLoudness: {
                                    status: 'measured',
                                    metricVersion: 1,
                                    unit: 'hertz',
                                    value: -12,
                                    confidence: 'estimated',
                                },
                            },
                        })),
                    },
                }),
            ],
            [
                'wrong-version',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        targets: proof.preview.targets.map((target) => ({
                            ...target,
                            preview: {
                                integratedLoudness: {
                                    status: 'measured',
                                    metricVersion: 2,
                                    unit: 'LUFS',
                                    value: -12,
                                    confidence: 'estimated',
                                },
                            },
                        })),
                    },
                }),
            ],
            [
                'map-value',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        targets: proof.preview.targets.map((target) => ({
                            ...target,
                            preview: {
                                integratedLoudness: {
                                    status: 'measured',
                                    metricVersion: 1,
                                    unit: 'LUFS',
                                    value: { mean: -12 },
                                    confidence: 'estimated',
                                },
                            },
                        })),
                    },
                }),
            ],
            [
                'nonfinite-value',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        targets: proof.preview.targets.map((target) => ({
                            ...target,
                            preview: {
                                integratedLoudness: {
                                    status: 'measured',
                                    metricVersion: 1,
                                    unit: 'LUFS',
                                    value: Number.POSITIVE_INFINITY,
                                    confidence: 'estimated',
                                },
                            },
                        })),
                    },
                }),
            ],
            [
                'unavailable-value',
                (proof: (typeof state.proofs)[number]) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        targets: proof.preview.targets.map((target) => ({
                            ...target,
                            preview: { integratedLoudness: { status: 'unavailable', reason: 'No measurement.' } },
                        })),
                    },
                }),
            ],
        ] as const;
        for (const [label, projectProof] of invalidProofs) {
            const rejected = compileAgentActionExecution({
                actions: planned.actions,
                actionLabels: ['Match Drums loudness'],
                context,
                group: { groupId: `invalid-${label}`, groupLabel: prompt },
                intent: prompt,
                projectRevision: revision,
                requiresConfirmation: false,
                runId: RUN_ID,
                metricGoalState: JSON.stringify({
                    ...state,
                    proofs: state.proofs.map((proof) => projectProof(proof)),
                }),
            });
            expect(rejected.requiresConfirmation, label).toBe(true);
            expect((await executeVersionedCommandBatchEnvelope(rejected.commandBatch)).status, label).toBe('rejected');
            expect(trackStore.value, label).toEqual(before.tracks);
            expect(undoHistoryStore.value, label).toEqual(before.undo);
        }
        expect(compiled.requiresConfirmation).toBe(false);
        const committed = await executeVersionedCommandBatchEnvelope(compiled.commandBatch);
        expect(committed.status).toBe('committed');
        expect(
            trackStore.value?.tracks
                .find((track) => track.id === 'drums')
                ?.devices.find((device) => device.id === 'drums-trim')?.parameterValues['gain-level']
        ).toBe(20 * Math.log10(0.5));
        expect(await undo()).toMatchObject({ headConsumed: true });
        expect(
            trackStore.value?.tracks
                .find((track) => track.id === 'drums')
                ?.devices.find((device) => device.id === 'drums-trim')?.parameterValues['gain-level']
        ).toBe(0);
    });
});

describe('compatible three-kind comparison inside the existing turn ceiling', () => {
    it('earns exactly five turns and requires actual track, bus and full-preview master observations', async () => {
        configureOfflinePpqEndpointProjection({ project: projectPpqEndpoints, resolveTempoAtBeat });
        const live = trackStore.value;
        if (live === null) {
            throw new Error('Expected the real project fixture.');
        }
        trackStore.set({
            ...live,
            tracks: [
                ...live.tracks.map((track) => {
                    if (track.id === 'drums') {
                        return {
                            ...track,
                            devices: [
                                ...track.devices,
                                {
                                    id: 'drums-tone',
                                    name: 'Drums Tone',
                                    type: 'builtin-eq',
                                    bypassed: false,
                                    parameterValues: { 'eq-high-freq': 1000, 'eq-high-gain': 0 },
                                },
                            ],
                        };
                    }
                    if (track.id === 'bass') {
                        return { ...track, outputId: 'reference-bus' };
                    }
                    return track;
                }),
                createTrack({ id: 'reference-bus', name: 'Reference Bus', kind: 'bus' }),
            ],
        });
        flushAutomergeStorageWrites();
        const prompt = 'Make Drums brighter than Reference Bus and the Master output over Chorus';
        const runId = 'cross-kind-comparison';
        expect(
            agentRunLifecycle.create({
                runId,
                request: prompt,
                mode: 'apply',
                createdRevision: captureProjectRevision(),
            })
        ).toEqual({ status: 'created' });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
        const context = getProjectContext();
        const revision = captureProjectRevision();
        const before = {
            tracks: structuredClone(trackStore.value),
            undo: structuredClone(undoHistoryStore.value),
            transport: structuredClone(transportStore.value),
            revision,
        };
        const starts: string[] = [];
        type Tracks = NonNullable<typeof trackStore.value>['tracks'];
        function components(tracks: readonly Tracks[number][]) {
            const drums = tracks.find((track) => track.id === 'drums');
            const bass = tracks.find((track) => track.id === 'bass');
            if (drums === undefined || bass === undefined) {
                throw new Error('Expected actual mix contributors.');
            }
            const highDb =
                drums.devices.find((device) => device.id === 'drums-tone')?.parameterValues['eq-high-gain'] ?? 0;
            return { low: 0.2 * drums.gain, high: 0.2 * drums.gain * 10 ** (highDb / 20), bass: 0.5 * bass.gain };
        }
        function mix(tracks: readonly Tracks[number][], seconds: number) {
            const value = components(tracks);
            return metricGoalAudioBuffer(
                (time) =>
                    value.low * Math.sin(2 * Math.PI * 150 * time) +
                    value.high * Math.sin(2 * Math.PI * 2000 * time) +
                    value.bass * Math.sin(2 * Math.PI * 1200 * time),
                seconds
            );
        }
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            starts.push(input.targetTrackId);
            const tracks = input.source?.project.tracks?.tracks ?? trackStore.value?.tracks ?? [];
            const values = components(tracks);
            if (input.targetTrackId === 'reference-bus') {
                return metricGoalAudioBuffer(
                    (time) => values.bass * Math.sin(2 * Math.PI * 1200 * time),
                    (input.endBeat - input.startBeat) / 2
                );
            }
            if (input.targetTrackId !== 'drums') {
                throw new Error('Unexpected isolated comparison target.');
            }
            return metricGoalAudioBuffer(
                (time) =>
                    values.low * Math.sin(2 * Math.PI * 150 * time) + values.high * Math.sin(2 * Math.PI * 2000 * time),
                (input.endBeat - input.startBeat) / 2
            );
        });
        audio.renderOffline.mockImplementation(async (options: Parameters<typeof captureOfflineRenderInput>[0]) => {
            starts.push('master');
            return mix(trackStore.value?.tracks ?? [], options.durationBeats / 2);
        });
        audio.renderOfflineInput.mockImplementation(async (input: Parameters<typeof renderOfflineInput>[0]) => {
            starts.push('master');
            return mix(input.renderContext.tracks?.tracks ?? [], input.outputDurationSeconds);
        });
        const proposal = {
            schemaVersion: 1,
            items: [
                {
                    id: 'brighten-drums',
                    name: 'setDeviceParameter',
                    arguments: { paramId: 'eq-high-gain', value: 6 },
                    selector: {
                        targetArgument: 'deviceId',
                        entity: 'device',
                        where: { name: 'Drums Tone' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ],
        };
        const observedTurns: number[] = [];
        vi.mocked(generateToolPlanningOutcome).mockImplementation(
            async (_system, userMessage, schemas, _signal, _prompt, _observer, _identity, _admission, directive) => {
                const turn = observedTurns.length + 1;
                observedTurns.push(turn);
                expect(userMessage).not.toContain(SECTION_ID);
                if (turn === 1) {
                    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
                    const base = selectCreativeInterpretationCall({
                        catalog,
                        modeId: 'edit',
                        targetObjectIds: ['drums'],
                        dimensions: ['processing'],
                    });
                    const schema = schemas.find(
                        (candidate: Parameters<typeof generateToolPlanningOutcome>[2][number]) =>
                            candidate.function.name === base.name
                    );
                    if (schema === undefined) {
                        throw new Error('Missing published joint intake.');
                    }
                    const objective = readMetricPublication(schema).find((candidate) =>
                        candidate.goals.some((goal) => goal.relation === 'greater-than-current')
                    );
                    if (objective === undefined) {
                        throw new Error('Missing actual comparison policy.');
                    }
                    const target = advertisedAnswerCandidateId([schemas, userMessage], 'drums');
                    const range = advertisedAnswerCandidateId([schemas, userMessage], 'Chorus', 'ranges');
                    const call = {
                        ...base,
                        id: 'cross-kind-intake',
                        arguments: {
                            ...base.arguments,
                            answer: null,
                            metricIntent: {
                                kind: 'comparative',
                                uncertainty: 'none',
                                objectives: ['reference-bus', 'master'].map((id) => ({
                                    objectiveId: objective.id,
                                    scopeCandidateId: target,
                                    referenceScopeCandidateId: advertisedAnswerCandidateId([schemas, userMessage], id),
                                    rangeCandidateId: range,
                                })),
                            },
                        },
                    };
                    expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
                    return { status: 'complete', toolCalls: [call] };
                }
                if (turn >= 2 && turn <= 4) {
                    let scope: { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: string[] } = {
                        kind: 'tracks',
                        ids: ['drums'],
                    };
                    if (turn === 3) {
                        scope = { kind: 'buses', ids: ['reference-bus'] };
                    }
                    if (turn === 4) {
                        scope = { kind: 'master' };
                    }
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: `cross-kind-preview-${String(turn)}`,
                                name: 'analysis.measure',
                                arguments: {
                                    subject: 'preview',
                                    scope,
                                    range: { startBeat: 0, endBeat: 4 },
                                    metrics: ['spectralCentroid'],
                                    proposal,
                                },
                            },
                        ],
                    };
                }
                expect(turn).toBe(5);
                expect(directive).toMatchObject({ mode: 'required' });
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'cross-kind-proposal',
                            name: 'command.batch.propose',
                            arguments: { commands: [], compiledCallIds: ['cross-kind-preview-2'] },
                        },
                    ],
                };
            }
        );
        const planned = await parsePromptToActions({
            prompt,
            context,
            projectRevision: revision,
            streamIdentity: { runId, requestId: 'cross-kind-request', cancellationGeneration: 0 },
            onMeasurementAttempt: agentWorkBudget.admitMeasurement(runId),
        });
        expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
        expect(observedTurns).toEqual([1, 2, 3, 4, 5]);
        expect(starts).toEqual(['drums', 'drums', 'reference-bus', 'reference-bus', 'master', 'master']);
        expect(planned.actions).toHaveLength(1);
        const compiled = compileAgentActionExecution({
            actions: planned.actions,
            actionLabels: ['Brighten Drums'],
            context,
            group: { groupId: 'cross-kind-group', groupLabel: prompt },
            intent: prompt,
            projectRevision: revision,
            requiresConfirmation: false,
            runId,
            metricGoalState: planned.metricGoalState,
        });
        const state = metricGoalStateCodec(compiled.metricGoalState);
        if (state === null) {
            throw new Error('Expected actual retained metric state.');
        }
        expect(state.proofs).toHaveLength(3);
        expect(new Set(state.proofs.map((proof) => proof.preview.batchContentHash)).size).toBe(1);
        expect(
            evaluateMetricGoalAdmission({ state, commandBatch: compiled.commandBatch, currentRevision: revision })
        ).toMatchObject({
            status: 'verified',
            criteria: [
                { referenceTargetIds: ['reference-bus'], unit: 'hertz' },
                { referenceTargetIds: ['master'], unit: 'hertz' },
            ],
        });
        for (const missingKind of ['buses', 'master']) {
            const incomplete = {
                ...state,
                proofs: state.proofs.filter((proof) => proof.preview.scope.kind !== missingKind),
            };
            expect(
                evaluateMetricGoalAdmission({
                    state: incomplete,
                    commandBatch: compiled.commandBatch,
                    currentRevision: revision,
                })
            ).toMatchObject({ status: 'blocked', failure: 'incomparable' });
        }
        expect({
            tracks: trackStore.value,
            undo: undoHistoryStore.value,
            transport: transportStore.value,
            revision: captureProjectRevision(),
        }).toEqual(before);
    });
});

type LiteralCommand = { name: string; arguments: Record<string, unknown> };

/** Plans one literal request through the scripted provider and persists its actual approval card. */
async function proposeLiteralCard(input: {
    prompt: string;
    runId: string;
    commands: readonly LiteralCommand[];
    refines?: string;
    targetIds?: readonly string[];
}): Promise<{ confirmationId: string; metricGoalState: string | undefined }> {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const thread = input.refines === undefined ? null : readChatThreadContext();
    if (input.refines !== undefined) {
        expect(thread?.pendingProposal?.confirmationId).toBe(input.refines);
    }
    expect(
        agentRunLifecycle.create({
            runId: input.runId,
            request: input.prompt,
            mode: 'apply',
            createdRevision: revision,
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'planning' });
    const proposalArguments: Record<string, unknown> = {
        commands: input.commands,
        plan: metricGoalProviderPlan(input.prompt, input.targetIds ?? ['drums']),
    };
    if (input.refines !== undefined) {
        proposalArguments.refines = input.refines;
    }
    let turns = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        turns += 1;
        if (turns === 1) {
            return {
                status: 'complete',
                toolCalls: literalMetricIntakeTurn(userMessage, schemas).map((call) => ({
                    ...call,
                    id: `${input.runId}-intake`,
                })),
            };
        }
        if (turns === 2) {
            return {
                status: 'complete',
                toolCalls: [
                    {
                        id: `${input.runId}-discovery`,
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: input.commands.map((command) => command.name) },
                    },
                ],
            };
        }
        if (turns === 3) {
            return {
                status: 'complete',
                toolCalls: [
                    {
                        id: `${input.runId}-proposal`,
                        name: 'command.batch.propose',
                        arguments: proposalArguments,
                    },
                ],
            };
        }
        throw new Error('The literal request exceeded its three scripted provider turns.');
    });
    const planned = await parsePromptToActions({
        prompt: input.prompt,
        context,
        projectRevision: revision,
        thread,
        streamIdentity: { runId: input.runId, requestId: `${input.runId}-request`, cancellationGeneration: 0 },
        onMeasurementAttempt: agentWorkBudget.admitMeasurement(input.runId),
    });
    expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
    expect(planned.refines).toBe(input.refines);
    const assistantMessageId = `${input.runId}-assistant`;
    const materialized = materializePromptCommandPlan({
        userText: input.prompt,
        runId: input.runId,
        assistantMessageId,
        interactionMode: 'apply',
        trustCeiling: undefined,
        resume: undefined,
        onResumedPlanAccepted: undefined,
        projectRevision: revision,
        context,
        result: { ...planned, requiresConfirmation: true, planningOutcome: { kind: 'proposal' } },
        actionLabels: planned.actions.map((action) => action.type),
        protectedTargetIds: [],
    });
    if (materialized.status !== 'prepared' || materialized.compiledActionExecution.agentApproval === null) {
        throw new Error('Expected a persisted approval card for the literal request.');
    }
    const compiled = materialized.compiledActionExecution;
    chatStore.set({
        messages: [
            {
                id: `${input.runId}-user`,
                role: 'user',
                content: input.prompt,
                timestamp: 1,
                projectId: captureProjectIdentity(),
            },
            {
                id: assistantMessageId,
                role: 'assistant',
                content: 'Literal plan',
                timestamp: 2,
                agentRunId: input.runId,
                projectId: captureProjectIdentity(),
            },
        ],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
    const confirmationId = persistPromptActionConfirmation({
        runId: input.runId,
        prompt: input.prompt,
        assistantMessageId,
        actions: planned.actions,
        actionLabels: planned.actions.map((action) => action.type),
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: compiled.agentApproval,
        metricGoalState: compiled.metricGoalState,
        affectedIds: ['drums'],
        protectedUnchanged: [],
        groundingBasis: planned.groundingBasis,
        executionMode: 'atomic',
        group: materialized.commandGroup,
        projectRevision: revision,
        parsedCommandBatch: materialized.parsedCommandBatch,
        content: input.prompt,
        supersedes: input.refines ?? null,
    });
    if (confirmationId === null) {
        throw new Error('The actual pending confirmation was not persisted.');
    }
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'waiting-for-approval' });
    return { confirmationId, metricGoalState: compiled.metricGoalState };
}

function drumsGain(): number | undefined {
    return trackStore.value?.tracks.find((track) => track.id === 'drums')?.gain;
}

function introGain(): number | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === 'intro')?.gain;
}

/** Drums carrying one audio clip whose cached buffer a LUFS normalization can actually measure. */
function configureIntroClipProject(label: string): void {
    configureMetricGoalProject({
        label,
        tracks: [
            {
                ...createTrack({ id: 'drums', name: 'Drums', kind: 'audio' }),
                clips: [
                    {
                        id: 'intro',
                        trackId: 'drums',
                        name: 'Intro',
                        type: 'audio',
                        audioBufferId: 'intro-buffer',
                        startBeat: 0,
                        endBeat: 4,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#ffffff',
                        locked: false,
                        muted: false,
                    },
                ],
            },
        ],
        sections: [],
    });
    cacheAudioBuffer({ buffer: sine(0.5, 2), bufferId: 'intro-buffer' });
}

const NORMALIZE_INTRO_14 = 'Normalize Intro clip to -14 LUFS';

function normalizeIntro(targetDb: number): LiteralCommand {
    return { name: 'normalizeClip', arguments: { clipId: 'intro', mode: 'lufs', targetDb } };
}

function raiseDrums(deltaDb: number): LiteralCommand {
    return { name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb } };
}

const TRUE_PEAK_REQUEST = 'Raise Drums by 1 dB while keeping true peak below -1 dBTP';

describe('request figures across a refinement chain', () => {
    it.each(['-1 dBTP', '-1 dbtp', '-1 DBTP'])(
        'blocks Confirm on an unaccounted %s figure in any case',
        async (token) => {
            const before = structuredClone(trackStore.value);
            const card = await proposeLiteralCard({
                prompt: `Raise Drums by 1 dB while keeping true peak below ${token}`,
                runId: 'literal-figure-case',
                commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 1 } }],
            });
            expect(getAgentApprovalView({ confirmationId: card.confirmationId })?.canConfirm).toBe(false);
            expect(await confirmPendingChatActions({ confirmationId: card.confirmationId })).toMatchObject({
                status: 'failed',
                reason: expect.stringContaining(token),
            });
            expect(trackStore.value).toEqual(before);
            expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        }
    );

    it('keeps the refined request’s unaccounted true-peak figure blocking the replacement card', async () => {
        const before = structuredClone(trackStore.value);
        const original = await proposeLiteralCard({
            prompt: 'Raise Drums by 1 dB while keeping true peak below -1 dBTP',
            runId: 'literal-figure-original',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 1 } }],
        });
        expect(getAgentApprovalView({ confirmationId: original.confirmationId })?.canConfirm).toBe(false);
        const refined = await proposeLiteralCard({
            prompt: 'Raise Drums by 2 dB instead',
            runId: 'literal-figure-refinement',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 2 } }],
            refines: original.confirmationId,
        });
        expect(metricGoalStateCodec(refined.metricGoalState)?.refinedRequests).toEqual([
            'Raise Drums by 1 dB while keeping true peak below -1 dBTP',
        ]);
        expect(getAgentApprovalView({ confirmationId: refined.confirmationId })?.canConfirm).toBe(false);
        expect(await confirmPendingChatActions({ confirmationId: refined.confirmationId })).toMatchObject({
            status: 'failed',
            reason: expect.stringContaining('-1 dBTP'),
        });
        expect(drumsGain()).toBe(0.8);
        expect(trackStore.value).toEqual(before);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(audio.renderOffline).not.toHaveBeenCalled();
    });

    it('still confirms a refinement whose batch keeps accounting for the refined request’s figure', async () => {
        configureMetricGoalProject({
            label: 'literal figure kept',
            tracks: [createTrack({ id: 'drums', name: 'Drums 100 Hz', kind: 'audio' })],
            sections: [],
        });
        const original = await proposeLiteralCard({
            prompt: 'Raise "Drums 100 Hz" by 1 dB',
            runId: 'literal-name-original',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 1 } }],
        });
        expect(getAgentApprovalView({ confirmationId: original.confirmationId })?.canConfirm).toBe(true);
        const refined = await proposeLiteralCard({
            prompt: 'Make it 2 dB',
            runId: 'literal-name-refinement',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 2 } }],
            refines: original.confirmationId,
        });
        expect(metricGoalStateCodec(refined.metricGoalState)?.refinedRequests).toEqual([
            'Raise "Drums 100 Hz" by 1 dB',
        ]);
        expect(getAgentApprovalView({ confirmationId: refined.confirmationId })?.canConfirm).toBe(true);
        expect(await confirmPendingChatActions({ confirmationId: refined.confirmationId })).toEqual({
            status: 'executed',
        });
        expect(drumsGain()).toBeGreaterThan(0.8);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('lets a restated figure in the same unit replace the refined request’s figure', async () => {
        configureIntroClipProject('literal figure replaced');
        const original = await proposeLiteralCard({
            prompt: NORMALIZE_INTRO_14,
            runId: 'literal-unit-original',
            commands: [normalizeIntro(-14)],
            targetIds: ['intro'],
        });
        expect(getAgentApprovalView({ confirmationId: original.confirmationId })?.canConfirm).toBe(true);
        const refined = await proposeLiteralCard({
            prompt: 'Normalize Intro clip to -16 LUFS',
            runId: 'literal-unit-refinement',
            commands: [normalizeIntro(-16)],
            refines: original.confirmationId,
            targetIds: ['intro'],
        });
        expect(metricGoalStateCodec(refined.metricGoalState)?.refinedRequests).toEqual([NORMALIZE_INTRO_14]);
        expect(getAgentApprovalView({ confirmationId: refined.confirmationId })?.canConfirm).toBe(true);
        expect(await confirmPendingChatActions({ confirmationId: refined.confirmationId })).toEqual({
            status: 'executed',
        });
        const normalizedTo16 = introGain();
        expect(normalizedTo16).not.toBe(1);
        expect(normalizeClip('intro', 'lufs', -14)).toBe(true);
        const normalizedTo14 = introGain();
        if (normalizedTo16 === undefined || normalizedTo14 === undefined) {
            throw new Error('Expected the Intro clip to remain in the project.');
        }
        expect(normalizedTo16 / normalizedTo14).toBeCloseTo(10 ** (-2 / 20), 6);
    });

    it('does not let a figure in another unit replace the refined request’s true-peak figure', async () => {
        configureIntroClipProject('literal figure other unit');
        const before = structuredClone(trackStore.value);
        const original = await proposeLiteralCard({
            prompt: TRUE_PEAK_REQUEST,
            runId: 'literal-other-unit-original',
            commands: [raiseDrums(1)],
        });
        const refined = await proposeLiteralCard({
            prompt: NORMALIZE_INTRO_14,
            runId: 'literal-other-unit-refinement',
            commands: [raiseDrums(1), normalizeIntro(-14)],
            refines: original.confirmationId,
            targetIds: ['drums', 'intro'],
        });
        expect(getAgentApprovalView({ confirmationId: refined.confirmationId })?.canConfirm).toBe(false);
        expect(await confirmPendingChatActions({ confirmationId: refined.confirmationId })).toMatchObject({
            status: 'failed',
            reason: expect.stringContaining('-1 dBTP'),
        });
        expect(trackStore.value).toEqual(before);
    });

    it('carries the true-peak figure across a second refinement', async () => {
        const before = structuredClone(trackStore.value);
        const original = await proposeLiteralCard({
            prompt: TRUE_PEAK_REQUEST,
            runId: 'literal-chain-original',
            commands: [raiseDrums(1)],
        });
        const first = await proposeLiteralCard({
            prompt: 'Raise Drums by 2 dB instead',
            runId: 'literal-chain-first',
            commands: [raiseDrums(2)],
            refines: original.confirmationId,
        });
        const second = await proposeLiteralCard({
            prompt: 'Raise Drums by 3 dB instead',
            runId: 'literal-chain-second',
            commands: [raiseDrums(3)],
            refines: first.confirmationId,
        });
        expect(metricGoalStateCodec(second.metricGoalState)?.refinedRequests).toEqual([
            TRUE_PEAK_REQUEST,
            'Raise Drums by 2 dB instead',
        ]);
        expect(getAgentApprovalView({ confirmationId: second.confirmationId })?.canConfirm).toBe(false);
        expect(await confirmPendingChatActions({ confirmationId: second.confirmationId })).toMatchObject({
            status: 'failed',
            reason: expect.stringContaining('-1 dBTP'),
        });
        expect(drumsGain()).toBe(0.8);
        expect(trackStore.value).toEqual(before);
    });

    it('decodes a persisted metric state with or without the refined requests it carries', () => {
        const persisted = {
            schemaVersion: 1,
            authorities: [],
            steps: [],
            proofs: [],
            binding: null,
        };
        expect(metricGoalStateCodec(JSON.stringify(persisted))).toEqual(persisted);
        expect(metricGoalStateCodec(JSON.stringify(persisted))?.refinedRequests).toBeUndefined();
        const refined = {
            ...persisted,
            refinedRequests: ['Raise Drums by 1 dB while keeping true peak below -1 dBTP'],
        };
        expect(metricGoalStateCodec(JSON.stringify(refined))).toEqual(refined);
        expect(metricGoalStateCodec(JSON.stringify({ ...persisted, refinedRequests: [1] }))).toBeNull();
        expect(metricGoalStateCodec(JSON.stringify({ ...persisted, refinedRequests: 'Raise Drums' }))).toBeNull();
    });
});
