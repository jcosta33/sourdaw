import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { agentRunStore } from '../../stores/agentRunStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { readChatThreadContext } from '../readChatThreadContext';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';
import { subscribeAiChangeNotification } from '../subscribeAiChangeNotification';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

/**
 * AC-002 (#4380): a request that refines the pending proposal yields a replacement derived from it,
 * shown as a diff against it, and the earlier proposal is superseded, never applied beside it.
 * Every row runs the chat route against the real stores, Command and CRDT document, with only the
 * provider scripted.
 */

const MIX_PROMPT =
    'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const MIX_PLAN: readonly ProviderCall[] = [
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.7 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-left', pan: -20 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-right', pan: 20 } },
    { name: 'muteTrack', arguments: { trackId: 'track-room-mic', muted: true } },
];

/**
 * Grounding admits each command only on evidence in the request's own text, so this refinement
 * restates the pending change with the one value it alters.
 */
const REFINEMENT_PROMPT =
    'Set Lead Vocal gain to 80%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';

const BASS_GAIN_PROMPT = 'Set Bass gain to 50%, leaving the Drum Bus unchanged.';
const BASS_GAIN_PLAN: readonly ProviderCall[] = [
    { name: 'setTrackGain', arguments: { trackId: 'track-bass', gain: 0.5 } },
];

/** The pending batch with only the Lead Vocal gain changed, as a refinement of the mix proposes it. */
const REFINED_PLAN: readonly ProviderCall[] = MIX_PLAN.map((call) =>
    call.arguments.trackId === 'track-lead-vocal' ? { ...call, arguments: { ...call.arguments, gain: 0.8 } } : call
);

/** One planning run the provider answers: the commands it proposes, and what happens before it proposes them. */
type ProposalScript = {
    calls: readonly ProviderCall[];
    refines?: () => string;
    beforeProposal?: () => Promise<void>;
};

const runtimeMocks = vi.hoisted(() => ({
    generateWebLlmCompletion: vi.fn(),
    gains: new Map<string, number>(),
    pans: new Map<string, number>(),
    mutes: new Map<string, boolean>(),
    getAllSidechainRoutes: vi.fn(() => []),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackGain: vi.fn((trackId: string, gain: number) => {
        runtimeMocks.gains.set(trackId, gain);
    }),
    setTrackMute: vi.fn((trackId: string, muted: boolean) => {
        runtimeMocks.mutes.set(trackId, muted);
    }),
    setTrackPan: vi.fn((trackId: string, pan: number) => {
        runtimeMocks.pans.set(trackId, pan);
    }),
    setTrackSoloGate: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({ getBackendChain: () => ['webllm'] }));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({ resolveBackend: () => 'webllm' }));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
}));

const notificationEventBus = { emit: vi.fn(() => Promise.resolve()), on: vi.fn(() => () => undefined) };

function createTrack(id: string, name: string): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function getTrack(id: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
    if (!track) {
        throw new Error(`Expected track ${id}`);
    }
    return track;
}

function asCommandBatchProposal(calls: readonly ProviderCall[], refines: string | undefined): ProviderCall {
    const proposal: ProviderCall = {
        name: 'command.batch.propose',
        arguments: {
            commands: calls.map((call) => ({ name: call.name, arguments: call.arguments })),
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Apply the exact requested mix changes while preserving the Drum Bus.',
                constraints: ['Leave the Drum Bus unchanged.'],
                scope: {
                    targetIds: [
                        ...new Set(
                            calls.flatMap((call) =>
                                typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : []
                            )
                        ),
                    ],
                    targetRanges: [],
                    protectedTargetIds: ['track-drum-bus'],
                    protectedRanges: [],
                },
                capabilityIds: [...new Set(calls.map((call) => call.name))],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Validate exact track identities, values, and protected Drum Bus state.'],
                stoppingConditions: ['Stop if any target or protected-state precondition fails.'],
            },
        },
    };
    if (refines !== undefined) {
        proposal.arguments.refines = refines;
    }
    return proposal;
}

/**
 * Each planning run is a discovery turn and a proposal turn; the runs take the scripts in order,
 * and a run past the last script (a bounded correction) takes the last one again.
 */
