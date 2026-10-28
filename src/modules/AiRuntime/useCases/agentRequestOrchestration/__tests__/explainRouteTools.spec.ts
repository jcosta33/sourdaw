import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearAgentMeasurementArtifacts, getAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { capabilityStore } from '#/modules/BrowserAi/stores';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    getCrdtDocIds,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectStore, defaultProjectStoreState } from '#/modules/Project/stores';
import * as projectReads from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from '../../__tests__/aiWorkflowCommandPreflightFixture';
import {
    advertisedAnswerIntake,
    advertisedAnswerCandidateId,
    structuralAnswerArguments,
} from '../../__tests__/answerWireFixture';
import { AiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../../models/AgentResourceLimits';
import { type ToolCallResult } from '../../../models/ToolCallResult';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../../../models/WorkflowCapability';
import { cloudSession } from '../../../repositories/cloudLlm/cloudSession';
import { engineState } from '../../../repositories/webLlm/engineLifecycleState';
import { getWebLlmArtifactManifestModel } from '../../../repositories/webLlm/webLlmArtifactManifest';
import { agentResourceLimitsStore } from '../../../stores/agentResourceLimitsStore';
import { agentRunStore } from '../../../stores/agentRunStore';
import { aiActionHistoryStore } from '../../../stores/aiActionHistoryStore';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { chatStore, clearChatMessages, stopGenerating } from '../../../stores/chatStore';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../../stores/pendingActionConfirmationStore';
import * as preparation from '../../agentReference/prepareStemImport';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunWorkLease } from '../../agentRunWorkLease';
import * as commandPlanning from '../../compileArbitraryCommandList';
import { getAgentExecutionModeAuthority } from '../../getAgentExecutionModeAuthority';
import * as answerNotice from '../../notifyAiAnswer';
import { sendChatMessage } from '../../sendChatMessage';
import { submitAdmittedPromptRequest } from '../../submitAdmittedPromptRequest';
import * as execution from '../executeImmediatePromptCommand';
import * as preview from '../executePromptCommandPreview';
import * as materialization from '../materializePromptCommandPlan';

const boundary = vi.hoisted(() => ({ render: vi.fn(), masterRender: vi.fn(), cloud: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/AudioEngine/useCases')>()),
    renderTrackSubgraphOffline: boundary.render,
    renderOffline: boundary.masterRender,
}));
vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: boundary.cloud,
}));

const provider = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>();
const vocalId = 'track-vocal';
const sectionId = 'verse';
const answerText = 'Over “Verse” (beats 0–4), “Vocal” RMS level is -20 dBFS (exact).';
const query: ToolCallResult = { id: 'query', name: 'project.query', arguments: { type: 'selection' } };
const section: ToolCallResult = { id: 'section', name: 'project.query', arguments: { type: 'section' } };
const measure: ToolCallResult = {
    id: 'measure',
    name: 'analysis.measure',
    arguments: { scope: { kind: 'tracks', ids: [vocalId] }, range: { startBeat: 0, endBeat: 4 } },
};
const recipe: ToolCallResult = {
    id: 'recipe',
    name: 'recipe.discover',
    arguments: { descriptors: ['warm'], targetId: vocalId, limit: 1 },
};
const answer: ToolCallResult = {
    id: 'answer',
    name: 'answer.respond',
    arguments: {
        intakeCallId: 'intake',
        statements: [
            { kind: 'query-page', callId: 'query' },
            { kind: 'query-page', callId: 'section' },
            { kind: 'metric', reference: { callId: 'measure', targetId: vocalId, metricId: 'rms' } },
            { kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' },
        ],
    },
};

function response(calls: ToolCallResult[]) {
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(calls) } }] };
}
type IntakeSelection = { objectIds?: readonly string[]; candidateId?: string; sectionId?: string; topics?: string[] };
function selectedAnswerScopes(params: unknown, measured: boolean, selection: IntakeSelection): string[] {
    if (!measured) {
        return [];
    }
    if (selection.candidateId !== undefined) {
        return [selection.candidateId];
    }
    return (selection.objectIds ?? [vocalId]).map((id) => advertisedAnswerCandidateId(params, id));
}
function intakeCall(params: unknown, measured: boolean, selection: IntakeSelection = {}): ToolCallResult {
    let rangeCandidateId: string | null = null;
    if (measured) {
        rangeCandidateId = advertisedAnswerCandidateId(params, selection.sectionId ?? sectionId, 'ranges');
    }
    return advertisedAnswerIntake(params, {
        kind: measured ? 'measured-audio' : 'project-facts',
        topicIds: measured ? (selection.topics ?? ['level']) : [],
        scopeCandidateIds: selectedAnswerScopes(params, measured, selection),
        rangeCandidateId,
        uncertainty: 'none',
    });
}
function queueIntake(measured: boolean, selection?: IntakeSelection) {
    provider.mockImplementationOnce(async (params) => response([intakeCall(params, measured, selection)]));
    boundary.cloud.mockImplementationOnce(async (...params: unknown[]) => {
        const calls = [intakeCall(params, measured, selection)];
        return {
            providerRequestId: 'fixture-intake',
            calls,
            assistantItems: calls,
            strictToolSchemas: false,
            usage: {
                inputTokens: 20,
                outputTokens: 10,
                cacheReadInputTokens: null,
                cacheWriteInputTokens: null,
                reasoningTokens: null,
            },
        };
    });
}
function script(turns: ToolCallResult[][], selection?: IntakeSelection) {
    const hasAnswer = turns.some((calls) => calls.some((call) => call.name === 'answer.respond'));
    if (hasAnswer) {
        queueIntake(
            turns.some((calls) => calls.some((call) => call.name === 'analysis.measure')),
            selection
        );
    }
    for (const calls of turns) {
        provider.mockResolvedValueOnce(response(calls));
        boundary.cloud.mockResolvedValueOnce({
            providerRequestId: `fixture-${calls[0]?.id}`,
            calls,
            assistantItems: calls,
            strictToolSchemas: false,
            usage: {
                inputTokens: 20,
                outputTokens: 10,
                cacheReadInputTokens: null,
                cacheWriteInputTokens: null,
                reasoningTokens: null,
            },
        });
    }
}
async function selectHostedFixture() {
    await cloudSession.replace_runtime({
        provider: 'openai-compatible',
        model: 'fixture',
        base_url: 'http://localhost:1',
        authentication: 'none',
        session_id: null,
    });
    aiBackendPreferenceStore.set('cloud');
}
function sineBuffer(amplitude = 0.1): AudioBuffer {
    const samples = Float32Array.from(
        { length: 192_000 },
        (_, index) => amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000)
    );
    const buffer = MockAudioBuffer.create(2, 192_000, 48_000);
    buffer.copyToChannel(samples, 0);
    buffer.copyToChannel(samples, 1);
    return buffer;
}
function seedNamedChorus(trackNames: readonly string[]) {
    const ids = trackNames.map((_name, index) => (index === 0 ? vocalId : `named-track-${String(index)}`));
    trackStore.set({
        tracks: trackNames.map((name, index) => createTrack({ id: ids[index]!, name, kind: 'audio' })),
        selectedTrackId: vocalId,
        ghostClips: [],
    });
    markerStore.set({
        markers: [],
        sections: [{ id: 'chorus', name: 'Chorus', startBeat: 8, endBeat: 16, color: '#123456' }],
    });
    const project = projectStore.value!;
    projectStore.set({
        ...project,
        productionBrief: {
            ...project.productionBrief,
            trackRoles: ids.map((trackId, index) => ({
                id: `role-${String(index)}`,
                trackId,
                role: index === ids.length - 1 && ids.length > 1 ? 'bass' : 'lead vocal',
                createdAt: 0,
            })),
        },
    });
    flushAutomergeStorageWrites();
    return ids;
}

