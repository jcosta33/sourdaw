import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { clipSelectionStore, trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { capabilityStore } from '#/modules/BrowserAi/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { querySemanticProject } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';

import {
    LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
} from '../../../models/LocalPlanningBudget';
import { DEFAULT_WEBLLM_MODEL_ID } from '../../../models/ModelInfo';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { budgetLocalPlanningRequest } from '../../../transformers/budgetLocalPlanningRequest';
import { estimateConservativePromptTokens } from '../../../transformers/estimateConservativePromptTokens';
import { serializeWebLlmToolPlanningPrompt } from '../../../transformers/serializeWebLlmToolPlanningPrompt';
import { advertisedAnswerIntake, structuralAnswerArguments } from '../../__tests__/answerWireFixture';
import {
    configureMetricGoalProject,
    literalMetricIntakeTurn,
    metricGoalAudioBuffer,
    resetMetricGoalProject,
} from '../../__tests__/metricGoalWorkflowFixture';
import { createPlanningProject, fixtureUuid } from '../../__tests__/planningProjectFixture';
import { decodeReceiptContext, readReceiptSummary } from '../../__tests__/receiptContextFixture';
import { createFullThreadContext, threadRequest } from '../../__tests__/threadContextFixture';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { getProjectContext } from '../../getProjectContext';
import { parsePromptToActions } from '../../parsePromptToActions';
import { getBackendChain } from '../backendResolution/getBackendChain';
import { type ProviderAttemptAdmission } from '../inference';

registerDeviceEnginePorts();

const completion = vi.hoisted(() => vi.fn());
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({ generateWebLlmCompletion: completion }));

const groupId = `vca-${fixtureUuid('production-local-window')}`;
const runId = `agent-run-${fixtureUuid('production-local-window')}`;
const grants = {
    allowedOperationPrefixes: ['setTrackGain', 'setTrackPan'],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};
const scope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
const bufferId = `buffer-${fixtureUuid('local-window-onsets')}`;
type PlanningInput = Parameters<typeof parsePromptToActions>[0];

function createResumedPlanningRun(prompt: string, projectRevision: string) {
    const resume = {
        sourceRunId: `agent-run-${fixtureUuid('earlier-decision')}`,
        decisionId: 'decision-vocal-width',
        selectedAlternativeId: 'vocal-width',
        selectedAlternative: {
            id: 'vocal-width',
            label: 'Preserve vocal edits and widen only the chorus',
            changesAuthority: false,
        },
        proposalIdentity: 'proposal-vocal-width',
        capabilitySchemaIdentity: 'catalog-v1',
        revision: projectRevision,
        scope,
        grants,
        budgets: { limits: { localAnalysis: 100 }, consumed: { localAnalysis: 1 } },
    };
    agentRunLifecycle.create({
        runId,
        request: prompt,
        mode: 'plan',
        createdRevision: projectRevision,
        scope,
        grants,
        resume,
    });
    return resume;
}

function assertResumedPlanningContext(input: {
    prompt: string;
    projectRevision: string;
    resume: ReturnType<typeof createResumedPlanningRun>;
    thread: ReturnType<typeof createFullThreadContext>;
}): void {
    for (const [system, user] of completion.mock.calls) {
        expect(system).toContain(JSON.stringify(input.resume));
        expect(user).toContain(input.prompt);
        expect(user).toContain(JSON.stringify(grants));
        expect(user).toContain('metronomeVolumeDb');
        expect(user).toContain(groupId);
        expect(user).toContain(threadRequest(input.thread.requests.length));
        expect(user).toContain(input.thread.pendingProposal!.confirmationId);
        expect(user).toContain('Keep the master below -1 dBTP.');
    }
    const run = agentRunLifecycle.get(runId)!;
    const lastMessage = completion.mock.calls.at(-1)![1];
    const threadJson = lastMessage.split('thread_context:\n')[1].split('\n\n')[0];
    const sentThread = JSON.parse(threadJson);
    const localEvidence = {
        requestCount: sentThread.requests.length,
        omittedRequestCount: sentThread.omittedRequestCount,
        pendingProposal: sentThread.pendingProposal !== null,
        pendingCommandCount: sentThread.pendingProposal.commands.length,
        omittedPendingCommandCount: sentThread.pendingProposal.omittedCommandCount,
        lastCommit: sentThread.lastCommit !== null,
        commitStanding: sentThread.lastCommit.standing,
        committedCommandCount: sentThread.lastCommit.commands.length,
        omittedCommittedCommandCount: sentThread.lastCommit.omittedCommandCount,
        measuredDeltaCount: sentThread.lastCommit.measuredDeltas.length,
        omittedMeasuredDeltaCount: sentThread.lastCommit.omittedMeasuredDeltaCount,
        bytes: new TextEncoder().encode(`thread_context:\n${threadJson}`).byteLength,
    };
    expect(run.contextEvidence).toMatchObject({
        revision: input.projectRevision,
        grants,
        budgets: run.budgets,
        included: { trackCount: 5, receiptCount: 1 },
    });
    expect(run.contextEvidence!.included.thread!.local).toEqual(localEvidence);
    const authority = JSON.parse(lastMessage.split('run_authority:\n')[1].split('\n\n')[0]);
    expect(authority).toEqual({ grants: run.grants, budgets: run.budgets });
    expect(run.grants.allowedOperationPrefixes).not.toHaveLength(0);
    expect(Object.keys(run.budgets.limits)).not.toHaveLength(0);
}

