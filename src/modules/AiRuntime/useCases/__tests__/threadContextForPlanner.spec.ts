import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type ChatMessage } from '../../models/Chat';
import { type MeasuredPreview } from '../../models/MeasuredPreview';
import { type ProjectContext } from '../../models/ProjectContext';
import { THREAD_CONTEXT_MAX_BYTES, type ThreadContext } from '../../models/ThreadContext';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { buildThreadContext, type ThreadContextSources } from '../../transformers/buildThreadContext';
import { fitThreadContext } from '../../transformers/fitThreadContext';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { orchestratePromptChatRequest } from '../agentRequestOrchestration/orchestratePromptChatRequest';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { buildAgentContext } from '../buildAgentContext';
import { declareHostedTurnDataCategories } from '../llmOrchestration/declareHostedTurnDataCategories';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { readChatThreadContext } from '../readChatThreadContext';

import { createFullThreadContext, threadRequest } from './threadContextFixture';

/**
 * AC-001 (#4380): a request planned while the chat thread holds a pending proposal or a recent
 * commit carries a bounded `thread_context` section: the thread's earlier requests, the pending
 * proposal's commands and labels, and the last commit's commands, receipts and measured deltas,
 * sized under each profile's byte cap by dropping the oldest turns first, and recorded as run
 * evidence in counts and bytes.
 */

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: vi.fn(() => 'revision-1'),
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() => 'revision-1'),
}));

const mocks = vi.hoisted(() => ({ getProjectContext: vi.fn() }));

vi.mock('../getProjectContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../getProjectContext')>()),
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: () => 'fixture-model' }));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...original,
        tryPresetMatch: vi.fn(original.tryPresetMatch),
        tryParameterizedPath: vi.fn(original.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(original.tryCompoundFastPath),
    };
});

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const GAIN_ACTION = {
    type: 'setTrackGain',
    payload: { trackId: 'track-bass', gainDb: -3, expectedGain: 1 },
} as const;

const MEASURED_PREVIEW: MeasuredPreview = {
    scope: { kind: 'master' },
    range: { startBeat: 0, endBeat: 16, sectionId: null },
    targets: [
        {
            targetId: 'master',
            targetKind: 'master',
            baseline: {},
            preview: {},
            deltas: {
                integratedLoudness: { status: 'compared', delta: -1.5, unit: 'LUFS' },
                stereoWidth: { status: 'incomparable', reason: 'The baseline render is silent.' },
            },
        },
    ],
    batchContentHash: 'batch-hash-1',
    revision: 'revision-1',
};

function message(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}) {
    return { id, role, content, timestamp: 1, ...extra } satisfies ChatMessage;
}

function confirmation(input: {
    runId: string;
    assistantMessageId: string;
    status: 'proposed' | 'executed' | 'cancelled';
    supersededBy?: string | null;
    measuredPreview?: MeasuredPreview;
}): ThreadContextSources['confirmations'][number] {
    const approvalSnapshot: ThreadContextSources['confirmations'][number]['approvalSnapshot'] = {
        actions: [GAIN_ACTION],
        actionLabels: ['Set Bass gain to -3 dB'],
    };
    if (input.measuredPreview !== undefined) {
        approvalSnapshot.measuredPreview = input.measuredPreview;
    }
    return {
        runId: input.runId,
        assistantMessageId: input.assistantMessageId,
        status: input.status,
        supersededBy: input.supersededBy ?? null,
        approvalSnapshot,
    };
}

function receipt(runId: string, revertGroupId: string | null) {
    return { workId: 'batch-1', receiptIdentity: `command:${runId}:batch-1`, revertGroupId, committedAt: 2 };
}

function sources(partial: Partial<ThreadContextSources>): ThreadContextSources {
    return { messages: [], confirmations: [], runs: [], actionGroups: [], ...partial };
}

const CONTEXT_INPUT = { fixedPolicy: 'policy', prompt: 'a bit less', context, projectRevision: 'revision-1' };