function scriptProvider(scripts: readonly ProposalScript[]): void {
    let turn = 0;
    runtimeMocks.generateWebLlmCompletion.mockImplementation(async () => {
        turn += 1;
        const script = scripts[Math.min(Math.floor((turn - 1) / 2), scripts.length - 1)];
        if (script === undefined) {
            throw new Error('Expected a scripted planning run.');
        }
        if (turn % 2 === 1) {
            const names = [...new Set(script.calls.map((call) => call.name))];
            return JSON.stringify([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }]);
        }
        await script.beforeProposal?.();
        return JSON.stringify([asCommandBatchProposal(script.calls, script.refines?.())]);
    });
}

async function sendChatMessage(prompt: string, options?: Parameters<typeof sendChatMessageWithoutDocumentFlush>[1]) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt, options);
}

function proposedIds(): string[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? [])
        .filter((confirmation) => confirmation.status === 'proposed')
        .map((confirmation) => confirmation.id);
}

/** Proposes the four-command mix through the chat and returns its pending confirmation's id. */
async function proposeTheMix(): Promise<string> {
    await sendChatMessage(MIX_PROMPT);
    const [pendingId] = proposedIds();
    if (pendingId === undefined) {
        throw new Error('Expected the mix to wait for approval.');
    }
    expect(readChatThreadContext()?.pendingProposal?.confirmationId).toBe(pendingId);
    return pendingId;
}

function readRun(runId: string | undefined) {
    return agentRunStore.value?.runs.find((run) => run.runId === runId);
}

function lastAssistantMessage() {
    return chatStore.value?.messages.findLast((message) => message.role === 'assistant');
}

type HeldConfirmation = NonNullable<ReturnType<typeof getPendingActionConfirmation>>;

/** Rewrites one held confirmation in the store, as a later store write would. */
function rewriteConfirmation(id: string, rewrite: (confirmation: HeldConfirmation) => HeldConfirmation): void {
    pendingActionConfirmationStore.set({
        confirmations: (pendingActionConfirmationStore.value?.confirmations ?? []).map((confirmation) => {
            if (confirmation.id !== id) {
                return confirmation;
            }
            return rewrite(confirmation);
        }),
    });
}

const UNTOUCHED_MIX = { gain: 1, pan: 0, muted: false };

function expectMixUntouched(): void {
    for (const trackId of ['track-lead-vocal', 'track-guitar-left', 'track-guitar-right', 'track-room-mic']) {
        expect(getTrack(trackId)).toMatchObject(UNTOUCHED_MIX);
    }
    expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
}