function toolsFrom(attempt: ProviderAttemptAdmission) {
    return (attempt.request.tools ?? []).map((tool) => ({ type: 'function' as const, function: tool }));
}

function assertSentWindow(attempts: ProviderAttemptAdmission[], label: string): void {
    expect(attempts.length).toBeGreaterThan(0);
    expect(completion).toHaveBeenCalledTimes(attempts.length);
    for (const [index, attempt] of attempts.entries()) {
        const [system, user, options] = completion.mock.calls[index]!;
        expect(attempt.backend).toBe('webllm');
        expect(attempt.request.dataPolicy).toBe('local-only');
        const rawSystem = attempt.request.messages.find((message) => message.role === 'system')!.content;
        const rawUser = attempt.request.messages.find((message) => message.role === 'user')!.content;
        const tools = toolsFrom(attempt);
        expect(tools.length).toBeGreaterThan(0);
        expect(system).toBe(serializeWebLlmToolPlanningPrompt(rawSystem, tools));
        expect(user).toBe(rawUser);
        expect(
            budgetLocalPlanningRequest({
                systemPrompt: system,
                userMessage: user,
                windowTokens: 32768,
                configuredMaxOutputTokens: attempt.request.limits.maxOutputTokens,
            })
        ).toMatchObject({
            status: 'admitted',
            promptTokens: options.estimatedPromptTokens,
            maxOutputTokens: options.maxTokens,
        });
        const systemTokens = estimateConservativePromptTokens(system);
        const userTokens = estimateConservativePromptTokens(user);
        const needed =
            systemTokens + userTokens + LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS + LOCAL_PLANNING_REPLY_RESERVE_TOKENS;
        console.info(
            'production-local-window',
            JSON.stringify({
                case: label,
                turn: index + 1,
                needed,
                headroom: 32768 - needed,
                tools: tools.length,
                systemTokens,
                userTokens,
            })
        );
        expect(needed).toBeLessThanOrEqual(32768);
        expect(tools.map((tool) => tool.function.name)).not.toContain('brief.compile');
    }
}

const clarification = [
    {
        id: 'clarify',
        name: 'command.batch.decline',
        arguments: {
            kind: 'clarify',
            reason: 'Choose the chorus width before proposing changes.',
            questions: ['How wide should the chorus be?'],
        },
    },
];

