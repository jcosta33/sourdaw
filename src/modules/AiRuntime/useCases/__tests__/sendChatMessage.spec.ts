import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    createVerifiedBatchReceipt,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type ChatMessage, type ChatState } from '../../models/Chat';
import { type IntentResult } from '../../models/IntentResult';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { clearPendingActionConfirmations } from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { agentRunControls } from '../getAgentRunControlProjection';
import { type ProjectContext } from '../getProjectContext';
import { sendChatMessage } from '../sendChatMessage';

type MockBackend = 'native' | 'cloud' | 'webllm' | 'none';
type ExecuteAppActionBatch = (typeof import('#/modules/Command/useCases'))['executeAppActionBatch'];
type ExecuteVersionedCommandBatchEnvelope =
    (typeof import('#/modules/Command/useCases'))['executeVersionedCommandBatchEnvelope'];
type AppAction = Parameters<ExecuteAppActionBatch>[0][number];
const { clear: clearAgentRuns, get: getAgentRun } = agentRunLifecycle;
const { list: getAgentRunControlProjections } = agentRunControls;
type MockWebLlmEngine = {
    interruptGenerate: () => void;
    chat: { completions: { create: (payload: Record<string, unknown>) => Promise<unknown> } };
};
type ProposedConfirmationInput = {
    id: string;
    runId?: string;
    risk?: {
        level: string;
        reason: string | null;
    };
    commandBatch?: {
        serialized: string;
        authority: {
            projectId: string;
            baseRevision: string;
            scope: { targetIds: readonly string[] };
            grants: { delete: boolean; autoCommit: boolean };
            budgets: { maxCommands: number; maxDeletedObjects: number };
        };
    };
};

const mocks = vi.hoisted(() => {
    const backend: { value: MockBackend } = { value: 'native' };
    const webLlmEngine: { value: MockWebLlmEngine | null } = { value: null };
    return {
        chatStoreValue: { value: null as ChatState | null },
        projectRevision: { value: 'revision-1' },
        executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        executeAppActionBatch: vi.fn<ExecuteAppActionBatch>(),
        executeVersionedCommandBatchEnvelope: vi.fn<ExecuteVersionedCommandBatchEnvelope>(),
        describeAction: vi.fn((_action: AppAction) => 'Remove track'),
        generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
        parsePromptToActions:
            vi.fn<(prompt: string, context: ProjectContext, signal?: AbortSignal) => Promise<IntentResult>>(),
        getProjectContext: vi.fn<() => ProjectContext>(),
        notifyAiChange: vi.fn(),
        pushAiActionGroup: vi.fn(),
        setChatGenerating: vi.fn(),
        appendChatMessage: vi.fn<(message: ChatMessage) => void>(),
        updateChatMessage: vi.fn<(messageId: string, updates: Partial<ChatMessage>) => void>(),
        setActiveAborter: vi.fn<(aborter: AbortController | null) => void>(),
        proposePendingActionConfirmation: vi.fn<(input: ProposedConfirmationInput) => { id: string } | null>(),
        nativeEngineReady: { value: true },
        backend,
        cloudAvailable: { value: false },
        webLlmEngine,
        webLlmCreate: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
        webLlmInterrupt: vi.fn(),
        streamCloudChatCompletion:
            vi.fn<
                (
                    messages: Array<{ role: string; content: string }>,
                    onToken: (text: string) => void,
                    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
                ) => Promise<{ status: 'complete' } | { status: 'incomplete'; reason: string }>
            >(),
        rejectPendingConfirmation: { value: false },
    };
});

function setProjectContextWithClip(): void {
    const context = mocks.getProjectContext();
    mocks.getProjectContext.mockReturnValue({
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== 'track-1') {
                return track;
            }
            return {
                ...track,
                clipCount: 1,
                clips: [
                    {
                        id: 'clip-1',
                        name: 'Clip 1',
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 4,
                        noteCount: 0,
                    },
                ],
            };
        }),
    });
}

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => mocks.projectRevision.value,
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: vi.fn(() => mocks.backend.value),
}));

vi.mock('../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: vi.fn(() => mocks.nativeEngineReady.value),
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: vi.fn(() => mocks.cloudAvailable.value),
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: () => mocks.webLlmEngine.value,
}));

vi.mock('../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: () => 'webllm-model',
}));

vi.mock('#/modules/Command/useCases', async (import_original) => {
    const original = await import_original<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        executeAppAction: mocks.executeAppAction,
        executeAppActionBatch: mocks.executeAppActionBatch,
        executeVersionedCommandBatchEnvelope: mocks.executeVersionedCommandBatchEnvelope,
        describeAction: mocks.describeAction,
        generateGroupId: mocks.generateGroupId,
    };
});

