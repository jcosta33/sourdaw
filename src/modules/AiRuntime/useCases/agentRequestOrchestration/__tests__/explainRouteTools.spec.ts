import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { clearAgentMeasurementArtifacts, getAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { capabilityStore } from '#/modules/BrowserAi/stores';
import { undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
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
import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from '../../__tests__/aiWorkflowCommandPreflightFixture';
import * as preparation from '../../agentReference/prepareStemImport';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import * as commandPlanning from '../../compileArbitraryCommandList';
import { getAgentExecutionModeAuthority } from '../../getAgentExecutionModeAuthority';
import { sendChatMessage } from '../../sendChatMessage';
import * as execution from '../executeImmediatePromptCommand';
import * as preview from '../executePromptCommandPreview';
import * as materialization from '../materializePromptCommandPlan';

const boundary = vi.hoisted(() => ({ render: vi.fn(), cloud: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/AudioEngine/useCases')>()),
    renderTrackSubgraphOffline: boundary.render,
}));
vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: boundary.cloud,
}));

const provider = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>();
const vocalId = 'track-vocal';
const sectionId = 'verse';
const answerText = 'The vocal was measured over Verse. A catalog recipe is available; no changes were made.';
const query: ToolCallResult = { id: 'query', name: 'project.query', arguments: { type: 'selection' } };
const section: ToolCallResult = { id: 'section', name: 'project.query', arguments: { type: 'section' } };
const measure: ToolCallResult = {
    id: 'measure',
    name: 'analysis.measure',
    arguments: { scope: { kind: 'tracks', ids: [vocalId] }, range: { sectionId }, metrics: ['rms'] },
};
const recipe: ToolCallResult = {
    id: 'recipe',
    name: 'recipe.discover',
    arguments: { descriptors: ['warm'], targetId: vocalId, limit: 1 },
};
const answer: ToolCallResult = {
    id: 'answer',
    name: 'answer.respond',
    arguments: { text: answerText, evidenceCallIds: ['query', 'section', 'measure', 'recipe'] },
};

function response(calls: ToolCallResult[]) {
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(calls) } }] };
}
function script(turns: ToolCallResult[][]) {
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
    it.each(['webllm', 'cloud'] as const)(
        'answers from real query, measurement and recipe receipts through %s without project writes',
        async (backend) => {
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
                    mode: 'explain',
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
                { callId: 'query', status: 'success', error: null },
                { callId: 'section', status: 'success', error: null },
                { callId: 'measure', status: 'success', error: null },
                { callId: 'recipe', status: 'success', error: null },
            ]);
            expect(chatStore.value?.messages).toEqual([
                expect.objectContaining({ role: 'user' }),
                expect.objectContaining({
                    role: 'assistant',
                    content: answerText,
                    answerEvidence: [
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
                mode: 'explain',
                phase: 'completed',
                workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' })],
            });
            expect(runs[0]?.providerUsage).toHaveLength(3);
            expect(runs[0]?.budgetAttempts.filter((attempt) => attempt.attemptId.startsWith('measurement:'))).toEqual([
                expect.objectContaining({ category: 'maxRenderJobs', reserved: 1, actual: 1, final: true }),
                expect.objectContaining({ category: 'localAnalysis', reserved: 1, actual: 1, final: true }),
            ]);
            expect(
                runs[0]?.budgetAttempts.filter((attempt) =>
                    runs[0]?.providerUsage.some((usage) => usage.correlationId === attempt.attemptId)
                )
            ).toHaveLength(3);
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
                expect(provider).toHaveBeenCalledTimes(3);
                expect(provider.mock.calls.every(([params]) => params.max_tokens === 2048)).toBe(true);
                const text = localReceiptText(provider.mock.calls[2]![0]);
                expect(text.length).toBeLessThanOrEqual(8192);
                expect(JSON.parse(text.split('\n').slice(3).join('\n'))).toEqual({ receipts });
                const rawBytes = receipts.map(
                    (receipt) => new TextEncoder().encode(JSON.stringify(receipt)).byteLength
                );
                expect(rawBytes.every((size) => size <= 16384)).toBe(true);
                expect(rawBytes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(65536);
            } else {
                expect(boundary.cloud).toHaveBeenCalledTimes(3);
                expect(boundary.cloud.mock.calls.every((call) => call[3] === 2048)).toBe(true);
                expect(new Set(runs[0]?.providerUsage.map((usage) => usage.correlationId)).size).toBe(3);
            }
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
            script([[{ ...answer, arguments: { text: 'Explain does not apply changes.', evidenceCallIds: [] } }]]);
            const verifyProject = observeProject();
            try {
                await sendChatMessage(prompt, { mode: 'explain' });
            } finally {
                verifyProject();
            }
            expect(chatStore.value?.messages.at(-1)?.content).toBe('Explain does not apply changes.');
            expect(provider).toHaveBeenCalledTimes(1);
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
        script([
            [query],
            [measure],
            [{ ...answer, arguments: { text: 'The measurement was unavailable.', evidenceCallIds: ['query'] } }],
        ]);
        const verifyProject = observeProject();
        try {
            await sendChatMessage('Explain the Vocal', { mode: 'explain' });
        } finally {
            verifyProject();
        }
        expect(agentRunStore.value?.runs[0]?.plan?.applicationToolReceipts).toEqual([
            expect.objectContaining({ callId: 'query', status: 'success' }),
            expect.objectContaining({ callId: 'measure', status: 'failure' }),
        ]);
        expect(chatStore.value?.messages.at(-1)?.answerEvidence).toEqual([
            expect.objectContaining({ callId: 'query' }),
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
        script([[{ ...answer, arguments: { text: 'Explain.', evidenceCallIds: [] } }]]);
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
        script([[measure], [{ ...answer, arguments: { text: 'LATE MEASUREMENT ANSWER', evidenceCallIds: [] } }]]);
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
        expect(provider).toHaveBeenCalledTimes(1);
        expect(getAgentMeasurementArtifacts()).toEqual([]);
        expect(
            agentRunStore.value?.runs[0]?.budgetAttempts.filter((attempt) =>
                attempt.attemptId.startsWith('measurement:')
            )
        ).toEqual([
            expect.objectContaining({ category: 'maxRenderJobs', actual: 1, final: true }),
            expect.objectContaining({ category: 'localAnalysis', actual: 0, final: true }),
        ]);
        expect(chatStore.value?.messages.some((message) => message.content === 'LATE MEASUREMENT ANSWER')).toBe(false);
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
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<unknown>();
        provider.mockImplementationOnce(async () => {
            started.resolve();
            return released.promise;
        });
        const verifyProject = observeProject();
        const pending = sendChatMessage('Explain the Vocal', { mode: 'explain' });
        await started.promise;
        stopGenerating();
        released.resolve(response([{ ...answer, arguments: { text: 'LATE ANSWER', evidenceCallIds: [] } }]));
        try {
            await pending;
        } finally {
            verifyProject();
        }
        expect(chatStore.value?.messages.some((message) => message.content === 'LATE ANSWER')).toBe(false);
        expect(agentRunStore.value?.runs).toEqual([expect.objectContaining({ phase: 'cancelled' })]);
        expect(chatStore.value?.isGenerating).toBe(false);
    });
});