beforeEach(() => {
    completion.mockReset();
    aiBackendPreferenceStore.set('webllm');
    llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: DEFAULT_WEBLLM_MODEL_ID });
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
            detectedAt: 1,
        },
    });
    expect(getBackendChain({ operation: 'tools' })).toEqual(['webllm']);
    const seed = createPlanningProject(getProjectContext(), 5);
    configureMetricGoalProject({
        label: 'production local planning window',
        sections: (seed.sections ?? []).map((section) => ({ ...section, color: '#4a90d9' })),
        tracks: seed.tracks.map((track) => {
            if (track.kind !== 'audio' && track.kind !== 'midi') {
                throw new Error('Expected a source track.');
            }
            return {
                ...createTrack({ id: track.id, name: track.name, kind: track.kind }),
                clips: track.clips.map((clip) => {
                    if (
                        clip.fadeInBeats === undefined ||
                        clip.fadeOutBeats === undefined ||
                        clip.gain === undefined ||
                        clip.color === undefined ||
                        clip.locked === undefined ||
                        clip.muted === undefined
                    ) {
                        throw new Error('Expected a complete planning clip fixture.');
                    }
                    return {
                        ...clip,
                        trackId: track.id,
                        fadeInBeats: clip.fadeInBeats,
                        fadeOutBeats: clip.fadeOutBeats,
                        gain: clip.gain,
                        color: clip.color,
                        locked: clip.locked,
                        muted: clip.muted,
                    };
                }),
                devices: track.devices.map((device) => {
                    if (device.name === undefined || device.parameters === undefined) {
                        throw new Error('Expected a complete planning device fixture.');
                    }
                    return {
                        id: device.id,
                        name: device.name,
                        type: device.type,
                        bypassed: device.bypassed,
                        parameterValues: Object.fromEntries(
                            device.parameters.map((parameter) => [parameter.id, parameter.value])
                        ),
                    };
                }),
            };
        }),
    });
    const project = projectStore.value;
    if (!project || seed.productionBrief?.schemaVersion !== 1) {
        throw new Error('Expected the configured project and brief.');
    }
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: fixtureUuid('local-window-project'),
        initialized: true,
        productionBrief: { ...seed.productionBrief, schemaVersion: 1 },
    });
    vcaGroupStore.set({
        groups: [{ id: groupId, name: 'Drums VCA', gain: 0.75, muted: false, trackIds: [seed.tracks[0]!.id] }],
    });
    transportStore.set({ ...transportStore.value!, tempo: 124, metronomeVolume: 0.5 });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetMetricGoalProject();
    vcaGroupStore.set({ groups: [] });
    clipSelectionStore.set({ selectedClipId: null, selectedClipIds: [], marqueeSelection: null });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {}, migratedAbsoluteNoteClipIds: [] });
    aiBackendPreferenceStore.set('auto');
    llmStatusStore.set({ state: 'idle' });
    capabilityStore.set({ phase: 'idle' });
});

it('fits the production planning turn with live authority, resume, receipts and a full bounded thread', async () => {
    const prompt = 'make the chorus wider and tame the harshness on the lead vocal';
    const context = getProjectContext();
    expect(querySemanticProject({ type: 'project-summary' }).items).not.toHaveLength(0);
    const projectRevision = captureProjectRevision();
    const thread = createFullThreadContext();
    const resume = createResumedPlanningRun(prompt, projectRevision);
    const attempts: ProviderAttemptAdmission[] = [];
    completion.mockImplementation(async (system: string, user: string) => {
        if (completion.mock.calls.length === 1) {
            return JSON.stringify(literalMetricIntakeTurn(user, system));
        }
        if (completion.mock.calls.length === 2) {
            return JSON.stringify([{ id: 'query', name: 'project.query', arguments: { type: 'project-summary' } }]);
        }
        return JSON.stringify(clarification);
    });
    const result = await parsePromptToActions({
        prompt,
        context,
        projectRevision,
        thread,
        streamIdentity: { runId, requestId: `request-${fixtureUuid('local-window')}`, cancellationGeneration: 0 },
        onProviderAttempt: (attempt) => {
            attempts.push(attempt);
            return { status: 'admitted' };
        },
    });
    expect(result.rejectionReason, JSON.stringify(result)).toBeUndefined();
    expect(completion).toHaveBeenCalledTimes(3);
    expect(attempts).toHaveLength(3);
    assertSentWindow(attempts, 'resumed-planning');
    assertResumedPlanningContext({ prompt, projectRevision, resume, thread });
    const summary = readReceiptSummary(completion.mock.calls[2]![1]);
    expect(summary.truncated).toBe(false);
    expect(decodeReceiptContext(summary.value)).toEqual(result.applicationToolReceipts);
    expect(result.applicationToolReceipts).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ callId: 'query', toolName: 'project.query', status: 'success' }),
        ])
    );
    expect(context.tracks).toHaveLength(5);
    expect(context.sections).toHaveLength(5);
    expect(trackStore.value!.tracks).toHaveLength(5);
});