vi.mock('../parsePromptToActions', () => ({
    parsePromptToActions: mocks.parsePromptToActions,
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

vi.mock('../../stores/chatStore', () => ({
    chatStore: {
        get value() {
            return mocks.chatStoreValue.value;
        },
    },
    setChatGenerating: mocks.setChatGenerating,
    appendChatMessage: mocks.appendChatMessage,
    updateChatMessage: mocks.updateChatMessage,
    setActiveAborter: mocks.setActiveAborter,
}));

vi.mock('../../stores/pendingActionConfirmationStore', async (import_original) => {
    const original = await import_original<typeof import('../../stores/pendingActionConfirmationStore')>();
    return {
        ...original,
        proposePendingActionConfirmation: (input: Parameters<typeof original.proposePendingActionConfirmation>[0]) => {
            // Spy only: the retained confirmation comes from the real store so
            // confirmPendingChatActions can replay the approved batch in the
            // ADR-0033 confirmation-flow tests below.
            mocks.proposePendingActionConfirmation(input);
            if (mocks.rejectPendingConfirmation.value) {
                input.resourceLease?.release();
                return null;
            }
            return original.proposePendingActionConfirmation(input);
        },
    };
});

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

describe('sendChatMessage injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        // sendChatMessage compiles an agent-risk approval for every
        // confirmation, which captures target fingerprints through the
        // preflight port; this spec's CrdtDocument mock rules out the shared
        // workflow fixture, so a local provider stands in with a projectId
        // matching the (mocked) revision the envelope is compiled against.
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: mocks.projectRevision.value,
            projectInvariantsValid: true,
            targetFingerprints: Object.fromEntries(targetIds.map((targetId) => [targetId, `fingerprint:${targetId}`])),
        }));
        clearPendingActionConfirmations();
        clearAgentRuns();
        mocks.chatStoreValue.value = null;
        mocks.nativeEngineReady.value = true;
        mocks.backend.value = 'native';
        mocks.cloudAvailable.value = false;
        mocks.webLlmEngine.value = null;
        mocks.projectRevision.value = 'revision-1';
        mocks.rejectPendingConfirmation.value = false;
        aiBackendPreferenceStore.set('auto');
        llmStatusStore.set({ state: 'idle' });
        mocks.streamCloudChatCompletion.mockResolvedValue({ status: 'complete' });
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.executeAppActionBatch.mockImplementation((actions: Parameters<ExecuteAppActionBatch>[0]) =>
            Promise.resolve({
                status: 'committed',
                actions: actions.map((action) => ({
                    action,
                    label: mocks.describeAction(action),
                })),
            })
        );
        mocks.executeVersionedCommandBatchEnvelope.mockImplementation(async (input) => {
            const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
            if (parsed.status === 'invalid') {
                throw new Error(parsed.reason);
            }
            const actions = parsed.envelope.commands.map((command) => ({
                type: command.operation,
                payload: command.arguments,
            })) as Parameters<ExecuteAppActionBatch>[0];
            const result = await mocks.executeAppActionBatch(actions, input.options);
            return {
                ...result,
                receipt: createVerifiedBatchReceipt({
                    envelope: parsed.envelope,
                    observedBaseRevision: parsed.envelope.baseRevision,
                    resultingRevision: parsed.envelope.baseRevision,
                    result,
                }),
            };
        });
        mocks.describeAction.mockReturnValue('Remove track');
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [],
            rawText: '',
            requiresConfirmation: false,
        });
        mocks.getProjectContext.mockReturnValue({
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
            tracks: [
                {
                    id: 'track-1',
                    name: 'Track 1',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                },
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange',
            playheadPosition: 0,
        });
    });

    afterEach(() => {
        commandBatchPreflightPort.setProvider(null);
        clearHandlerRegistry();
    });

    it('returns early when chat store is empty', async () => {
        const { setChatGenerating } = await import('../../stores/chatStore');

        await sendChatMessage('hello');

        expect(setChatGenerating).not.toHaveBeenCalled();
    });

    it('returns an exact plan without executing or proposing a commit', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
            rawText: 'plan removing track 1',
            requiresConfirmation: true,
        });

        await sendChatMessage('plan removing track 1', { mode: 'plan' });

        expect(mocks.executeVersionedCommandBatchEnvelope).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ content: expect.stringContaining('Planned without changing the project:') })
        );
        const [projection] = getAgentRunControlProjections();
        if (!projection) {
            throw new Error('Expected the planned run to be retained');
        }
        expect(projection).toMatchObject({
            mode: 'plan',
            phase: 'completed',
            request: 'plan removing track 1',
            allowedActions: { cancel: false, resume: false, retryWorkIds: [] },
        });
        expect(getAgentRun(projection.runId)?.plan).toMatchObject({
            summary: 'Remove track "Track 1"',
            commandIds: [],
            serializedBatchIdentity: null,
        });
        expect(getAgentRun(projection.runId)?.workLeases).toMatchObject([
            { workId: 'provider-planning', ownerKind: 'provider', terminalState: 'completed' },
        ]);
    });

    it('should not execute prompt actions that require confirmation', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
            rawText: 'delete drums',
            requiresConfirmation: true,
        });
        mocks.getProjectContext.mockReturnValue({
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
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-1',
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange',
            playheadPosition: 0,
        });

        await sendChatMessage('delete drums');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({
                projectRevision: 'revision-1',
                actionLabels: ['Remove track "Drums"'],
            })
        );
        const proposedBatch = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0].commandBatch;
        expect(typeof proposedBatch?.serialized).toBe('string');
        expect(proposedBatch?.authority.projectId).not.toBe('');
        expect(proposedBatch?.authority).toMatchObject({
            baseRevision: 'revision-1',
            scope: { targetIds: ['track-1'] },
            grants: { delete: true, autoCommit: false },
            budgets: { maxCommands: 1, maxDeletedObjects: 1 },
        });
        const confirmationUpdate = mocks.updateChatMessage.mock.calls[0]?.[1];
        expect(confirmationUpdate?.isStreaming).toBe(false);
        expect(confirmationUpdate?.content).toContain('requires confirmation');
        expect(confirmationUpdate?.content).toContain('Remove track "Drums"');
        expect(confirmationUpdate?.pendingActionConfirmationId).toMatch(/^prompt-confirmation-/);
        expect(confirmationUpdate?.pendingActionConfirmationStatus).toBe('proposed');
        const [projection] = getAgentRunControlProjections();
        if (!projection) {
            throw new Error('Expected the approval run to be retained');
        }
        expect(projection).toMatchObject({
            mode: 'apply',
            phase: 'waiting-for-approval',
            request: 'delete drums',
        });
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({ runId: projection.runId })
        );
    });

    it('proposes named confirmation instead of executing a destructive clip command', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeClip', payload: { clipId: 'clip-chorus' } }],
            rawText: 'delete Chorus clip',
            requiresConfirmation: true,
        });
        mocks.getProjectContext.mockReturnValue({
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
            tracks: [
                {
                    id: 'track-1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [
                        {
                            id: 'clip-chorus',
                            name: 'Chorus',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 8,
                            noteCount: 0,
                        },
                    ],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-1',
            selectedClipId: 'clip-chorus',
            selectedClipIds: ['clip-chorus'],
            activeView: 'arrange',
            playheadPosition: 0,
        });

        await sendChatMessage('delete Chorus clip');

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({
                projectRevision: 'revision-1',
                actionLabels: ['Remove clip "Chorus"'],
            })
        );
    });

    it('invalidates a prompt when the project changes during planning', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockImplementationOnce(() => {
            mocks.projectRevision.value = 'revision-2';
            return Promise.resolve({
                actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
                rawText: 'delete drums',
                requiresConfirmation: true,
            });
        });

        await sendChatMessage('delete drums');

        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        const invalidationMessage = mocks.appendChatMessage.mock.lastCall?.[0];
        expect(invalidationMessage?.error).toBe(
            'The project changed after this proposal was created. Review and submit the command again.'
        );
        expect(invalidationMessage?.content).toContain('project changed while this command was being planned');
        const [projection] = getAgentRunControlProjections();
        expect(projection).toMatchObject({
            phase: 'cancelled',
            cancellation: { requested: true, acknowledgement: 'transport' },
        });
        expect(getAgentRun(projection!.runId)?.workLeases).toEqual([
            expect.objectContaining({ workId: 'provider-planning', terminalState: 'cancelled' }),
        ]);
    });

    it('lets prompt mode use provider fallback when the preferred native engine is not ready', async () => {
        mocks.nativeEngineReady.value = false;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };

        await sendChatMessage('mute the vocals');

        expect(mocks.parsePromptToActions).toHaveBeenCalledWith(
            'mute the vocals',
            expect.any(Object),
            expect.any(AbortSignal),
            'revision-1'
        );
    });

    it('reports a rejected prompt distinctly and executes nothing', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [],
            rawText: 'save project',
            requiresConfirmation: false,
            rejectionReason: 'Recognized command failed runtime validation: saveProject',
        });

        await sendChatMessage('save project');

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.appendChatMessage).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'user', content: 'save project' })
        );
        const rejectionUserMessage = mocks.appendChatMessage.mock.calls
            .map(([message]) => message)
            .find((message) => message.role === 'user' && message.content === 'save project');
        expect(rejectionUserMessage).toEqual(expect.objectContaining({ role: 'user', content: 'save project' }));
        expect(rejectionUserMessage).not.toHaveProperty('isCommandAction');
        expect(mocks.appendChatMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                role: 'assistant',
                content: 'Command not executed: Recognized command failed runtime validation: saveProject',
                error: 'Recognized command failed runtime validation: saveProject',
            })
        );
    });

    it('reports an empty provider plan as an unmatched command without executing', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [],
            rawText: 'do something unknown',
            requiresConfirmation: false,
        });

        await sendChatMessage('do something unknown');

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        const [userMessage, assistantMessage] = mocks.appendChatMessage.mock.calls.map(([message]) => message);
        expect(userMessage?.role).toBe('user');
        expect(userMessage?.content).toBe('do something unknown');
        expect(userMessage?.isCommandAction).toBe(true);
        expect(assistantMessage?.role).toBe('assistant');
        expect(assistantMessage?.content).toBe('No actions were matched or executed for your command.');
        expect(assistantMessage?.error).toBe('No actions matched');
    });

    it('binds validated provider actions and admission to one project revision', async () => {
        // ADR 0033: multi-command batches must be confirmed, so the direct
        // execution path is exercised with a single bounded-reversible action
        // (the only shape that still auto-allows).
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            executionMode: 'atomic',
        });
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Mute track' }],
        });

        const receipt = await sendChatMessage('mute the vocals');

        expect(receipt?.outcome).toBe('committed');

        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith(
            [action],
            expect.objectContaining({
                source: 'prompt',
                requireCompensation: true,
                shouldExecute: expect.any(Function),
            })
        );
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        const batchOptions = mocks.executeAppActionBatch.mock.calls[0]?.[1];
        if (!activeAborter || !batchOptions?.shouldExecute) {
            throw new Error('Expected prompt execution to preserve Stop authority');
        }
        expect(batchOptions.shouldExecute()).toBe(true);
        activeAborter.abort();
        expect(batchOptions.shouldExecute()).toBe(false);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Executed: mute the vocals', ['muteTrack']);

        mocks.executeAppActionBatch.mockImplementationOnce((_actions, options) => {
            mocks.projectRevision.value = 'revision-2';
            expect(options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({ status: 'cancelled', reason: 'Execution authority revoked', actions: [] });
        });

        await sendChatMessage('mute the vocals');

        expect(mocks.pushAiActionGroup).toHaveBeenCalledTimes(1);
        expect(mocks.notifyAiChange).toHaveBeenCalledTimes(1);
        expect(mocks.updateChatMessage.mock.lastCall?.[1]).toEqual({
            isStreaming: false,
            error: 'The project changed after this proposal was created. Review and submit the command again.',
            content: 'The project changed before this command could commit. Review it and submit the command again.',
        });
        const invalidatedRun = getAgentRunControlProjections().find((projection) => projection.phase === 'cancelled');
        expect(invalidatedRun).toMatchObject({
            phase: 'cancelled',
            cancellation: { requested: true, acknowledgement: 'transport' },
        });
        expect(getAgentRun(invalidatedRun!.runId)?.workLeases).toEqual([
            expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' }),
            expect.objectContaining({ ownerKind: 'command', terminalState: 'cancelled' }),
        ]);
    });

    it('does not report a false command error when provider planning is stopped', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockImplementation(
            (_prompt, _context, signal) =>
                new Promise((resolve) => {
                    signal?.addEventListener(
                        'abort',
                        () => {
                            resolve({ actions: [], rawText: '', requiresConfirmation: false });
                        },
                        { once: true }
                    );
                })
        );

        const pending = sendChatMessage('mute the vocals');
        const activeAborter = mocks.setActiveAborter.mock.calls[0]?.[0];
        if (!activeAborter) {
            throw new Error('Expected prompt mode to expose an active aborter');
        }
        activeAborter.abort();
        await pending;

        expect(mocks.appendChatMessage).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        const [projection] = getAgentRunControlProjections();
        expect(projection).toMatchObject({
            phase: 'cancelled',
            cancellation: { requested: true, acknowledgement: 'transport' },
        });
        expect(getAgentRun(projection!.runId)?.workLeases).toEqual([
            expect.objectContaining({ workId: 'provider-planning', terminalState: 'cancelled' }),
        ]);
    });

    it('passes the active Stop signal to hosted chat before the first token', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        let requestSignal: AbortSignal | undefined;
        mocks.streamCloudChatCompletion.mockImplementation(
            (_messages, _onToken, options) =>
                new Promise((_resolve, reject) => {
                    requestSignal = options?.signal;
                    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );

        const pending = sendChatMessage('How should I mix this?');
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        if (!activeAborter) {
            throw new Error('Expected chat mode to expose an active aborter');
        }
        expect(requestSignal).toBe(activeAborter.signal);
        mocks.cloudAvailable.value = false;
        activeAborter.abort(new DOMException('AbortedByUser', 'AbortError'));
        await pending;

        expect(requestSignal?.aborted).toBe(true);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('marks a token-limited hosted response visibly incomplete', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, onToken) => {
            await Promise.resolve();
            onToken('Partial answer');
            return { status: 'incomplete', reason: 'token limit' };
        });

        await sendChatMessage('How should I mix this?');

        const completionUpdate = mocks.updateChatMessage.mock.calls.find(
            (call) => call[1].error === 'Hosted AI response incomplete (token limit)'
        );
        expect(completionUpdate?.[1].isStreaming).toBe(false);
        expect(completionUpdate?.[1].content).toContain('Response incomplete');
    });

    it('interrupts active WebLLM generation when Stop is requested', async () => {
        mocks.backend.value = 'webllm';
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        let rejectGeneration: (reason: unknown) => void = vi.fn();
        mocks.webLlmCreate.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    rejectGeneration = reject;
                })
        );
        mocks.webLlmInterrupt.mockImplementation(() => {
            rejectGeneration(new DOMException('Aborted', 'AbortError'));
        });
        mocks.webLlmEngine.value = {
            interruptGenerate: mocks.webLlmInterrupt,
            chat: { completions: { create: mocks.webLlmCreate } },
        };

        const pending = sendChatMessage('How should I mix this?');
        await vi.waitFor(() => expect(mocks.webLlmCreate).toHaveBeenCalledTimes(1));
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        if (!activeAborter) {
            throw new Error('Expected chat mode to expose an active aborter');
        }
        activeAborter.abort(new DOMException('AbortedByUser', 'AbortError'));
        await pending;

        expect(mocks.webLlmInterrupt).toHaveBeenCalledTimes(1);
    });

    it('marks a token-limited WebLLM stream visibly incomplete', async () => {
        mocks.backend.value = 'webllm';
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.webLlmCreate.mockResolvedValue({
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { choices: [{ delta: { content: 'Partial answer' }, finish_reason: null }] };
                yield { choices: [{ delta: {}, finish_reason: 'length' }] };
            },
        });
        mocks.webLlmEngine.value = {
            interruptGenerate: mocks.webLlmInterrupt,
            chat: { completions: { create: mocks.webLlmCreate } },
        };

        await sendChatMessage('How should I mix this?');

        const completionUpdate = mocks.updateChatMessage.mock.calls.find(
            (call) => call[1].error === 'WebLLM response incomplete (length)'
        );
        expect(completionUpdate?.[1].content).toContain('Partial answer');
        expect(completionUpdate?.[1].content).toContain('Response incomplete');
    });

    it('preserves partial hosted output when the network stream fails', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, onToken) => {
            await Promise.resolve();
            onToken('Partial answer');
            throw new Error('network disconnected');
        });

        await sendChatMessage('How should I mix this?');

        const failureUpdate = mocks.updateChatMessage.mock.calls.find(
            (call) => call[1].error === 'network disconnected'
        );
        expect(failureUpdate?.[1].content).toContain('Partial answer');
        expect(failureUpdate?.[1].content).toContain('Response incomplete');
    });

    it('treats hosted reconfiguration as terminal cancellation', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.streamCloudChatCompletion.mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await sendChatMessage('How should I mix this?');

        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                isStreaming: false,
                error: 'Hosted AI configuration changed; this response was cancelled.',
            })
        );
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
        const [projection] = getAgentRunControlProjections();
        if (!projection) {
            throw new Error('Expected the cancelled explain run to be retained');
        }
        expect(projection).toMatchObject({
            phase: 'cancelled',
            cancellation: { requested: true, acknowledgement: 'transport' },
        });
        expect(getAgentRun(projection.runId)?.workLeases).toMatchObject([
            { workId: 'provider-response', terminalState: 'cancelled' },
        ]);
    });

    it('claims and settles durable preview work around the isolated command preview', async () => {
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'preview muting the vocals',
            requiresConfirmation: false,
        });
        mocks.executeVersionedCommandBatchEnvelope.mockRejectedValueOnce(new Error('preview stopped'));

        await sendChatMessage('preview muting the vocals', { mode: 'preview' });

        const [projection] = getAgentRunControlProjections();
        if (!projection) {
            throw new Error('Expected the failed preview run to be retained');
        }
        expect(projection).toMatchObject({ phase: 'failed' });
        expect(getAgentRun(projection.runId)?.workLeases).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ownerKind: 'command',
                    cleanupOwner: 'command-preview',
                    terminalState: 'failed',
                }),
            ])
        );
    });

    it('settles preview work when the command preview returns a non-preview outcome', async () => {
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'preview muting the vocals',
            requiresConfirmation: false,
        });
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValueOnce({
            status: 'rejected',
            reason: 'preview rejected',
            actions: [],
        });

        await sendChatMessage('preview muting the vocals', { mode: 'preview' });

        const [projection] = getAgentRunControlProjections();
        if (!projection) {
            throw new Error('Expected the rejected preview run to be retained');
        }
        expect(projection).toMatchObject({ phase: 'failed' });
        expect(getAgentRun(projection.runId)?.workLeases).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ownerKind: 'command',
                    cleanupOwner: 'command-preview',
                    terminalState: 'failed',
                }),
            ])
        );
    });

    it('revokes preview work before settling a revision-invalidated outcome', async () => {
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'preview muting the vocals',
            requiresConfirmation: false,
        });
        mocks.executeVersionedCommandBatchEnvelope.mockImplementationOnce(() => {
            mocks.projectRevision.value = 'revision-2';
            return Promise.resolve({ status: 'conflicted', reason: 'preview target changed', actions: [] });
        });

        await sendChatMessage('preview muting the vocals', { mode: 'preview' });

        const [projection] = getAgentRunControlProjections();
        expect(projection).toMatchObject({
            phase: 'cancelled',
            cancellation: { requested: true, acknowledgement: 'transport' },
        });
        expect(getAgentRun(projection!.runId)?.workLeases).toEqual([
            expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' }),
            expect.objectContaining({ cleanupOwner: 'command-preview', terminalState: 'cancelled' }),
        ]);
    });

    it('does not restore a stale backend after selection changes during generation', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });
        let requestSignal: AbortSignal | undefined;
        mocks.streamCloudChatCompletion.mockImplementation(
            (_messages, _onToken, options) =>
                new Promise((_resolve, reject) => {
                    requestSignal = options?.signal;
                    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );

        const pending = sendChatMessage('How should I mix this?');
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        aiBackendPreferenceStore.set('native');
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        if (!activeAborter) {
            throw new Error('Expected chat mode to expose an active aborter');
        }
        activeAborter.abort();
        await pending;

        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('reports prompt cancellation when the AI configuration changes', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await sendChatMessage('mute the vocals');

        expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                role: 'assistant',
                content: 'Prompt cancelled because the AI configuration changed.',
                error: 'AI configuration changed while the request was running',
            })
        );
    });

    it('should update the existing executing row when a prompt action is not dispatched', async () => {
        const missing_handler = new Error('No handler registered for action: muteTrack');
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } }],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
        });
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'rejected',
            reason: missing_handler.message,
            actions: [],
        });

        await sendChatMessage('mute the vocals');

        expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(assistant_message?.role).toBe('assistant');
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistant_message?.id,
            expect.objectContaining({
                isStreaming: false,
                content: `Failed to execute prompt command atomically: ${missing_handler.message}`,
                error: missing_handler.message,
            })
        );
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
    });

    it('reports a committed prompt action with a distinct follow-up warning', async () => {
        const committedFailure = new Error('Transport synchronization failed');
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'mute the drums',
            requiresConfirmation: false,
        });
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed-with-warning',
            actions: [{ action, label: 'Mute track' }],
            warning: committedFailure.message,
        });

        await sendChatMessage('mute the drums');

        expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'muteTrack', label: 'Mute track' }],
            })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            'Executed: mute the drums. Committed with follow-up warning: Transport synchronization failed',
            ['muteTrack']
        );
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        const committedUpdate = mocks.updateChatMessage.mock.lastCall;
        expect(committedUpdate?.[0]).toBe(assistant_message?.id);
        expect(committedUpdate?.[1].isStreaming).toBe(false);
        expect(committedUpdate?.[1].content).toMatch(/post-commit project follow-up warning.*do not retry/is);
    });

    it('reports a runtime prompt action as executed rather than committed', async () => {
        const action = { type: 'setMetronomeEnabled', payload: { enabled: true } } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'enable the metronome',
            requiresConfirmation: false,
        });
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'executed-with-warning',
            actions: [{ action, label: 'Enable metronome' }],
            warning: 'transport event unavailable',
        });

        await sendChatMessage('enable the metronome');

        expect(mocks.executeVersionedCommandBatchEnvelope).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppActionBatch).toHaveBeenCalledTimes(1);
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            'Executed: enable the metronome. Executed with follow-up warning: transport event unavailable',
            ['setMetronomeEnabled']
        );
        const assistantMessage = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistantMessage?.id,
            expect.objectContaining({
                error: 'Runtime follow-up warning: transport event unavailable',
                content: expect.stringMatching(/runtime command executed.*do not retry/is),
            })
        );
        const [projection] = getAgentRunControlProjections();
        expect(projection?.committedReceipts).toEqual([expect.objectContaining({ revertGroupId: null })]);
    });

    it('does not reanimate a cancelled run when a committed callback arrives after lease cancellation', async () => {
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'mute the drums',
            requiresConfirmation: false,
        });
        mocks.executeAppActionBatch.mockImplementationOnce(async () => {
            const [projection] = getAgentRunControlProjections();
            if (!projection) {
                throw new Error('Expected an executing agent run');
            }
            agentRunLifecycle.cancel({
                runId: projection.runId,
                reason: 'Cancelled while command was in flight.',
            });
            return {
                status: 'committed',
                actions: [{ action, label: 'Mute track' }],
            };
        });

        await sendChatMessage('mute the drums');

        const [projection] = getAgentRunControlProjections();
        expect(projection).toMatchObject({
            phase: 'partially-completed',
            cancellation: { requested: true },
            committedReceipts: [expect.objectContaining({ workId: expect.any(String) })],
        });
    });

    it('does not report execution failure when AI history reporting throws after commit', async () => {
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'mute the drums',
            requiresConfirmation: false,
        });
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed',
            actions: [{ action, label: 'Mute track' }],
        });
        mocks.pushAiActionGroup.mockImplementationOnce(() => {
            throw new Error('AI history unavailable');
        });

        await sendChatMessage('mute the drums');

        const assistantMessage = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistantMessage?.id,
            expect.objectContaining({
                error: 'AI history or notification reporting warning: history: AI history unavailable',
                content: expect.stringMatching(/project change committed.*do not retry/is),
            })
        );
    });

    it('keeps a committed receipt authoritative when run-state persistence fails afterward', async () => {
        const action = {
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true, expectedMuted: false },
        } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'mute the drums',
            requiresConfirmation: false,
        });
        const originalSetItem = Storage.prototype.setItem;
        let commandCommitted = false;
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            if (key === 'sourdaw-agent-runs' && commandCommitted) {
                throw new DOMException('quota exceeded', 'QuotaExceededError');
            }
            originalSetItem.call(this, key, value);
        });
        try {
            mocks.executeAppActionBatch.mockImplementationOnce(async () => {
                commandCommitted = true;
                return { status: 'committed', actions: [{ action, label: 'Mute track' }] };
            });

            const receipt = await sendChatMessage('mute the drums');

            expect(receipt?.outcome).toBe('committed');
            const assistantMessage = mocks.appendChatMessage.mock.calls[1]?.[0];
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                assistantMessage?.id,
                expect.objectContaining({
                    error: expect.stringContaining('recovery state could not be persisted'),
                    content: expect.stringMatching(/project change committed.*do not retry/is),
                })
            );
            expect(getAgentRunControlProjections()[0]).toMatchObject({ phase: 'completed' });
        } finally {
            setItemSpy.mockRestore();
        }
    });

    it('does not persist or report a prefix when a later batch action fails', async () => {
        const later_failure = new Error('second action was not dispatched');
        setProjectContextWithClip();
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [
                { type: 'removeTrack', payload: { trackId: 'track-1' } },
                { type: 'removeClip', payload: { clipId: 'clip-1' } },
            ],
            rawText: 'delete drums and clip',
            requiresConfirmation: false,
        });

        await sendChatMessage('delete drums and clip');

        // ADR 0033: destructive multi-command work must be confirmed, so the
        // destructive pair proposes instead of executing directly.
        const proposal = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        if (!proposal?.id || !proposal.runId) {
            throw new Error('Expected the destructive batch to require confirmation');
        }
        expect(proposal.risk).toEqual({
            level: 'destructive-reversible',
            reason: 'This action removes or replaces project content.',
        });
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'failed',
            reason: later_failure.message,
            actions: [],
        });

        await expect(confirmPendingChatActions({ confirmationId: proposal.id })).resolves.toEqual({
            status: 'failed',
            reason: later_failure.message,
        });
        expect(getAgentRun(proposal.runId)).toMatchObject({
            phase: 'failed',
            errors: [{ code: 'confirmed-command-rejected', message: later_failure.message }],
            committedWork: [],
            workLeases: [
                { workId: 'provider-planning', terminalState: 'completed' },
                { ownerKind: 'command', terminalState: 'failed' },
            ],
        });

        expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        const partialUpdate = mocks.updateChatMessage.mock.lastCall;
        expect(partialUpdate?.[0]).toBe(assistant_message?.id);
        expect(partialUpdate?.[1].error).toBe(later_failure.message);
        expect(partialUpdate?.[1].content).toBe(
            `Failed to execute confirmed actions atomically:\n\n${later_failure.message}`
        );
    });

    it('terminalizes a run when its pending confirmation cannot be retained', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
            rawText: 'delete the drums',
            requiresConfirmation: false,
        });
        mocks.rejectPendingConfirmation.value = true;

        await sendChatMessage('delete the drums');

        const [projection] = getAgentRunControlProjections();
        expect(projection).toMatchObject({
            phase: 'failed',
            errors: [
                expect.objectContaining({
                    code: 'confirmation-not-retained',
                    retriable: true,
                    workId: expect.any(String),
                }),
            ],
        });
    });

    it('reports an ambiguous partial commit without creating AI history or suggesting retry', async () => {
        const reason = 'Automerge storage transaction committed before a later document failed';
        setProjectContextWithClip();
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [
                { type: 'removeTrack', payload: { trackId: 'track-1' } },
                { type: 'removeClip', payload: { clipId: 'clip-1' } },
            ],
            rawText: 'delete drums and clip',
            requiresConfirmation: false,
        });

        await sendChatMessage('delete drums and clip');

        const proposal = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        if (!proposal?.id || !proposal.runId) {
            throw new Error('Expected the destructive batch to require confirmation');
        }
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'ambiguous',
            reason,
            actions: [],
        });

        await expect(confirmPendingChatActions({ confirmationId: proposal.id })).resolves.toEqual({
            status: 'failed',
            reason,
        });

        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        const assistantMessage = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistantMessage?.id,
            expect.objectContaining({
                error: reason,
                content: expect.stringMatching(/uncertain partial commit.*do not retry/is),
            })
        );
    });

    it('reports a full committed batch with a distinct post-commit warning', async () => {
        const warning = 'batch history failed';
        setProjectContextWithClip();
        const firstAction = { type: 'removeTrack', payload: { trackId: 'track-1' } } as const;
        const secondAction = { type: 'removeClip', payload: { clipId: 'clip-1' } } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [firstAction, secondAction],
            rawText: 'delete drums and clip',
            requiresConfirmation: false,
        });

        await sendChatMessage('delete drums and clip');

        const proposal = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        if (!proposal?.id || !proposal.runId) {
            throw new Error('Expected the destructive batch to require confirmation');
        }
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed-with-warning',
            actions: [
                { action: firstAction, label: 'Remove track' },
                { action: secondAction, label: 'Remove clip' },
            ],
            warning,
        });

        await expect(confirmPendingChatActions({ confirmationId: proposal.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(getAgentRun(proposal.runId)).toMatchObject({
            phase: 'completed',
            committedWork: [
                {
                    workId: expect.any(String),
                    receiptIdentity: expect.stringContaining(proposal.runId),
                    revertGroupId: 'group-1',
                },
            ],
            workLeases: [
                { workId: 'provider-planning', terminalState: 'completed' },
                { ownerKind: 'command', terminalState: 'completed' },
            ],
        });

        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [
                    { kind: 'appAction', actionType: 'removeTrack', label: 'Remove track "Track 1"' },
                    { kind: 'appAction', actionType: 'removeClip', label: 'Remove clip "Clip 1"' },
                ],
            })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Confirmed: delete drums and clip', [
            'removeTrack',
            'removeClip',
        ]);
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        const combinedFailureUpdate = mocks.updateChatMessage.mock.lastCall;
        expect(combinedFailureUpdate?.[0]).toBe(assistant_message?.id);
        expect(combinedFailureUpdate?.[1].error).toBe(warning);
        expect(combinedFailureUpdate?.[1].content).toMatch(/committed with a follow-up warning.*do not retry/is);
    });

    it('revokes a confirmed command lease before settling revision invalidation', async () => {
        setProjectContextWithClip();
        const action = { type: 'removeTrack', payload: { trackId: 'track-1' } } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'delete drums',
            requiresConfirmation: false,
        });
        await sendChatMessage('delete drums');
        const proposal = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        if (!proposal?.id || !proposal.runId) {
            throw new Error('Expected the destructive command to require confirmation');
        }
        mocks.executeAppActionBatch.mockImplementationOnce(() => {
            mocks.projectRevision.value = 'revision-2';
            return Promise.resolve({
                status: 'cancelled',
                reason: 'Batch execution authority was revoked',
                actions: [],
            });
        });

        await expect(confirmPendingChatActions({ confirmationId: proposal.id })).resolves.toMatchObject({
            status: 'invalidated',
        });
        expect(getAgentRun(proposal.runId)).toMatchObject({
            phase: 'cancelled',
            cancellation: { generation: 1 },
            workLeases: [
                { workId: 'provider-planning', terminalState: 'completed' },
                { ownerKind: 'command', terminalState: 'cancelled' },
            ],
        });
        expect(agentRunControls.get(proposal.runId)).toMatchObject({
            cancellation: { requested: true, acknowledgement: 'transport' },
        });
    });

    it('retains a late confirmed receipt without reopening a cancelled run', async () => {
        setProjectContextWithClip();
        const firstAction = { type: 'removeTrack', payload: { trackId: 'track-1' } } as const;
        const secondAction = { type: 'removeClip', payload: { clipId: 'clip-1' } } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [firstAction, secondAction],
            rawText: 'delete drums and clip',
            requiresConfirmation: false,
        });
        await sendChatMessage('delete drums and clip');
        const proposal = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        if (!proposal?.id || !proposal.runId) {
            throw new Error('Expected the destructive batch to require confirmation');
        }
        const proposalRunId = proposal.runId;
        mocks.executeAppActionBatch.mockImplementationOnce(async () => {
            agentRunLifecycle.cancel({
                runId: proposalRunId,
                reason: 'Cancelled while the confirmed command was in flight.',
            });
            return {
                status: 'committed',
                actions: [
                    { action: firstAction, label: 'Remove track' },
                    { action: secondAction, label: 'Remove clip' },
                ],
            };
        });

        await expect(confirmPendingChatActions({ confirmationId: proposal.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(getAgentRun(proposalRunId)).toMatchObject({
            phase: 'partially-completed',
            cancellation: { requestedAt: expect.any(Number) },
            committedWork: [expect.objectContaining({ receiptIdentity: expect.any(String) })],
        });
    });

    it('warns after confirmation when the committed run receipt cannot persist', async () => {
        setProjectContextWithClip();
        const firstAction = { type: 'removeTrack', payload: { trackId: 'track-1' } } as const;
        const secondAction = { type: 'removeClip', payload: { clipId: 'clip-1' } } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [firstAction, secondAction],
            rawText: 'delete drums and clip',
            requiresConfirmation: false,
        });
        await sendChatMessage('delete drums and clip');
        const proposal = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        if (!proposal?.id || !proposal.runId) {
            throw new Error('Expected the destructive batch to require confirmation');
        }

        const originalSetItem = Storage.prototype.setItem;
        let commandCommitted = false;
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            if (key === 'sourdaw-agent-runs' && commandCommitted) {
                throw new DOMException('quota exceeded', 'QuotaExceededError');
            }
            originalSetItem.call(this, key, value);
        });
        try {
            mocks.executeAppActionBatch.mockImplementationOnce(async () => {
                commandCommitted = true;
                return {
                    status: 'committed',
                    actions: [
                        { action: firstAction, label: 'Remove track' },
                        { action: secondAction, label: 'Remove clip' },
                    ],
                };
            });

            await expect(confirmPendingChatActions({ confirmationId: proposal.id })).resolves.toEqual({
                status: 'executed',
            });
            const assistantMessage = mocks.appendChatMessage.mock.calls[1]?.[0];
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                assistantMessage?.id,
                expect.objectContaining({
                    error: expect.stringContaining('recovery state could not be persisted'),
                    content: expect.stringMatching(/verified command receipt remains authoritative.*do not retry/is),
                })
            );
            expect(getAgentRun(proposal.runId)).toMatchObject({ phase: 'completed' });
        } finally {
            setItemSpy.mockRestore();
        }
    });
});