describe('refining the pending proposal', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('refine pending proposal test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus(notificationEventBus);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const tracks = [
            createTrack('track-lead-vocal', 'Lead Vocal'),
            createTrack('track-guitar-left', 'Guitar Left'),
            createTrack('track-guitar-right', 'Guitar Right'),
            createTrack('track-room-mic', 'Room Mic'),
            createTrack('track-drum-bus', 'Drum Bus'),
            createTrack('track-bass', 'Bass'),
        ];
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        for (const track of tracks) {
            runtimeMocks.gains.set(track.id, track.gain);
            runtimeMocks.pans.set(track.id, track.pan);
            runtimeMocks.mutes.set(track.id, track.muted);
        }
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetAiWorkflowCommandPreflightFixture();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('replaces the pending card, settles its run, refuses it, and applies only the replacement once', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();
        const replaced = getPendingActionConfirmation(pendingId);

        await sendChatMessage(REFINEMENT_PROMPT);

        const [replacementId] = proposedIds();
        const replacement = getPendingActionConfirmation(replacementId ?? '');
        expect(replacement).toMatchObject({ status: 'proposed', supersedes: pendingId });
        expect(replacement?.runId).not.toBe(replaced?.runId);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({
            status: 'invalidated',
            supersededBy: replacementId,
            error: 'Replaced by a refined proposal.',
        });
        const replacedMessage = chatStore.value?.messages.find(
            (message) => message.id === replaced?.assistantMessageId
        );
        expect(replacedMessage).toMatchObject({
            pendingActionConfirmationStatus: 'invalidated',
            content: 'This proposal was replaced by a refined one. Review and confirm the new proposal instead.',
        });
        const replacedRun = readRun(replaced?.runId);
        expect(replacedRun?.phase).toBe('cancelled');
        expect(replacedRun?.batches.map((batch) => batch.status)).toEqual(['cancelled']);
        expect(readRun(replacement?.runId)?.phase).toBe('waiting-for-approval');
        expect(readChatThreadContext()?.pendingProposal?.confirmationId).toBe(replacementId);
        expect(getAgentApprovalView({ confirmationId: replacementId ?? '' })?.previousProposalDiff).toEqual({
            previousConfirmationId: pendingId,
            changes: [
                {
                    kind: 'changed',
                    actionType: 'setTrackGain',
                    label: expect.stringContaining('Lead Vocal') as string,
                    fields: [{ field: 'gain', previous: '0.7', next: '0.8' }],
                },
            ],
            unchangedCount: 3,
        });
        const revisionBeforeConfirm = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: pendingId })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'invalidated',
        });

        expectMixUntouched();
        expect(captureProjectRevision()).toBe(revisionBeforeConfirm);
        expect(readRun(replaced?.runId)?.receipts).toHaveLength(0);

        await expect(confirmPendingChatActions({ confirmationId: replacementId ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getTrack('track-lead-vocal')).toMatchObject({ gain: 0.8 });
        expect(getTrack('track-guitar-left')).toMatchObject({ pan: -20 });
        expect(getTrack('track-guitar-right')).toMatchObject({ pan: 20 });
        expect(getTrack('track-room-mic')).toMatchObject({ muted: true });
        const undoEntries = undoHistoryStore.value?.past ?? [];
        expect(undoEntries).toHaveLength(4);
        expect(new Set(undoEntries.map((entry) => entry.groupId)).size).toBe(1);
        expect(readRun(replacement?.runId)?.receipts).toHaveLength(1);
        expect(readRun(replaced?.runId)?.receipts).toHaveLength(0);

        await undo();

        expectMixUntouched();
    });

    it('leaves the pending card as it is when the proposal does not name it', async () => {
        scriptProvider([{ calls: MIX_PLAN }, { calls: BASS_GAIN_PLAN }]);
        const pendingId = await proposeTheMix();

        await sendChatMessage(BASS_GAIN_PROMPT);

        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        expect(readRun(getPendingActionConfirmation(pendingId)?.runId)?.phase).toBe('waiting-for-approval');
        // One low-risk command commits directly when it refines nothing.
        expect(getTrack('track-bass')).toMatchObject({ gain: 0.5 });
        expect(proposedIds()).toEqual([pendingId]);
    });

    it('puts a low-risk single-command refinement to the user and supersedes the card it refines', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: BASS_GAIN_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();

        await sendChatMessage(BASS_GAIN_PROMPT);

        const [replacementId] = proposedIds();
        expect(getPendingActionConfirmation(replacementId ?? '')).toMatchObject({
            status: 'proposed',
            supersedes: pendingId,
            actions: [{ type: 'setTrackGain', payload: { trackId: 'track-bass', gain: 0.5 } }],
        });
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({
            status: 'invalidated',
            supersededBy: replacementId,
        });
        expect(getTrack('track-bass')).toMatchObject({ gain: 1 });
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
    });

    describe('refuses a refinement the planner may not make, and keeps the pending card', () => {
        function expectRefusedAndPendingKept(pendingId: string, reason: string): void {
            expect(proposedIds()).toEqual([pendingId]);
            expect(getPendingActionConfirmation(pendingId)).toMatchObject({ supersededBy: null });
            expect(lastAssistantMessage()?.content).toContain(reason);
            expectMixUntouched();
        }

        it('naming a confirmation other than the pending one', async () => {
            scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => 'prompt-confirmation-other' }]);
            const pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT);

            expectRefusedAndPendingKept(
                pendingId,
                'refines must be the confirmation id of the pending proposal in thread_context'
            );
        });

        it('naming a pending card that is one batch of a multi-batch schedule', async () => {
            let pendingId = '';
            scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => pendingId }]);
            pendingId = await proposeTheMix();
            // A scheduled batch is proposed through the same store; only its recorded position differs.
            rewriteConfirmation(pendingId, (confirmation) => ({
                ...confirmation,
                approvalSnapshot: { ...confirmation.approvalSnapshot, batchPosition: { index: 1, total: 2 } },
            }));

            await sendChatMessage(REFINEMENT_PROMPT);

            expectRefusedAndPendingKept(pendingId, 'The pending proposal is one batch of a multi-batch schedule');
        });

        it('from the Prompt Bar, which plans without a thread', async () => {
            let pendingId = '';
            scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => pendingId }]);
            pendingId = await proposeTheMix();
            const notices: string[] = [];
            const unsubscribe = subscribeAiChangeNotification((notification) => {
                notices.push(notification.summary);
            });

            const submitted = await submitAdmittedPromptRequest({ prompt: REFINEMENT_PROMPT, source: 'prompt-bar' });
            unsubscribe();

            expect(submitted.status).toBe('rejected');
            expect(proposedIds()).toEqual([pendingId]);
            expect(getPendingActionConfirmation(pendingId)).toMatchObject({ supersededBy: null });
            expect(notices).toEqual([
                expect.stringContaining('this request has no pending proposal in thread_context') as string,
            ]);
            expectMixUntouched();
        });

        it('in preview mode, which never proposes a batch for approval', async () => {
            let pendingId = '';
            scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => pendingId }]);
            pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT, { mode: 'preview' });

            expectRefusedAndPendingKept(pendingId, 'which preview mode never proposes');
        });
    });

    describe('reads the refined card again where the replacement persists, and persists nothing once it was', () => {
        const NO_LONGER_PENDING = 'The proposal this request refines is no longer pending';

        it('cancelled by the user', async () => {
            let pendingId = '';
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    beforeProposal: async () => {
                        await cancelPendingChatActions({ confirmationId: pendingId });
                    },
                },
            ]);
            pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT);

            expect(proposedIds()).toEqual([]);
            expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'cancelled', supersededBy: null });
            expect(lastAssistantMessage()).toMatchObject({
                error: expect.stringContaining(NO_LONGER_PENDING) as string,
            });
            expectMixUntouched();
        });

        it('replaced by a re-preview', async () => {
            let pendingId = '';
            let rePreviewId = '';
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    beforeProposal: async () => {
                        const reproposed = await reproposePendingChatActions({ confirmationId: pendingId });
                        rePreviewId = reproposed.status === 'reproposed' ? reproposed.confirmationId : '';
                    },
                },
            ]);
            pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT);

            expect(rePreviewId).not.toBe('');
            expect(proposedIds()).toEqual([rePreviewId]);
            expect(getPendingActionConfirmation(pendingId)?.supersededBy).toBe(rePreviewId);
            expect(lastAssistantMessage()).toMatchObject({
                error: expect.stringContaining(NO_LONGER_PENDING) as string,
            });
            expectMixUntouched();
        });

        it('refuses a confirmation while the chat plans, so the card stays and is replaced', async () => {
            let pendingId = '';
            let confirmation: Awaited<ReturnType<typeof confirmPendingChatActions>> | null = null;
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    beforeProposal: async () => {
                        confirmation = await confirmPendingChatActions({ confirmationId: pendingId });
                    },
                },
            ]);
            pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT);

            expect(confirmation).toEqual({ status: 'busy' });
            expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'invalidated' });
            expectMixUntouched();
        });

        it('applied by a confirmation that settled while the request was planned', async () => {
            let pendingId = '';
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    // A confirmation cannot start while the chat plans (the row above), so this stands
                    // in for one already in flight when the request began and settling during it.
                    beforeProposal: () => {
                        updatePendingActionConfirmationStatus({ confirmationId: pendingId, status: 'executed' });
                        return Promise.resolve();
                    },
                },
            ]);
            pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT);

            expect(proposedIds()).toEqual([]);
            expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'executed', supersededBy: null });
            expect(lastAssistantMessage()).toMatchObject({
                error: expect.stringContaining('The proposal this request refines was already applied') as string,
            });
            expectMixUntouched();
        });

        it('left behind in a project that is no longer open', async () => {
            let pendingId = '';
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    // Opening another project replaces the document; here only the card's recorded
                    // project changes, so nothing but the open-project check can refuse it.
                    beforeProposal: () => {
                        rewriteConfirmation(pendingId, (confirmation) => {
                            const commandBatch = confirmation.approvalSnapshot.commandBatch;
                            if (commandBatch === undefined) {
                                throw new Error('Expected the pending card to record its command batch.');
                            }
                            const authority = { ...commandBatch.authority, projectId: 'project-closed' };
                            return {
                                ...confirmation,
                                approvalSnapshot: {
                                    ...confirmation.approvalSnapshot,
                                    commandBatch: { ...commandBatch, authority },
                                },
                            };
                        });
                        return Promise.resolve();
                    },
                },
            ]);
            pendingId = await proposeTheMix();

            await sendChatMessage(REFINEMENT_PROMPT);

            expect(proposedIds()).toEqual([pendingId]);
            expect(getPendingActionConfirmation(pendingId)?.supersededBy).toBeNull();
            expect(lastAssistantMessage()).toMatchObject({
                error: expect.stringContaining(NO_LONGER_PENDING) as string,
            });
            expectMixUntouched();
        });
    });
});