it('fits a discovered 64-onset receipt with live authority, resume and a full bounded thread', async () => {
    const state = trackStore.value!;
    const vocal = state.tracks[2]!;
    const clipId = vocal.clips[0]!.id;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== vocal.id) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) => (clip.id !== clipId ? clip : { ...clip, audioBufferId: bufferId })),
            };
        }),
    });
    // The OS worker is the I/O seam; source selection, revision checks, paging and receipts stay real.
    const hits = Array.from({ length: 65 }, (_, index) => ({
        sampleOffset: 400000 + index * 512,
        confidence: 0.10000000000000002,
    }));
    class OnsetWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror = null;
        onmessageerror = null;
        postMessage() {
            this.onmessage?.({ data: { status: 'complete', hits } });
        }
        terminate() {}
    }
    vi.stubGlobal('Worker', OnsetWorker);
    const source = metricGoalAudioBuffer(() => 0, 10);
    const readBuffer = vi
        .spyOn(audioBufferCache, 'get')
        .mockImplementation((id) => (id === bufferId ? source : undefined));
    flushAutomergeStorageWrites();
    const prompt = 'Find source transients on the lead vocal before proposing edits.';
    const projectRevision = captureProjectRevision();
    const thread = createFullThreadContext();
    const resume = createResumedPlanningRun(prompt, projectRevision);
    const attempts: ProviderAttemptAdmission[] = [];
    completion.mockImplementation(async (system: string, user: string) => {
        const turn = completion.mock.calls.length;
        if (turn === 1) {
            return JSON.stringify(literalMetricIntakeTurn(user, system));
        }
        if (turn === 2) {
            return JSON.stringify([
                {
                    id: 'discover',
                    name: 'agent.catalog.discover',
                    arguments: { category: 'analysis', names: ['analysis.detectTransients'] },
                },
            ]);
        }
        if (turn === 3) {
            return JSON.stringify([{ id: 'onsets', name: 'analysis.detectTransients', arguments: { clipId } }]);
        }
        return JSON.stringify(clarification);
    });
    const result = await parsePromptToActions({
        prompt,
        context: getProjectContext(),
        projectRevision,
        thread,
        streamIdentity: {
            runId,
            requestId: `request-${fixtureUuid('local-window-onsets')}`,
            cancellationGeneration: 0,
        },
        onProviderAttempt: (attempt) => {
            attempts.push(attempt);
            return { status: 'admitted' };
        },
        onMeasurementAttempt: () => ({ status: 'admitted', settle: () => {} }),
    });
    expect(result.rejectionReason, JSON.stringify(result)).toBeUndefined();
    expect(attempts).toHaveLength(4);
    assertSentWindow(attempts, 'resumed-planning-discovered-onsets');
    assertResumedPlanningContext({ prompt, projectRevision, resume, thread });
    expect(result.applicationToolReceipts).toEqual(
        expect.arrayContaining([expect.objectContaining({ callId: 'onsets', status: 'success' })])
    );
    expect(readBuffer).toHaveBeenCalledWith(bufferId);
    const selected = toolsFrom(attempts[3]!).map((tool) => tool.function.name);
    expect(selected).toHaveLength(37);
    expect(selected).toContain('analysis.detectTransients');
    expect(selected).toContain('selectCreativeInterpretation');
    expect(selected).toContain('command.batch.propose');
    const summary = readReceiptSummary(completion.mock.calls[3]![1]);
    expect(summary.truncated).toBe(false);
    expect(decodeReceiptContext(summary.value)).toEqual(result.applicationToolReceipts);
    expect(result.applicationToolReceipts).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                callId: 'onsets',
                status: 'success',
                data: expect.objectContaining({
                    kind: 'transient-onset-read',
                    clipId,
                    totalHitCount: 65,
                    hits: hits.slice(0, 64).map((hit) => ({
                        sourceSeconds: hit.sampleOffset / source.sampleRate,
                        confidence: hit.confidence,
                    })),
                }),
            }),
        ])
    );
});

it.each([false, true])('fits answer entry, intake and answer projections: Explain=%s', async (explain) => {
    const attempts: ProviderAttemptAdmission[] = [];
    completion.mockImplementation(async (system: string) => {
        const turn = completion.mock.calls.length;
        if (!explain && turn === 1) {
            return JSON.stringify([{ id: 'enter-answer', name: 'answer.respond', arguments: {} }]);
        }
        if (turn === (explain ? 1 : 2)) {
            return JSON.stringify([advertisedAnswerIntake(system)]);
        }
        return JSON.stringify([{ id: 'answer', name: 'answer.respond', arguments: structuralAnswerArguments }]);
    });
    const input: PlanningInput = {
        prompt: 'Describe the project structure.',
        context: getProjectContext(),
        projectRevision: captureProjectRevision(),
        thread: createFullThreadContext(),
        onProviderAttempt: (attempt) => {
            attempts.push(attempt);
            return { status: 'admitted' };
        },
    };
    if (explain) {
        input.profile = 'readonly-answer';
    }
    const result = await parsePromptToActions(input);
    expect(result.rejectionReason, JSON.stringify(result)).toBeUndefined();
    expect(result.planningOutcome).toMatchObject({ kind: 'answer' });
    expect(result.actions).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
    expect(attempts).toHaveLength(explain ? 2 : 3);
    assertSentWindow(attempts, explain ? 'Explain' : 'answer-intake');
    const names = attempts.map((attempt) => toolsFrom(attempt).map((tool) => tool.function.name));
    if (!explain) {
        expect(names[0]).toContain('selectCreativeInterpretation');
        expect(names[0]).toContain('command.batch.propose');
    }
    expect(names[explain ? 0 : 1]).toContain('selectAnswerInterpretation');
    expect(names.at(-1)).toContain('answer.respond');
    expect(names.at(-1)).not.toContain('selectCreativeInterpretation');
    expect(names.at(-1)).not.toContain('command.batch.propose');
    if (explain) {
        expect(attempts.every((attempt) => attempt.request.limits.maxOutputTokens === 2048)).toBe(true);
    }
});