function truth() {
    return {
        documents: getCrdtDocIds().map((id) => ({ id, document: getCrdtDoc(id) })),
        project: structuredClone(projectStore.value),
        tracks: structuredClone(trackStore.value),
        markers: structuredClone(markerStore.value),
        midi: structuredClone(midiStore.value),
        transport: structuredClone(transportStore.value),
        undo: structuredClone(undoHistoryStore.value),
        history: structuredClone(actionHistoryStore.value),
        aiHistory: structuredClone(aiActionHistoryStore.value),
        confirmations: structuredClone(pendingActionConfirmationStore.value),
    };
}
function observeProject() {
    const before = truth();
    expect(before.documents.find(({ id }) => id === 'root')?.document).toBeDefined();
    const writes: Array<string | undefined> = [];
    const unsubscribe = subscribeToCrdtChanges((id) => writes.push(id));
    const undoWrites = vi.spyOn(undoHistoryStore, 'set');
    const historyWrites = vi.spyOn(actionHistoryStore, 'set');
    const aiHistoryWrites = vi.spyOn(aiActionHistoryStore, 'set');
    const transportWrites = vi.spyOn(transportStore, 'set');
    const cardWrites = vi.spyOn(pendingActionConfirmationStore, 'set');
    const noActionWork = [
        vi.spyOn(commandPlanning, 'compileArbitraryCommandList'),
        vi.spyOn(preparation, 'prepareStemImport'),
        vi.spyOn(preview, 'executePromptCommandPreview'),
        vi.spyOn(materialization, 'materializePromptCommandPlan'),
        vi.spyOn(execution, 'executeImmediatePromptCommand'),
    ];
    return () => {
        flushAutomergeStorageWrites();
        unsubscribe();
        expect(writes).toEqual([]);
        expect(undoWrites).not.toHaveBeenCalled();
        expect(historyWrites).not.toHaveBeenCalled();
        expect(aiHistoryWrites).not.toHaveBeenCalled();
        expect(transportWrites).not.toHaveBeenCalled();
        expect(cardWrites).not.toHaveBeenCalled();
        for (const work of noActionWork) {
            expect(work).not.toHaveBeenCalled();
        }
        expect(truth()).toStrictEqual(before);
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('Expected record');
    }
    return value as Record<string, unknown>;
}
function localReceiptText(params: Record<string, unknown>): string {
    if (!Array.isArray(params.messages)) {
        throw new TypeError('Expected provider messages');
    }
    const user = params.messages.map(asRecord).find((message) => message.role === 'user');
    if (typeof user?.content !== 'string') {
        throw new TypeError('Expected provider user text');
    }
    const lines = user.content.split('\n');
    const line = lines[lines.indexOf('relevant_evidence:') + 1];
    const evidence = asRecord(JSON.parse(line ?? 'null'));
    if (!Array.isArray(evidence.receipts)) {
        throw new TypeError('Expected receipt evidence');
    }
    const summary = asRecord(asRecord(evidence.receipts[0]).summary);
    expect(summary.truncated).toBe(false);
    if (typeof summary.value !== 'string') {
        throw new TypeError('Expected complete receipt text');
    }
    return summary.value;
}

