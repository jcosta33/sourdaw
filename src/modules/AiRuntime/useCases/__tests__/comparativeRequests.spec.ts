import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeVersionedCommandBatchEnvelope, undo } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { aiActionHistoryStore } from '../../stores/aiActionHistoryStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';

import { advertisedAnswerCandidateId } from './answerWireFixture';
import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import {
    configureMetricGoalProject,
    resetMetricGoalProject,
    metricGoalAudioBuffer,
    readMetricPublication,
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
                ...createTrack({ id: 'drums', name: 'Drums', kind: 'audio', gain: 0.8 }),
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
                ...createTrack({ id: 'bass', name: 'Bass', kind: 'audio', gain: 0.4 }),
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
    it.each(['matched', 'reference-changed', 'one-sided', 'unsupported-fader'] as const)(
        'verifies both real named subjects for %s instead of substituting reference baseline',
        async (mode) => {
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
                    const schema = schemas.find((candidate) => candidate.function.name === base.name);
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
                    if (mode === 'unsupported-fader') {
                        argumentsValue = {
                            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', gain: 0.4 } }],
                        };
                    }
                    return {
                        status: 'complete',
                        toolCalls: [
                            { id: 'comparison-proposal', name: 'command.batch.propose', arguments: argumentsValue },
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
            const compiled = compileAgentActionExecution({
                actions: planned.actions,
                actionLabels: planned.actions.map((action) => action.type),
                context,
                group: { groupId: 'comparison-group', groupLabel: prompt },
                intent: prompt,
                projectRevision: revision,
                requiresConfirmation: false,
                runId: RUN_ID,
                metricGoalState: planned.metricGoalState,
            });
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
            if (mode !== 'matched') {
                expect(evaluation).toMatchObject({
                    status: 'blocked',
                    failure: mode === 'reference-changed' ? 'out-of-tolerance' : 'incomparable',
                });
                expect(compiled.requiresConfirmation).toBe(true);
                const refused = await executeVersionedCommandBatchEnvelope(compiled.commandBatch);
                expect(refused.status).toBe('rejected');
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
        }
    );
});