it.each(['intake', 'answer', 'Explain'] as const)('refuses an unadvertised proposal in the %s phase', async (phase) => {
    const attempts: ProviderAttemptAdmission[] = [];
    const projectRevision = captureProjectRevision();
    const tracks = structuredClone(trackStore.value);
    completion.mockImplementation(async (system: string) => {
        const turn = completion.mock.calls.length;
        if (phase !== 'Explain' && turn === 1) {
            return JSON.stringify([{ id: 'enter-answer', name: 'answer.respond', arguments: {} }]);
        }
        if (phase === 'answer' && turn === 2) {
            return JSON.stringify([advertisedAnswerIntake(system)]);
        }
        return JSON.stringify([
            {
                id: 'forbidden-proposal',
                name: 'command.batch.propose',
                arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 180 } }] },
            },
        ]);
    });
    const input: PlanningInput = {
        prompt: 'Describe the project structure.',
        context: getProjectContext(),
        projectRevision,
        onProviderAttempt: (attempt) => {
            attempts.push(attempt);
            return { status: 'admitted' };
        },
    };
    if (phase === 'Explain') {
        input.profile = 'readonly-answer';
    }
    const result = await parsePromptToActions(input);
    expect(result.rejectionReason).toContain('not advertised');
    expect(result.actions).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
    expect(trackStore.value).toEqual(tracks);
    expect(captureProjectRevision()).toBe(projectRevision);
    expect(toolsFrom(attempts.at(-1)!).map((tool) => tool.function.name)).not.toContain('command.batch.propose');
    assertSentWindow(attempts, `rejected-${phase}`);
});

it('carries real workflow capability data for ordinary whole-project local planning without the brief compiler', async () => {
    const clip = trackStore.value!.tracks[0]!.clips[0]!;
    clipSelectionStore.set({ selectedClipId: clip.id, selectedClipIds: [clip.id], marqueeSelection: null });
    midiStore.set({
        notesByClipId: {
            [clip.id]: [
                { id: 'note-a', pitch: 60, startBeat: 1, duration: 1.02, velocity: 100 },
                { id: 'note-b', pitch: 60, startBeat: 2, duration: 1, velocity: 100 },
            ],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
        migratedAbsoluteNoteClipIds: [clip.id],
    });
    flushAutomergeStorageWrites();
    const attempts: ProviderAttemptAdmission[] = [];
    completion.mockImplementation(async (system: string, user: string) => {
        if (completion.mock.calls.length === 1) {
            return JSON.stringify(literalMetricIntakeTurn(user, system));
        }
        return JSON.stringify(clarification);
    });
    const result = await parsePromptToActions({
        prompt: 'Help me improve the whole project.',
        context: getProjectContext(),
        projectRevision: captureProjectRevision(),
        thread: createFullThreadContext(),
        onProviderAttempt: (attempt) => {
            attempts.push(attempt);
            return { status: 'admitted' };
        },
    });
    expect(result.rejectionReason, JSON.stringify(result)).toBeUndefined();
    expect(attempts).toHaveLength(2);
    assertSentWindow(attempts, 'whole-project-workflow');
    const message = completion.mock.calls[1]![1];
    const capabilities = JSON.parse(message.split('capability_schemas:\n')[1].split('\n\n')[0]);
    expect(JSON.parse(capabilities.availableCapabilities)).toMatchObject({
        midiOverlapTransformCapability: {
            actionType: 'removeShortMidiOverlaps',
            selectedClips: [{ clipId: clip.id, shortOverlapCount: 1 }],
        },
    });
    expect(toolsFrom(attempts[1]!).map((tool) => tool.function.name)).toContain('selectWorkflowCapability');
});