beforeEach(async () => {
    provider.mockReset();
    boundary.cloud.mockReset();
    boundary.render.mockReset();
    boundary.masterRender.mockReset();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Explain readonly integration');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureAiWorkflowCommandPreflightFixture();
    trackStore.set({
        tracks: [createTrack({ id: vocalId, name: 'Vocal', kind: 'audio' })],
        selectedTrackId: vocalId,
        ghostClips: [],
    });
    markerStore.set({
        markers: [],
        sections: [{ id: sectionId, startBeat: 0, endBeat: 4, name: 'Verse', color: '#123456' }],
    });
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        name: 'Explain fixture',
        loading: false,
        initialized: true,
    });
    clearUndoHistory();
    clearChatMessages();
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    aiBackendPreferenceStore.set('webllm');
    capabilityStore.set({
        phase: 'done',
        report: {
            capability: 'supported',
            webGpu: { status: 'supported' },
            webGpuTier: 'not-measured',
            crossOriginIsolated: true,
            workerAvailable: true,
            opfsAvailable: true,
            inference: { status: 'not-measured', reason: 'not-requested' },
            detectedAt: 0,
        },
    });
    engineState.activeArtifactSetDigest = getWebLlmArtifactManifestModel(engineState.activeModelId).artifactSetDigest;
    engineState.engine = { interruptGenerate: vi.fn(), chat: { completions: { create: provider } } };
    llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: engineState.activeModelId });
    // Only the audio renderer is controlled; target resolution, project revision checks,
    // metric reduction, receipt admission and measurement accounting remain real.
    const samples = new Float32Array(48_000).fill(0.1);
    boundary.render.mockResolvedValue({
        sampleRate: 48_000,
        length: samples.length,
        numberOfChannels: 1,
        duration: 1,
        getChannelData: () => samples,
    });
    await cloudSession.clear();
    flushAutomergeStorageWrites();
});
afterEach(async () => {
    vi.restoreAllMocks();
    resetAiWorkflowCommandPreflightFixture();
    clearAgentMeasurementArtifacts();
    clearChatMessages();
    agentRunLifecycle.clear();
    engineState.engine = null;
    engineState.activeArtifactSetDigest = null;
    await cloudSession.clear();
    aiBackendPreferenceStore.set('auto');
    llmStatusStore.set({ state: 'idle' });
    capabilityStore.set({ phase: 'idle' });
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('Explain reaches the shared answer kernel', () => {
    it('shows a current Prompt Bar answer with its real query evidence', async () => {
        const notice = vi.spyOn(answerNotice, 'notifyAiAnswer');
        script([
            [query],
            [
                {
                    ...answer,
                    arguments: {
                        intakeCallId: 'intake',
                        statements: [
                            { kind: 'project-fact', fact: 'summary' },
                            { kind: 'query-page', callId: 'query' },
                        ],
                    },
                },
            ],
        ]);
        const verifyProject = observeProject();
        try {
            await expect(
                submitAdmittedPromptRequest({ prompt: 'What is selected?', source: 'prompt-bar' })
            ).resolves.toMatchObject({ status: 'no-op' });
        } finally {
            verifyProject();
        }
        expect(notice).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringContaining('The project has 1 audio/MIDI track(s)'),
                evidence: [expect.objectContaining({ callId: 'intake' }), expect.objectContaining({ callId: 'query' })],
            })
        );
    });

    it('publishes measured Prompt Bar prose and evidence through the shared composer', async () => {
        const notify = vi.spyOn(answerNotice, 'notifyAiAnswer');
        script([[query, section], [measure, recipe], [answer]]);
        const verifyProject = observeProject();
        try {
            await submitAdmittedPromptRequest({
                prompt: 'What is the Vocal loudness over Verse?',
                source: 'prompt-bar',
            });
        } finally {
            verifyProject();
        }
        expect(notify).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                text: expect.stringContaining(answerText),
                evidence: expect.arrayContaining([
                    expect.objectContaining({ callId: 'intake' }),
                    expect.objectContaining({ callId: 'measure' }),
                ]),
            })
        );
        expect(boundary.render).toHaveBeenCalledTimes(1);
    });

    it('does not publish a Prompt Bar answer when Stop arrives during resource release', async () => {
        const controller = new AbortController();
        const notice = vi.spyOn(answerNotice, 'notifyAiAnswer');
        const settle = agentRunWorkLease.settle;
        vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            const result = settle(input);
            queueMicrotask(() => controller.abort());
            return result;
        });
        script([
            [query],
            [
                {
                    ...answer,
                    arguments: {
                        intakeCallId: 'intake',
                        statements: [
                            { kind: 'project-fact', fact: 'summary' },
                            { kind: 'query-page', callId: 'query' },
                        ],
                    },
                },
            ],
        ]);
        const result = await submitAdmittedPromptRequest({
            prompt: 'What is selected?',
            source: 'prompt-bar',
            signal: controller.signal,
        });
        expect(result.status).toBe('rejected');
        expect(notice).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(result.runId)?.phase).toBe('cancelled');
    });

    it('does not publish a Prompt Bar answer when its project is replaced during resource release', async () => {
        const notice = vi.spyOn(answerNotice, 'notifyAiAnswer');
        const settle = agentRunWorkLease.settle;
        vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            const result = settle(input);
            queueMicrotask(() => {
                removeCrdtDoc('root');
                createCrdtDoc('root');
            });
            return result;
        });
        script([
            [query],
            [
                {
                    ...answer,
                    arguments: {
                        intakeCallId: 'intake',
                        statements: [
                            { kind: 'project-fact', fact: 'summary' },
                            { kind: 'query-page', callId: 'query' },
                        ],
                    },
                },
            ],
        ]);
        await expect(
            submitAdmittedPromptRequest({ prompt: 'What is selected?', source: 'prompt-bar' })
        ).rejects.toMatchObject({ name: 'AiProposalInvalidatedError' });
        expect(notice).not.toHaveBeenCalled();
        expect(agentRunStore.value?.runs[0]?.phase).not.toBe('completed');
    });

    it('does not publish a Prompt Bar answer after a real project edit', async () => {
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<unknown>();
        const notice = vi.spyOn(answerNotice, 'notifyAiAnswer');
        queueIntake(true);
        provider.mockResolvedValueOnce(response([query]));
        provider.mockResolvedValueOnce(response([measure]));
        provider.mockImplementationOnce(async () => {
            started.resolve();
            return released.promise;
        });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        setArrangementEventBus({ emit: () => Promise.resolve() });
        try {
            const pending = submitAdmittedPromptRequest({
                prompt: 'What is the Vocal loudness over Verse?',
                source: 'prompt-bar',
            });
            await started.promise;
            await executeAppAction({ type: 'renameTrack', payload: { trackId: vocalId, name: 'Changed Vocal' } });
            const afterEdit = truth();
            released.resolve(
                response([
                    {
                        ...answer,
                        arguments: {
                            intakeCallId: 'intake',
                            statements: [
                                {
                                    kind: 'metric',
                                    reference: { callId: 'measure', targetId: vocalId, metricId: 'rms' },
                                },
                            ],
                        },
                    },
                ])
            );
            await expect(pending).rejects.toMatchObject({ name: 'AiProposalInvalidatedError' });
            flushAutomergeStorageWrites();
            expect(notice).not.toHaveBeenCalled();
            expect(truth()).toStrictEqual(afterEdit);
        } finally {
            clearHandlerRegistry();
        }
    });
    it.each(['plan', 'explain'] as const)(
        'does not publish a stale %s answer after a real project edit',
        async (mode) => {
            const started = Promise.withResolvers<void>();
            const released = Promise.withResolvers<unknown>();
            queueIntake(true);
            provider.mockResolvedValueOnce(response([query]));
            provider.mockResolvedValueOnce(response([measure]));
            provider.mockImplementationOnce(async () => {
                started.resolve();
                return released.promise;
            });
            clearHandlerRegistry();
            registerHandlerMap(getArrangementHandlers());
            setArrangementEventBus({ emit: () => Promise.resolve() });
            try {
                const pending = sendChatMessage('What is the Vocal loudness over Verse?', { mode });
                await started.promise;
                await executeAppAction({ type: 'renameTrack', payload: { trackId: vocalId, name: 'Changed Vocal' } });
                const afterEdit = truth();
                released.resolve(
                    response([
                        {
                            ...answer,
                            arguments: {
                                intakeCallId: 'intake',
                                statements: [
                                    {
                                        kind: 'metric',
                                        reference: { callId: 'measure', targetId: vocalId, metricId: 'rms' },
                                    },
                                ],
                            },
                        },
                    ])
                );
                await pending;
                flushAutomergeStorageWrites();
                expect(chatStore.value?.messages.some((message) => message.answerEvidence !== undefined)).toBe(false);
                expect(truth()).toStrictEqual(afterEdit);
            } finally {
                clearHandlerRegistry();
            }
        }
    );
    it.each([
        { backend: 'webllm', mode: 'explain' },
        { backend: 'cloud', mode: 'explain' },
        { backend: 'webllm', mode: 'plan' },
        { backend: 'cloud', mode: 'plan' },
    ] as const)(
        'answers from real query, measurement and recipe receipts through $backend/$mode without project writes',
        async ({ backend, mode }) => {
            if (backend === 'cloud') {
                await cloudSession.replace_runtime({
                    provider: 'openai-compatible',
                    model: 'fixture',
                    base_url: 'http://localhost:1',
                    authentication: 'none',
                    session_id: null,
                });
                aiBackendPreferenceStore.set('cloud');
            }
            const verifyProject = observeProject();
            script([[query, section], [measure, recipe], [answer]]);
            try {
                await sendChatMessage('What is the Vocal loudness over Verse, and what catalog recipe could help?', {
                    mode,
                });
            } finally {
                verifyProject();
            }
            expect(
                agentRunStore.value?.runs[0]?.plan?.applicationToolReceipts?.map(({ callId, status, error }) => ({
                    callId,
                    status,
                    error,
                }))
            ).toEqual([
                { callId: 'intake', status: 'success', error: null },
                { callId: 'query', status: 'success', error: null },
                { callId: 'section', status: 'success', error: null },
                { callId: 'measure', status: 'success', error: null },
                { callId: 'recipe', status: 'success', error: null },
            ]);
            expect(chatStore.value?.messages).toEqual([
                expect.objectContaining({ role: 'user' }),
                expect.objectContaining({
                    role: 'assistant',
                    content: expect.stringContaining(answerText),
                    answerEvidence: [
                        expect.objectContaining({
                            callId: 'intake',
                            toolName:
                                mode === 'explain' ? 'selectAnswerInterpretation' : 'selectCreativeInterpretation',
                        }),
                        expect.objectContaining({ callId: 'query', toolName: 'project.query' }),
                        expect.objectContaining({ callId: 'section', toolName: 'project.query' }),
                        expect.objectContaining({ callId: 'measure', toolName: 'analysis.measure' }),
                        expect.objectContaining({ callId: 'recipe', toolName: 'recipe.discover' }),
                    ],
                }),
            ]);
            expect(chatStore.value?.messages[1]).not.toHaveProperty('error');
            expect(boundary.render).toHaveBeenCalledTimes(1);
            const runs = agentRunStore.value?.runs ?? [];
            expect(runs).toHaveLength(1);
            expect(runs[0]).toMatchObject({
                mode,
                phase: 'completed',
                workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' })],
            });
            expect(runs[0]?.providerUsage).toHaveLength(4);
            expect(runs[0]?.budgetAttempts.filter((attempt) => attempt.attemptId.startsWith('measurement:'))).toEqual([
                expect.objectContaining({ category: 'maxRenderJobs', reserved: 1, actual: 1, final: true }),
                expect.objectContaining({ category: 'localAnalysis', reserved: 1, actual: 1, final: true }),
            ]);
            expect(
                runs[0]?.budgetAttempts.filter((attempt) =>
                    runs[0]?.providerUsage.some((usage) => usage.correlationId === attempt.attemptId)
                )
            ).toHaveLength(4);
            const receipts = runs[0]?.plan?.applicationToolReceipts ?? [];
            expect(JSON.stringify(receipts.find((receipt) => receipt.callId === 'query')?.data)).toContain(vocalId);
            expect(JSON.stringify(receipts.find((receipt) => receipt.callId === 'section')?.data)).toContain(sectionId);
            expect(receipts.find((receipt) => receipt.callId === 'measure')?.data).toMatchObject({
                kind: 'analysis-measurement',
                targets: [expect.objectContaining({ targetId: vocalId })],
            });
            expect(JSON.stringify(receipts.find((receipt) => receipt.callId === 'recipe')?.data)).toContain('recipe');
            expect(getAgentExecutionModeAuthority('explain')).toMatchObject({
                canPlan: false,
                canPreview: false,
                canCommit: false,
            });
            if (backend === 'webllm') {
                expect(provider).toHaveBeenCalledTimes(4);
                if (mode === 'explain') {
                    expect(provider.mock.calls.every(([params]) => params.max_tokens === 2048)).toBe(true);
                }
                const text = localReceiptText(provider.mock.calls[3]![0]);
                expect(text.length).toBeLessThanOrEqual(8192);
                const expectedView = structuredClone(receipts);
                for (const receipt of expectedView) {
                    const data = asRecord(receipt.data);
                    if (typeof data.range === 'object' && data.range !== null) {
                        delete asRecord(data.range).sectionId;
                    }
                    if (receipt.callId === 'section') {
                        for (const item of data.items as Record<string, unknown>[]) {
                            delete item.id;
                        }
                    }
                }
                expect(JSON.parse(text.split('\n').slice(3).join('\n'))).toEqual({ receipts: expectedView });
                expect(text).not.toContain('"sectionId"');
                expect(text).not.toContain('"id":"verse"');
                // Original admitted producer receipts retain the exact private section identity.
                expect(
                    asRecord(asRecord(receipts.find((receipt) => receipt.callId === 'measure')!.data).range).sectionId
                ).toBe(sectionId);
                const rawBytes = receipts.map(
                    (receipt) => new TextEncoder().encode(JSON.stringify(receipt)).byteLength
                );
                expect(rawBytes.every((size) => size <= 16384)).toBe(true);
                expect(rawBytes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(65536);
            } else {
                expect(boundary.cloud).toHaveBeenCalledTimes(4);
                if (mode === 'explain') {
                    expect(boundary.cloud.mock.calls.every((call) => call[3] === 2048)).toBe(true);
                }
                expect(new Set(runs[0]?.providerUsage.map((usage) => usage.correlationId)).size).toBe(4);
            }
        }
    );

    it.each([
        { backend: 'webllm', mode: 'plan' },
        { backend: 'cloud', mode: 'plan' },
        { backend: 'webllm', mode: 'explain' },
        { backend: 'cloud', mode: 'explain' },
    ] as const)(
        'keeps named-section identity private through actual $backend/$mode answer requests',
        async ({ backend, mode }) => {
            const privateId = 'private-section-identity-4381';
            markerStore.set({
                markers: [],
                sections: [{ id: privateId, name: 'Verse', startBeat: 0, endBeat: 4, color: '#123456' }],
            });
            flushAutomergeStorageWrites();
            if (backend === 'cloud') {
                await selectHostedFixture();
            }
            script(
                [
                    [section],
                    [measure],
                    [
                        {
                            ...answer,
                            arguments: {
                                intakeCallId: 'intake',
                                statements: [
                                    {
                                        kind: 'metric',
                                        reference: { callId: 'measure', targetId: vocalId, metricId: 'rms' },
                                    },
                                ],
                            },
                        },
                    ],
                ],
                { sectionId: 'Verse' }
            );
            const verifyProject = observeProject();
            try {
                await sendChatMessage('What is Vocal loudness over Verse?', { mode });
            } finally {
                verifyProject();
            }
            expect(chatStore.value?.messages.at(-1)?.content).toContain(answerText);
            const calls = backend === 'cloud' ? boundary.cloud.mock.calls : provider.mock.calls;
            expect(calls).toHaveLength(4);
            expect(JSON.stringify(calls)).not.toContain(privateId);
            const receipts = agentRunStore.value?.runs[0]?.plan?.applicationToolReceipts ?? [];
            expect(
                asRecord(asRecord(receipts.find((receipt) => receipt.callId === 'measure')!.data).range).sectionId
            ).toBe(privateId);
            expect(asRecord(receipts.find((receipt) => receipt.callId === 'section')!.data).items).toEqual([
                expect.objectContaining({ id: privateId, name: 'Verse' }),
            ]);
            expect(boundary.render).toHaveBeenCalledTimes(1);
        }
    );

    it('denies incomplete production authority before any joint view or provider dispatch', async () => {
        const sentinel = 'WITHHELD_CANDIDATE_NAME_4381';
        const state = trackStore.value!;
        trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, name: sentinel })) });
        const project = projectStore.value!;
        projectStore.set({
            ...project,
            productionBrief: {
                ...project.productionBrief,
                locks: Array.from({ length: 65 }, (_, index) => ({
                    id: `private-lock-${String(index)}`,
                    scope: { kind: 'project' as const },
                    statement: sentinel,
                    createdAt: index,
                })),
            },
        });
        flushAutomergeStorageWrites();
        const verifyProject = observeProject();
        try {
            await sendChatMessage('Describe the project.', { mode: 'plan' });
        } finally {
            verifyProject();
        }
        expect(provider).not.toHaveBeenCalled();
        expect(boundary.cloud).not.toHaveBeenCalled();
        expect(JSON.stringify(chatStore.value?.messages)).not.toContain(sentinel);
        expect(agentRunStore.value?.runs[0]?.plan?.applicationToolReceipts ?? []).toEqual([]);
    });

    it.each([
        { mode: 'plan', group: false },
        { mode: 'explain', group: false },
        { mode: 'plan', group: true },
        { mode: 'explain', group: true },
    ] as const)(
        'composes a real published named scope through $mode; complete group=$group',
        async ({ mode, group }) => {
            const ids = seedNamedChorus(['Vocal 2 **LUFS**', 'Harmony', 'Bass']);
            await selectHostedFixture();
            const bassId = ids[2]!;
            const selected = group ? ids : [vocalId, bassId];
            boundary.render.mockImplementation(async ({ targetTrackId }: { targetTrackId: string }) =>
                sineBuffer(targetTrackId === bassId ? 0.2 : 0.1)
            );
            const loudness = (targetId: string) => ({ callId: 'measure', targetId, metricId: 'integratedLoudness' });
            const peak = (targetId: string) => ({ callId: 'measure', targetId, metricId: 'truePeak' });
            const intakeSelection: IntakeSelection = { sectionId: 'chorus' };
            if (group) {
                intakeSelection.candidateId = 'all-tracks';
            } else {
                intakeSelection.objectIds = selected;
            }
            script(
                [
                    [query, section],
                    [
                        {
                            ...measure,
                            arguments: {
                                scope: { kind: 'tracks', ids: selected },
                                range: { startBeat: 8, endBeat: 16 },
                            },
                        },
                    ],
                    [
                        {
                            ...answer,
                            arguments: {
                                intakeCallId: 'intake',
                                statements: [
                                    { kind: 'difference', left: loudness(bassId), right: loudness(vocalId) },
                                    { kind: 'difference', left: peak(bassId), right: peak(vocalId) },
                                    { kind: 'ranking', references: selected.map(loudness), operation: 'descending' },
                                ],
                            },
                        },
                    ],
                ],
                intakeSelection
            );
            const verifyProject = observeProject();
            try {
                await sendChatMessage(
                    group
                        ? 'Compare Vocal 2 **LUFS**, Harmony and Bass loudness over Chorus; rank every track.'
                        : 'Compare only Vocal 2 **LUFS** and Bass loudness and true peak over Chorus.',
                    { mode }
                );
            } finally {
                verifyProject();
            }
            const run = agentRunStore.value?.runs[0];
            expect(run?.phase).toBe('completed');
            const receipt = run?.plan?.applicationToolReceipts?.find((entry) => entry.callId === 'intake');
            expect(receipt?.data).toMatchObject({
                kind: 'measured-audio',
                scopes: [{ kind: 'tracks', objectIds: selected }],
                range: { sectionId: 'chorus', startBeat: 8, endBeat: 16 },
            });
            if (group) {
                expect(receipt?.data).toMatchObject({ scopeCandidateIds: ['all-tracks'] });
            } else {
                const receiptData = receipt?.data;
                if (receiptData === null || typeof receiptData !== 'object' || !('scopeCandidateIds' in receiptData)) {
                    throw new TypeError('Expected the genuine intake receipt scope candidates.');
                }
                expect(receiptData.scopeCandidateIds).toHaveLength(2);
            }
            expect(boundary.render.mock.calls.map(([input]) => input.targetTrackId)).toEqual(selected);
            const reply = chatStore.value?.messages.at(-1);
            expect(reply?.content).toContain('6.02 LU');
            expect(reply?.content).toContain('6.02 dB.');
            expect(reply?.content).toContain('Over “Chorus” (beats 8–16)');
            expect(reply?.content).toContain('Vocal 2 \\*\\*LUFS\\*\\*');
            expect(reply?.content.includes('tied:')).toBe(group);
            expect(reply?.content).toContain('complete selected scope');
            expect(reply?.answerEvidence?.map((entry) => entry.callId)).toEqual(['intake', 'measure']);
            expect(reply?.pendingActionConfirmationId).toBeUndefined();
        }
    );

    it.each([
        { mode: 'plan', backend: 'webllm' },
        { mode: 'explain', backend: 'webllm' },
        { mode: 'plan', backend: 'cloud' },
        { mode: 'explain', backend: 'cloud' },
    ] as const)(
        'answers tone from a real published vocal role and Chorus through $backend/$mode',
        async ({ mode, backend }) => {
            seedNamedChorus(['Vocal']);
            if (backend === 'cloud') {
                await selectHostedFixture();
            }
            boundary.render.mockResolvedValue(sineBuffer());
            script(
                [
                    [query, section],
                    [
                        {
                            ...measure,
                            arguments: {
                                scope: { kind: 'tracks', ids: [vocalId] },
                                range: { startBeat: 8, endBeat: 16 },
                            },
                        },
                    ],
                    [
                        {
                            ...answer,
                            arguments: {
                                intakeCallId: 'intake',
                                statements: [
                                    {
                                        kind: 'metric',
                                        reference: {
                                            callId: 'measure',
                                            targetId: vocalId,
                                            metricId: 'spectralCentroid',
                                        },
                                    },
                                    {
                                        kind: 'metric',
                                        reference: {
                                            callId: 'measure',
                                            targetId: vocalId,
                                            metricId: 'frequencyBandEnergy',
                                            band: 'mid',
                                        },
                                    },
                                    { kind: 'limitation', code: 'perception-not-inferred' },
                                ],
                            },
                        },
                    ],
                ],
                { candidateId: 'role:lead vocal', sectionId: 'chorus', topics: ['tone'] }
            );
            const verifyProject = observeProject();
            try {
                await sendChatMessage('Describe the vocal tone over Chorus without changing anything.', { mode });
            } finally {
                verifyProject();
            }
            const run = agentRunStore.value?.runs[0];
            expect(run?.phase).toBe('completed');
            expect(run?.plan?.applicationToolReceipts?.find((entry) => entry.callId === 'intake')?.data).toMatchObject({
                topics: ['tone'],
                scopeCandidateIds: ['role:lead vocal'],
                scopes: [{ objectIds: [vocalId] }],
                range: { startBeat: 8, endBeat: 16 },
            });
            const source = run?.plan?.applicationToolReceipts?.find((entry) => entry.callId === 'measure')?.data as {
                targets: Array<{ measurements: { spectralCentroid: { status: string; value: number; unit: string } } }>;
            };
            const centroid = source.targets[0]!.measurements.spectralCentroid;
            expect(centroid.status).toBe('measured');
            expect(centroid.value).toBeGreaterThan(995);
            expect(centroid.value).toBeLessThan(1005);
            expect(centroid.unit).toBe('hertz');
            const reply = chatStore.value?.messages.at(-1);
            expect(reply?.content).toContain(
                `spectral centroid is ${String(Math.round(centroid.value * 100) / 100)} Hz (estimated)`
            );
            expect(reply?.content).toContain('frequency-band energy in band “mid” is 1 ratio (estimated)');
            expect(reply?.content).toContain('Over “Chorus” (beats 8–16)');
            expect(reply?.content).toContain('do not establish perceived sound quality');
            expect(reply?.answerEvidence?.map((entry) => entry.callId)).toEqual(['intake', 'measure']);
            expect(boundary.render).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ targetTrackId: vocalId, startBeat: 8, endBeat: 16 })
            );
        }
    );

    it.each(['plan', 'explain'] as const)(
        'compares separate real track, bus and master scopes through %s',
        async (mode) => {
            seedNamedChorus(['Vocal', 'Harmony']);
            const busId = 'vocal-bus';
            const master = createTrack({ id: 'master-node', name: 'Master', kind: 'master' });
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: [
                    ...state.tracks.map((track) => ({ ...track, outputId: busId })),
                    createTrack({ id: busId, name: 'Vocal Bus', kind: 'bus' }),
                    master,
                ],
            });
            flushAutomergeStorageWrites();
            await selectHostedFixture();
            boundary.render.mockImplementation(async ({ targetTrackId }: { targetTrackId: string }) =>
                sineBuffer(targetTrackId === busId ? 0.2 : 0.1)
            );
            boundary.masterRender.mockResolvedValue(sineBuffer(0.2));
            const metric = (callId: string, targetId: string) => ({ callId, targetId, metricId: 'integratedLoudness' });
            script(
                [
                    [
                        {
                            ...measure,
                            id: 'measure-track',
                            arguments: {
                                scope: { kind: 'tracks', ids: [vocalId] },
                                range: { startBeat: 8, endBeat: 16 },
                            },
                        },
                    ],
                    [
                        {
                            ...measure,
                            id: 'measure-bus',
                            arguments: { scope: { kind: 'buses', ids: [busId] }, range: { startBeat: 8, endBeat: 16 } },
                        },
                    ],
                    [
                        {
                            ...measure,
                            id: 'measure-master',
                            arguments: { scope: { kind: 'master' }, range: { startBeat: 8, endBeat: 16 } },
                        },
                    ],
                    [
                        {
                            ...answer,
                            arguments: {
                                intakeCallId: 'intake',
                                statements: [
                                    {
                                        kind: 'difference',
                                        left: metric('measure-bus', busId),
                                        right: metric('measure-track', vocalId),
                                    },
                                    {
                                        kind: 'difference',
                                        left: metric('measure-master', 'master'),
                                        right: metric('measure-bus', busId),
                                    },
                                    {
                                        kind: 'ranking',
                                        references: [
                                            metric('measure-track', vocalId),
                                            metric('measure-master', 'master'),
                                            metric('measure-bus', busId),
                                        ],
                                        operation: 'descending',
                                    },
                                ],
                            },
                        },
                    ],
                ],
                { objectIds: ['master', vocalId, busId], sectionId: 'chorus' }
            );
            const verifyProject = observeProject();
            try {
                await sendChatMessage(
                    'Compare Vocal, Vocal Bus and master integrated loudness over Chorus, including ties.',
                    { mode }
                );
            } finally {
                verifyProject();
            }
            const run = agentRunStore.value?.runs[0];
            expect(run?.phase).toBe('completed');
            expect(run?.plan?.applicationToolReceipts?.find((entry) => entry.callId === 'intake')?.data).toMatchObject({
                scopes: [
                    { kind: 'master', objectIds: ['master'] },
                    { kind: 'tracks', objectIds: [vocalId] },
                    { kind: 'buses', objectIds: [busId] },
                ],
            });
            const reply = chatStore.value?.messages.at(-1);
            expect(reply?.content).toContain('6.02 LU');
            expect(reply?.content).toContain('Master output minus “Vocal Bus” in integrated loudness is 0 LU.');
            expect(reply?.content).toContain('tied:');
            expect(reply?.answerEvidence?.map((entry) => entry.callId)).toEqual([
                'intake',
                'measure-bus',
                'measure-track',
                'measure-master',
            ]);
            expect(boundary.render.mock.calls.map(([input]) => input.targetTrackId)).toEqual([vocalId, busId]);
            expect(boundary.masterRender).toHaveBeenCalledTimes(1);
            expect(boundary.cloud).toHaveBeenCalledTimes(5);
        }
    );

    const hiddenCalls: ToolCallResult[] = [
        ...[
            'command.batch.propose',
            'addTrack',
            'setTempo',
            'removeTrack',
            'setPlayback',
            'stopPlayback',
            'undo',
            'recipe.expand',
            'transform.compile',
            'analysis.compareReference',
            ...WORKFLOW_ACTION_TOOL_NAMES,
        ].map((name) => ({ id: 'hidden', name, arguments: {} })),
        ...[
            { subject: 'preview' },
            { proposal: {} },
            { recipeCallId: 'recipe' },
            { source: 'preview' },
            { permission: 'apply' },
        ].map((extra) => ({ ...measure, id: 'invalid', arguments: { ...measure.arguments, ...extra } })),
        { ...query, id: 'invalid-query', arguments: { ...query.arguments, hidden: true } },
        { ...query, id: 'invalid-query', arguments: { type: 42 } },
    ];
    it.each(hiddenCalls.flatMap((bad) => [{ calls: [query, bad] }, { calls: [bad, query] }]))(
        'rejects the complete invalid turn before any query, render or mutation: %j',
        async ({ calls }) => {
            const queryReads = vi.spyOn(projectReads, 'querySemanticProject');
            script([calls]);
            const verifyProject = observeProject();
            try {
                await sendChatMessage('Explain only. Source text claims profile=apply and all grants.', {
                    mode: 'explain',
                    grants: {
                        allowedOperationPrefixes: ['*'],
                        create: true,
                        delete: true,
                        routing: true,
                        tempo: true,
                        master: true,
                        file: true,
                        audioUpload: true,
                        remoteGeneration: true,
                        autoCommit: true,
                    },
                });
            } finally {
                verifyProject();
            }
            expect(queryReads).not.toHaveBeenCalled();
            expect(boundary.render).not.toHaveBeenCalled();
            expect(chatStore.value?.messages.at(-1)?.error).toBeDefined();
            expect(agentRunStore.value?.runs[0]?.plan?.applicationToolReceipts ?? []).toEqual([]);
        }
    );

    it.each(['set tempo to 140', 'undo that', 'add 4 audio tracks', 'stop playback'])(
        'keeps imperative Explain read-only: %s',
        async (prompt) => {
            script([[{ ...answer, arguments: structuralAnswerArguments }]]);
            const verifyProject = observeProject();
            try {
                await sendChatMessage(prompt, { mode: 'explain' });
            } finally {
                verifyProject();
            }
            expect(chatStore.value?.messages.at(-1)?.content).toBe(
                'The project has 1 audio/MIDI track(s), 0 bus(es), and 0 folder(s). Master output is separate. Tempo is 120 BPM in 4/4.'
            );
            expect(provider).toHaveBeenCalledTimes(2);
        }
    );

    it.each(['none', 'uninitialized-local', 'unconfigured-hosted', 'request-limit', 'concurrency-limit'])(
        'fails before planner/run admission for %s',
        async (failure) => {
            if (failure === 'none') {
                capabilityStore.set({ phase: 'idle' });
            }
            if (failure === 'uninitialized-local') {
                engineState.engine = null;
            }
            if (failure === 'unconfigured-hosted') {
                aiBackendPreferenceStore.set('cloud');
            }
            if (failure === 'request-limit') {
                agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, requestChars: 1 });
            }
            if (failure === 'concurrency-limit') {
                agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, concurrentRuns: 1 });
                agentRunLifecycle.create({
                    runId: 'existing',
                    request: 'Existing',
                    mode: 'plan',
                    createdRevision: 'existing',
                });
                agentRunLifecycle.transitionPhase({ runId: 'existing', phase: 'planning' });
            }
            const planner = await import('../../planPromptActions');
            const planningCalls = vi.spyOn(planner, 'planPromptActions');
            const count = agentRunStore.value?.runs.length ?? 0;
            await expect(sendChatMessage('Explain the Vocal', { mode: 'explain' })).rejects.toThrow();
            expect(agentRunStore.value?.runs).toHaveLength(count);
            expect(planningCalls).not.toHaveBeenCalled();
            expect(provider).not.toHaveBeenCalled();
            expect(boundary.cloud).not.toHaveBeenCalled();
        }
    );

    it('refuses provider admission without calling the transport', async () => {
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, localAnalysis: 1 });
        const verifyProject = observeProject();
        try {
            await sendChatMessage('Explain the Vocal', { mode: 'explain' });
        } finally {
            verifyProject();
        }
        expect(provider).not.toHaveBeenCalled();
        expect(agentRunStore.value?.runs).toEqual([expect.objectContaining({ phase: 'failed' })]);
    });

    it('keeps earlier receipts when a project measurement fails', async () => {
        boundary.render.mockRejectedValue(new Error('Controlled renderer failure'));
        script([[query], [measure], [{ ...answer, arguments: structuralAnswerArguments }]]);
        const verifyProject = observeProject();
        try {
            await sendChatMessage('Explain the Vocal', { mode: 'explain' });
        } finally {
            verifyProject();
        }
        expect(agentRunStore.value?.runs[0]?.plan?.applicationToolReceipts).toEqual([
            expect.objectContaining({ callId: 'intake', status: 'success' }),
            expect.objectContaining({ callId: 'query', status: 'success' }),
            expect.objectContaining({ callId: 'measure', status: 'failure' }),
        ]);
        expect(chatStore.value?.messages.at(-1)?.answerEvidence).toEqual([
            expect.objectContaining({ callId: 'intake' }),
        ]);
    });

    it('keeps a configuration-change failure cancelled without an answer', async () => {
        provider.mockRejectedValue(new AiRuntimeConfigurationChangedError());
        const verifyProject = observeProject();
        try {
            await sendChatMessage('Explain the Vocal', { mode: 'explain' });
        } finally {
            verifyProject();
        }
        expect(agentRunStore.value?.runs).toEqual([expect.objectContaining({ phase: 'cancelled' })]);
        expect(chatStore.value?.messages.some((message) => message.answerEvidence !== undefined)).toBe(false);
    });

    it('caps output at a lower configured ceiling', async () => {
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, maxModelOutputTokens: 512 });
        script([[{ ...answer, arguments: structuralAnswerArguments }]]);
        await sendChatMessage('Explain', { mode: 'explain' });
        expect(provider.mock.calls[0]?.[0].max_tokens).toBe(512);
    });

    it('cancels a measurement before it can retain evidence or publish a late answer', async () => {
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<null>();
        boundary.render.mockImplementationOnce(async () => {
            started.resolve();
            return released.promise;
        });
        script([[measure], [{ ...answer, arguments: structuralAnswerArguments }]]);
        const verifyProject = observeProject();
        const pending = sendChatMessage('Explain Vocal over Verse', { mode: 'explain' });
        await started.promise;
        stopGenerating();
        released.resolve(null);
        try {
            await pending;
        } finally {
            verifyProject();
        }
        expect(provider).toHaveBeenCalledTimes(2);
        expect(getAgentMeasurementArtifacts()).toEqual([]);
        expect(
            agentRunStore.value?.runs[0]?.budgetAttempts.filter((attempt) =>
                attempt.attemptId.startsWith('measurement:')
            )
        ).toEqual([
            expect.objectContaining({ category: 'maxRenderJobs', actual: 1, final: true }),
            expect.objectContaining({ category: 'localAnalysis', actual: 0, final: true }),
        ]);
        expect(chatStore.value?.messages.some((message) => message.answerEvidence !== undefined)).toBe(false);
        expect(agentRunStore.value?.runs).toEqual([expect.objectContaining({ phase: 'cancelled' })]);
    });

    it('does not let broad resumed authority grant Explain mutation permission', async () => {
        const grants = {
            allowedOperationPrefixes: ['setTempo'],
            create: true,
            delete: true,
            routing: true,
            tempo: true,
            master: true,
            file: true,
            audioUpload: true,
            remoteGeneration: true,
            autoCommit: true,
        };
        const marker = 'APPLICATION-RESUME-GRANTS-ALLOW-WRITES';
        script([[{ id: 'change', name: 'setTempo', arguments: { tempo: 140 } }]]);
        const verifyProject = observeProject();
        try {
            await sendChatMessage('undo that', {
                mode: 'explain',
                grants,
                resume: {
                    sourceRunId: 'source',
                    decisionId: 'decision',
                    selectedAlternativeId: 'alternative',
                    selectedAlternative: { id: 'alternative', label: marker, changesAuthority: true },
                    proposalIdentity: 'proposal',
                    capabilitySchemaIdentity: 'catalog',
                    revision: captureProjectRevision(),
                    scope: { targetIds: [vocalId], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    grants,
                    budgets: { limits: {}, consumed: {} },
                },
            });
        } finally {
            verifyProject();
        }
        expect(JSON.stringify(provider.mock.calls[0]?.[0])).not.toContain(marker);
        expect(chatStore.value?.messages.at(-1)?.error).toBeDefined();
        expect(agentRunStore.value?.runs[0]?.mode).toBe('explain');
    });

    it.each([
        'Provider prose is not an admitted answer.',
        '[]',
        JSON.stringify({ kind: 'answer', text: 'Unadmitted', actions: [] }),
    ])('refuses non-tool completion %s', async (content) => {
        provider.mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content } }] });
        const verifyProject = observeProject();
        try {
            await sendChatMessage('Explain', { mode: 'explain' });
        } finally {
            verifyProject();
        }
        expect(chatStore.value?.messages.at(-1)?.error).toBeDefined();
        expect(chatStore.value?.messages.some((message) => message.answerEvidence !== undefined)).toBe(false);
    });

    it('stops before provider transport dispatch', async () => {
        const verifyProject = observeProject();
        const pending = sendChatMessage('Explain', { mode: 'explain' });
        stopGenerating();
        try {
            await pending;
        } finally {
            verifyProject();
        }
        expect(provider).not.toHaveBeenCalled();
        expect(agentRunStore.value?.runs).toEqual([expect.objectContaining({ phase: 'cancelled' })]);
    });

    it('drops a late provider answer after Stop and settles the one planning lease', async () => {
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        const settle = vi.spyOn(agentRunWorkLease, 'settle');
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<unknown>();
        queueIntake(false);
        provider.mockImplementationOnce(async () => {
            started.resolve();
            return released.promise;
        });
        const verifyProject = observeProject();
        const pending = sendChatMessage('Explain the Vocal', { mode: 'explain' });
        await started.promise;
        stopGenerating();
        released.resolve(response([{ ...answer, arguments: structuralAnswerArguments }]));
        try {
            await pending;
        } finally {
            verifyProject();
        }
        expect(chatStore.value?.messages.some((message) => message.answerEvidence !== undefined)).toBe(false);
        expect(agentRunStore.value?.runs).toEqual([expect.objectContaining({ phase: 'cancelled' })]);
        expect(chatStore.value?.isGenerating).toBe(false);
        expect(provider).toHaveBeenCalledTimes(2);
        expect(claim).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledTimes(1);
    });
});