/** The planning context for one request; with no thread argument, built exactly as before threads existed. */
function buildContext(...thread: [] | [ThreadContext | null]) {
    if (thread.length === 0) {
        return buildAgentContext(CONTEXT_INPUT);
    }
    return buildAgentContext({ ...CONTEXT_INPUT, thread: thread[0] });
}

function readSection(text: string): Record<string, unknown> {
    const match = /\n\nthread_context:\n(.+)\n\n/u.exec(text);
    if (match?.[1] === undefined) {
        throw new Error('Expected a thread_context section.');
    }
    return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('thread context for the planner', () => {
    describe('reading the thread', () => {
        it('has no state when nothing is pending or committed, and the message carries no section', () => {
            const thread = buildThreadContext(
                sources({
                    messages: [
                        message('user-1', 'user', 'what is the tempo?'),
                        message('assistant-1', 'assistant', 'The tempo is 120 BPM.'),
                        message('user-2', 'user', 'make the bass louder'),
                        message('assistant-2', 'assistant', 'Executing...', { agentRunId: 'run-cancelled' }),
                    ],
                    confirmations: [
                        confirmation({
                            runId: 'run-cancelled',
                            assistantMessageId: 'assistant-2',
                            status: 'cancelled',
                        }),
                        confirmation({
                            runId: 'run-replaced',
                            assistantMessageId: 'assistant-2',
                            status: 'proposed',
                            supersededBy: 'later-confirmation',
                        }),
                    ],
                    runs: [{ runId: 'run-cancelled', receipts: [] }],
                })
            );

            expect(thread).toBeNull();
            const without = buildContext();
            const withNull = buildContext(thread);
            expect(withNull.message).toBe(without.message);
            expect(withNull.localMessage).toBe(without.localMessage);
            expect(withNull.message).not.toContain('thread_context');
            expect(withNull.evidence.included).not.toHaveProperty('thread');
        });

        it('carries the earlier requests and the pending proposal, with its commands and labels', () => {
            const thread = buildThreadContext(
                sources({
                    messages: [
                        message('user-1', 'user', 'what is the tempo?'),
                        message('assistant-1', 'assistant', 'The tempo is 120 BPM.'),
                        message('user-2', 'user', 'make the bass louder'),
                        message('assistant-2', 'assistant', 'Review the change.', { agentRunId: 'run-pending' }),
                    ],
                    confirmations: [
                        confirmation({ runId: 'run-pending', assistantMessageId: 'assistant-2', status: 'proposed' }),
                    ],
                })
            );

            expect(thread).toEqual({
                requests: ['what is the tempo?', 'make the bass louder'],
                pendingProposal: {
                    runId: 'run-pending',
                    commands: [
                        { name: 'setTrackGain', label: 'Set Bass gain to -3 dB', arguments: GAIN_ACTION.payload },
                    ],
                },
                lastCommit: null,
            });
            const built = buildContext(thread);
            for (const text of [built.message, built.localMessage]) {
                expect(text.indexOf('user_request:')).toBeLessThan(text.indexOf('thread_context:'));
                expect(readSection(text)).toMatchObject({
                    requests: [
                        { trust: 'untrusted_user_string', value: 'what is the tempo?', truncated: false },
                        { trust: 'untrusted_user_string', value: 'make the bass louder', truncated: false },
                    ],
                    omittedRequestCount: 0,
                    pendingProposal: {
                        trust: 'untrusted_project_data',
                        commands: [{ name: 'setTrackGain', label: 'Set Bass gain to -3 dB' }],
                        omittedCommandCount: 0,
                    },
                    lastCommit: null,
                });
            }
        });

        it("carries a confirmed commit's commands, receipt id and measured deltas", () => {
            const thread = buildThreadContext(
                sources({
                    messages: [
                        message('user-1', 'user', 'make the bass louder'),
                        message('assistant-1', 'assistant', 'Executed.'),
                    ],
                    confirmations: [
                        confirmation({
                            runId: 'run-committed',
                            assistantMessageId: 'assistant-1',
                            status: 'executed',
                            measuredPreview: MEASURED_PREVIEW,
                        }),
                    ],
                    runs: [{ runId: 'run-committed', receipts: [receipt('run-committed', 'group-1')] }],
                    actionGroups: [{ groupId: 'group-1', reverted: false, actions: [] }],
                })
            );

            expect(thread?.lastCommit).toEqual({
                runId: 'run-committed',
                receiptIds: ['command:run-committed:batch-1'],
                reverted: false,
                commands: [{ name: 'setTrackGain', label: 'Set Bass gain to -3 dB', arguments: GAIN_ACTION.payload }],
                measuredDeltas: [{ targetId: 'master', metric: 'integratedLoudness', delta: -1.5, unit: 'LUFS' }],
            });
            expect(readSection(buildContext(thread).message)).toMatchObject({
                lastCommit: {
                    receiptIds: ['command:run-committed:batch-1'],
                    commands: [{ name: 'setTrackGain' }],
                    measuredDeltas: [{ metric: 'integratedLoudness', delta: -1.5, unit: 'LUFS' }],
                },
            });
        });

        it('reads a direct commit from its run and its history entry, newest commit first', () => {
            const thread = buildThreadContext(
                sources({
                    messages: [
                        message('user-1', 'user', 'mute the pad'),
                        message('assistant-1', 'assistant', 'Executed.', { agentRunId: 'run-older' }),
                        message('user-2', 'user', 'set the tempo to 128'),
                        message('assistant-2', 'assistant', 'Executed.', { agentRunId: 'run-newer' }),
                    ],
                    runs: [
                        { runId: 'run-older', receipts: [receipt('run-older', 'group-older')] },
                        { runId: 'run-newer', receipts: [receipt('run-newer', 'group-newer')] },
                    ],
                    actionGroups: [
                        {
                            groupId: 'group-newer',
                            reverted: true,
                            actions: [{ actionType: 'setTempo', label: 'Set tempo to 128 BPM' }],
                        },
                    ],
                })
            );

            expect(thread?.lastCommit).toEqual({
                runId: 'run-newer',
                receiptIds: ['command:run-newer:batch-1'],
                reverted: true,
                commands: [{ name: 'setTempo', label: 'Set tempo to 128 BPM' }],
                measuredDeltas: [],
            });
        });

        it('reads the chat, confirmation, run and history stores before the request joins the thread', () => {
            clearChatMessages();
            clearPendingActionConfirmations();
            chatStore.set({
                ...chatStore.value!,
                messages: [
                    message('user-1', 'user', 'make the bass louder'),
                    message('assistant-1', 'assistant', 'Review the change.'),
                ],
            });
            proposePendingActionConfirmation({
                id: 'confirmation-1',
                runId: 'run-pending',
                prompt: 'make the bass louder',
                assistantMessageId: 'assistant-1',
                actions: [GAIN_ACTION],
                actionLabels: ['Set Bass gain to -3 dB'],
                projectRevision: 'revision-1',
            });

            expect(readChatThreadContext()).toMatchObject({
                requests: ['make the bass louder'],
                pendingProposal: { runId: 'run-pending', commands: [{ label: 'Set Bass gain to -3 dB' }] },
                lastCommit: null,
            });
            clearChatMessages();
            clearPendingActionConfirmations();
        });
    });

    describe('sizing', () => {
        it('drops the oldest requests first under the cap and keeps the newest', () => {
            const thread = createFullThreadContext();
            const local = fitThreadContext(thread, 'local');
            const section = JSON.parse(local.section.slice('thread_context:\n'.length)) as {
                requests: Array<{ value: string }>;
                omittedRequestCount: number;
            };

            expect(local.evidence.bytes).toBeLessThanOrEqual(THREAD_CONTEXT_MAX_BYTES.local);
            expect(new TextEncoder().encode(local.section).byteLength).toBe(local.evidence.bytes);
            expect(section.omittedRequestCount).toBeGreaterThan(0);
            const kept = section.requests.map((request) => request.value);
            const newestKept = thread.requests.slice(-kept.length);
            expect(kept).toEqual(newestKept);
            expect(kept.at(-1)).toBe(threadRequest(thread.requests.length));
            expect(kept).not.toContain(threadRequest(1));
            expect(local.evidence).toMatchObject({
                requestCount: kept.length,
                omittedRequestCount: thread.requests.length - kept.length,
                pendingProposal: true,
                lastCommit: true,
            });
        });

        it('sizes the local section under a smaller cap than the hosted one, each within its own', () => {
            const thread = createFullThreadContext();
            const hosted = fitThreadContext(thread, 'hosted');
            const local = fitThreadContext(thread, 'local');

            expect(THREAD_CONTEXT_MAX_BYTES.local).toBeLessThan(THREAD_CONTEXT_MAX_BYTES.hosted);
            expect(hosted.evidence.bytes).toBeLessThanOrEqual(THREAD_CONTEXT_MAX_BYTES.hosted);
            expect(local.evidence.bytes).toBeLessThanOrEqual(THREAD_CONTEXT_MAX_BYTES.local);
            expect(local.evidence.bytes).toBeGreaterThan(THREAD_CONTEXT_MAX_BYTES.local / 2);
            expect(hosted.evidence.requestCount).toBeGreaterThan(local.evidence.requestCount);
            const built = buildContext(thread);
            expect(built.message).toContain(hosted.section);
            expect(built.localMessage).toContain(local.section);
        });

        it('keeps the section within the local cap when nothing but its ids and counts fits', () => {
            const thread = createFullThreadContext();
            const oversized = {
                ...thread,
                requests: [`${'x'.repeat(THREAD_CONTEXT_MAX_BYTES.local)}`],
                pendingProposal: {
                    runId: thread.pendingProposal!.runId,
                    commands: [{ name: 'addNotes', label: 'Add notes', arguments: { notes: 'n'.repeat(8_192) } }],
                },
                lastCommit: {
                    ...thread.lastCommit!,
                    receiptIds: thread.lastCommit!.receiptIds.map((id) => `${id}${'r'.repeat(256)}`),
                    commands: [],
                    measuredDeltas: [],
                },
            };

            const local = fitThreadContext(oversized, 'local');

            expect(local.evidence.bytes).toBeLessThanOrEqual(THREAD_CONTEXT_MAX_BYTES.local);
            expect(local.evidence).toMatchObject({ requestCount: 1, omittedPendingCommandCount: 1 });
        });
    });

    describe('the planning request and its evidence', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            vi.mocked(tryPresetMatch).mockReturnValue([]);
            vi.mocked(tryParameterizedPath).mockReturnValue([]);
            vi.mocked(tryCompoundFastPath).mockReturnValue(null);
            mocks.getProjectContext.mockReturnValue(context);
            clearPendingActionConfirmations();
            clearChatMessages();
            agentRunLifecycle.clear();
            agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
            vi.mocked(generateToolPlanningOutcome).mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    { id: 'answer-1', name: 'answer.respond', arguments: { text: 'Lowered.', evidenceCallIds: [] } },
                ],
            });
        });

        afterEach(() => {
            clearPendingActionConfirmations();
            clearChatMessages();
            agentRunLifecycle.clear();
        });

        it('sends the pending proposal to the planner with a chat refinement and records it as run evidence', async () => {
            chatStore.set({
                ...chatStore.value!,
                messages: [
                    message('user-1', 'user', 'make the bass louder'),
                    message('assistant-1', 'assistant', 'Review the change.'),
                ],
            });
            proposePendingActionConfirmation({
                id: 'confirmation-1',
                runId: 'run-pending',
                prompt: 'make the bass louder',
                assistantMessageId: 'assistant-1',
                actions: [GAIN_ACTION],
                actionLabels: ['Set Bass gain to -3 dB'],
                projectRevision: 'revision-1',
            });

            await orchestratePromptChatRequest({
                userText: 'a bit less',
                requestedRoute: 'auto',
                backend: 'webllm',
                interactionMode: 'apply',
                options: undefined,
            });

            const call = vi.mocked(generateToolPlanningOutcome).mock.calls[0];
            const hostedMessage = call?.[1];
            const localMessage = call?.[10];
            if (typeof hostedMessage !== 'string' || typeof localMessage !== 'string') {
                throw new TypeError('Expected the planner to receive both messages.');
            }
            for (const text of [hostedMessage, localMessage]) {
                expect(readSection(text)).toMatchObject({
                    requests: [{ value: 'make the bass louder' }],
                    pendingProposal: {
                        runId: 'run-pending',
                        commands: [{ name: 'setTrackGain', label: 'Set Bass gain to -3 dB' }],
                    },
                });
            }
            const run = readAgentRunState().runs.find((candidate) => candidate.request === 'a bit less');
            expect(run?.contextEvidence?.included.thread).toEqual({
                hosted: expect.objectContaining({
                    requestCount: 1,
                    pendingProposal: true,
                    pendingCommandCount: 1,
                    lastCommit: false,
                    bytes: new TextEncoder().encode(`thread_context:\n${JSON.stringify(readSection(hostedMessage))}`)
                        .byteLength,
                }),
                local: expect.objectContaining({ requestCount: 1, pendingProposal: true, pendingCommandCount: 1 }),
            });
            expect(JSON.stringify(run?.contextEvidence)).not.toContain('make the bass louder');
        });

        it('declares the measurement category on a hosted request whose thread context carries measured deltas', async () => {
            const thread = createFullThreadContext();

            await parsePromptToActions({ prompt: 'a bit less', context, projectRevision: 'revision-1', thread });
            await parsePromptToActions({
                prompt: 'a bit less',
                context,
                projectRevision: 'revision-1',
                thread: { ...thread, lastCommit: { ...thread.lastCommit!, measuredDeltas: [] } },
            });

            const [withDeltas, withoutDeltas] = vi.mocked(generateToolPlanningOutcome).mock.calls;
            expect(withDeltas?.[9]).toMatchObject({ messageDataCategories: ['measurement'] });
            expect(withoutDeltas?.[9]).not.toHaveProperty('messageDataCategories');
            expect(declareHostedTurnDataCategories([], ['measurement'])).toContain('measurement');
            expect(declareHostedTurnDataCategories([])).not.toContain('measurement');
        });

        it("keeps the thread record through the run store's read, and refuses a malformed one", async () => {
            chatStore.set({
                ...chatStore.value!,
                messages: [
                    message('user-1', 'user', 'make the bass louder'),
                    message('assistant-1', 'assistant', 'Review the change.'),
                ],
            });
            proposePendingActionConfirmation({
                id: 'confirmation-1',
                runId: 'run-pending',
                prompt: 'make the bass louder',
                assistantMessageId: 'assistant-1',
                actions: [GAIN_ACTION],
                actionLabels: ['Set Bass gain to -3 dB'],
                projectRevision: 'revision-1',
            });
            await orchestratePromptChatRequest({
                userText: 'a bit less',
                requestedRoute: 'auto',
                backend: 'webllm',
                interactionMode: 'apply',
                options: undefined,
            });
            const state = readAgentRunState();
            const run = state.runs.find((candidate) => candidate.request === 'a bit less');
            const evidence = run?.contextEvidence;
            const threadEvidence = evidence?.included.thread;
            if (!run || !evidence || !threadEvidence) {
                throw new Error('Expected the run to record its thread context.');
            }

            const reread = sanitizeAgentRunState(structuredClone(state));
            const malformedRun = {
                ...run,
                contextEvidence: {
                    ...evidence,
                    included: {
                        ...evidence.included,
                        thread: { hosted: threadEvidence.hosted, local: { bytes: -1 } },
                    },
                },
            };
            const malformed = sanitizeAgentRunState(structuredClone({ ...state, runs: [malformedRun] }));

            const rereadRun = reread.runs.find((candidate) => candidate.runId === run.runId);
            expect(rereadRun?.contextEvidence?.included.thread).toEqual(threadEvidence);
            // Malformed evidence refuses its run whole, as every other malformed evidence field does.
            expect(malformed.runs.map((candidate) => candidate.runId)).not.toContain(run.runId);
        });
    });
});
