import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
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
import { chatStore, stopGenerating } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { validateRefinedProposalActions } from '../../validators/admitProposalRefinement';
import { proposalCommandShape } from '../agentReference/proposalCommandShape';
import { readStoredCardRemoval } from '../agentReference/readStoredCardRemoval';
import { pendingActionResourceSettlement } from '../agentRequestOrchestration/pendingActionResourceSettlement';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
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
const INCOMPLETE_REFINEMENT_PLAN: readonly ProviderCall[] = [
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.8 } },
];

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
type AgentRunRecord = NonNullable<typeof agentRunStore.value>['runs'][number];

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

    it('a Stop while the refined card retires leaves the persisted replacement confirmable, applied once', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();
        const settle = pendingActionResourceSettlement.settleBestEffort;
        let stoppedDuringRetirement = false;
        const settlement = vi
            .spyOn(pendingActionResourceSettlement, 'settleBestEffort')
            .mockImplementation(async (input) => {
                if (input.confirmationId === pendingId) {
                    stopGenerating();
                    stoppedDuringRetirement = true;
                }
                await settle(input);
            });

        try {
            await sendChatMessage(REFINEMENT_PROMPT);
        } finally {
            settlement.mockRestore();
        }

        expect(stoppedDuringRetirement).toBe(true);
        const [replacementId] = proposedIds();
        const replacement = getPendingActionConfirmation(replacementId ?? '');
        expect(replacement).toMatchObject({ status: 'proposed', supersedes: pendingId });
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'invalidated' });
        expect(readRun(replacement?.runId)).toMatchObject({
            phase: 'waiting-for-approval',
            cancellation: { requestedAt: null },
        });

        await expect(confirmPendingChatActions({ confirmationId: replacementId ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getTrack('track-lead-vocal')).toMatchObject({ gain: 0.8 });
        expect(getTrack('track-room-mic')).toMatchObject({ muted: true });
        expect(new Set((undoHistoryStore.value?.past ?? []).map((entry) => entry.groupId)).size).toBe(1);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(4);
        expect(readRun(replacement?.runId)?.receipts).toHaveLength(1);
    });

    it('a refined card whose run cannot settle is reported, and the persisted replacement still applies once', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: REFINED_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();
        const replacedRunId = getPendingActionConfirmation(pendingId)?.runId;
        const cancel = agentRunCancellation.cancel;
        const settlement = vi.spyOn(agentRunCancellation, 'cancel').mockImplementation(async (input) => {
            if (input.runId === replacedRunId) {
                throw new Error('run settlement storage unavailable');
            }
            return cancel(input);
        });
        const reports: unknown[] = [];
        const reported = vi.spyOn(logger, 'error').mockImplementation((error) => {
            reports.push(error instanceof Error ? error.message : error);
        });

        try {
            await sendChatMessage(REFINEMENT_PROMPT);
        } finally {
            settlement.mockRestore();
            reported.mockRestore();
        }

        expect(reports).toContain('Refined proposal run settlement could not be persisted');
        const [replacementId] = proposedIds();
        const replacement = getPendingActionConfirmation(replacementId ?? '');
        expect(replacement).toMatchObject({ status: 'proposed', supersedes: pendingId });
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'invalidated' });
        expect(readRun(replacement?.runId)?.phase).toBe('waiting-for-approval');

        await expect(confirmPendingChatActions({ confirmationId: replacementId ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getTrack('track-lead-vocal')).toMatchObject({ gain: 0.8 });
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(4);
        expect(readRun(replacement?.runId)?.receipts).toHaveLength(1);
    });

    it('keeps the four-command card when a full refinement reply omits three requested commands', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: INCOMPLETE_REFINEMENT_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();

        await sendChatMessage(REFINEMENT_PROMPT);

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        expect(lastAssistantMessage()?.content).toContain('omits');
        expectMixUntouched();
    });

    it('keeps the pending card when a reply drops a pan the user expressly left as proposed', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: [REFINED_PLAN[0]!], refines: () => pendingId }]);
        pendingId = await proposeTheMix();
        const revision = captureProjectRevision();

        await sendChatMessage(
            'Set Lead Vocal gain to 80%, leaving Drum Bus unchanged. Drop Room Mic mute and leave Guitar Left pan exactly as proposed, then drop Guitar Right pan from the pending proposal.'
        );

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        // A protection naming a pending change is asked rather than consumed, so the dropped pan never stands.
        expect(lastAssistantMessage()?.content).toContain(
            '"leave Guitar Left pan exactly as proposed" keeps something a pending change acts on'
        );
        expectMixUntouched();
        expect(captureProjectRevision()).toBe(revision);
    });

    it('binds each removal to its exact track and operation in a multi-operation clause', () => {
        const current = trackStore.value;
        trackStore.set({
            ...current!,
            tracks: [
                ...current!.tracks,
                createTrack('track-guitar', 'Guitar'),
                createTrack('track-room-dot', 'Room.Mic'),
            ],
        });
        const context = getProjectContext();
        const leftPan = { type: 'setTrackPan', payload: { trackId: 'track-guitar-left', pan: -20 } };
        const guitarPan = { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: 10 } };
        const leftGain = { type: 'setTrackGain', payload: { trackId: 'track-guitar-left', gain: 0.8 } };
        const dottedMute = { type: 'muteTrack', payload: { trackId: 'track-room-dot', muted: true } };
        const admission = (prompt: string, pendingAction: { type: string; payload: Record<string, unknown> }) =>
            validateRefinedProposalActions({
                pendingActions: [pendingAction],
                actions: [],
                prompt,
                context,
                createdObject: proposalCommandShape.createdObject,
                readRemoval: readStoredCardRemoval,
            }).status;

        expect(admission('Drop Guitar Left pan and leave Guitar pan as proposed.', guitarPan)).toBe('refused');
        expect(admission('Drop Room Mic mute and leave Guitar Left pan as proposed.', leftPan)).toBe('refused');
        expect(admission('Do not drop Guitar Left pan.', leftPan)).toBe('refused');
        expect(admission('Drop Guitar Left pan. Leave Guitar Left pan as proposed.', leftPan)).toBe('refused');
        expect(admission('Drop "Guitar Left and Guitar" pan.', leftPan)).toBe('refused');
        expect(admission('Drop Other Guitar Left pan.', leftPan)).toBe('refused');
        expect(admission('Drop Guitar Left alternate pan.', leftPan)).toBe('refused');
        expect(admission('Drop Guitar Left pan but leave Guitar Left gain as proposed.', leftGain)).toBe('refused');
        expect(admission('Drop Guitar Left pan and leave Guitar pan as proposed.', leftPan)).toBe('valid');
        expect(admission('DROP "Guitar Left" PAN.', leftPan)).toBe('valid');
        expect(admission('Drop "Room.Mic" mute.', dottedMute)).toBe('valid');
    });

    it('drops a track toggle on a stored card only by its own operation word, never by "track"', () => {
        const context = getProjectContext();
        type StoredCommand = { type: string; payload: Record<string, unknown> };
        const leadGain = { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.7 } };
        const bassGain = { type: 'setTrackGain', payload: { trackId: 'track-bass', gain: 0.5 } };
        const bassSolo = { type: 'soloTrack', payload: { trackId: 'track-bass', soloed: true } };
        const roomMute = { type: 'muteTrack', payload: { trackId: 'track-room-mic', muted: true } };
        const roomArm = { type: 'armTrack', payload: { trackId: 'track-room-mic', armed: true } };
        const rows: Array<[readonly StoredCommand[], readonly StoredCommand[], string, 'valid' | 'refused']> = [
            [[leadGain, bassGain, bassSolo], [leadGain], 'Drop the Bass track gain.', 'refused'],
            [[leadGain, bassGain, bassSolo], [leadGain, bassSolo], 'Drop the Bass track gain.', 'valid'],
            [[roomMute, roomArm], [], 'Drop the Room Mic track mute.', 'refused'],
            [[roomMute, roomArm], [roomArm], 'Drop the Room Mic track mute.', 'valid'],
            [[roomMute, roomArm], [roomMute], 'Drop the Room Mic arm.', 'valid'],
            // A stored card drops a command by its target and its operation, so naming the object
            // alone, with or without a generic noun, drops no toggle on it.
            [[roomMute, roomArm], [], 'Drop the Room Mic track.', 'refused'],
            [[roomMute], [], 'Drop Room Mic.', 'refused'],
            [[roomMute], [], 'Drop Room Mic mute.', 'valid'],
        ];
        for (const [pendingActions, actions, prompt, status] of rows) {
            expect({
                pending: pendingActions.map((action) => action.type),
                prompt,
                status: validateRefinedProposalActions({
                    pendingActions,
                    actions,
                    prompt,
                    context,
                    createdObject: proposalCommandShape.createdObject,
                    readRemoval: readStoredCardRemoval,
                }).status,
            }).toEqual({ pending: pendingActions.map((action) => action.type), prompt, status });
        }
    });

    it('keeps the pending card when a reply dropping the Bass gain also drops the pending Bass solo', async () => {
        let pendingId = '';
        const leadGain = { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.7 } };
        scriptProvider([
            {
                calls: [
                    leadGain,
                    { name: 'setTrackGain', arguments: { trackId: 'track-bass', gain: 0.5 } },
                    { name: 'soloTrack', arguments: { trackId: 'track-bass', soloed: true } },
                ],
            },
            { calls: [leadGain], refines: () => pendingId },
        ]);
        await sendChatMessage(
            'Set Lead Vocal gain to 70%, set Bass gain to 50%, and solo Bass, leaving the Drum Bus unchanged.'
        );
        [pendingId = ''] = proposedIds();
        expect(getPendingActionConfirmation(pendingId)?.actions.map((action) => action.type)).toEqual([
            'setTrackGain',
            'setTrackGain',
            'soloTrack',
        ]);

        await sendChatMessage(
            'Drop the Bass track gain from the pending proposal. Set Lead Vocal gain to 70%, leaving the Drum Bus unchanged.'
        );

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        expect(lastAssistantMessage()?.content).toContain('omits a pending');
        expect(getTrack('track-bass')).toMatchObject({ gain: 1, soloed: false });
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
    });

    it('keeps the pending card when a reply dropping the Room Mic mute also drops the pending Room Mic arm', async () => {
        let pendingId = '';
        const leadGain = { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.7 } };
        scriptProvider([
            {
                calls: [
                    leadGain,
                    { name: 'muteTrack', arguments: { trackId: 'track-room-mic', muted: true } },
                    { name: 'armTrack', arguments: { trackId: 'track-room-mic', armed: true } },
                ],
            },
            { calls: [leadGain], refines: () => pendingId },
        ]);
        await sendChatMessage(
            'Set Lead Vocal gain to 70%, mute Room Mic and arm Room Mic, leaving the Drum Bus unchanged.'
        );
        [pendingId = ''] = proposedIds();
        expect(getPendingActionConfirmation(pendingId)?.actions.map((action) => action.type)).toEqual([
            'setTrackGain',
            'muteTrack',
            'armTrack',
        ]);

        await sendChatMessage(
            'Drop the Room Mic track mute from the pending proposal. Set Lead Vocal gain to 70%, leaving the Drum Bus unchanged.'
        );

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        expect(lastAssistantMessage()?.content).toContain('omits a pending');
        expectMixUntouched();
    });

    it.each([
        'Do not drop Guitar Left pan from the pending proposal. Set Lead Vocal gain to 80%, pan Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.',
        'I do not want you to drop Guitar Left pan from the pending proposal. Set Lead Vocal gain to 80%, pan Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.',
        'Set Lead Vocal gain to 80%, do not drop Guitar Left pan, pan Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.',
    ])('keeps the pending card when the user explicitly says not to drop its pan: %s', async (prompt) => {
        let pendingId = '';
        scriptProvider([
            { calls: MIX_PLAN },
            { calls: [REFINED_PLAN[0]!, REFINED_PLAN[2]!, REFINED_PLAN[3]!], refines: () => pendingId },
        ]);
        pendingId = await proposeTheMix();

        await sendChatMessage(prompt);

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        // A negated verb ("do not drop") is no removal form, so the refinement is asked rather than read.
        expect(lastAssistantMessage()?.content).toContain('says what not to do');
        expectMixUntouched();
    });

    it.each([
        [
            'wrong value',
            [{ name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.9 } }, ...MIX_PLAN.slice(1)],
        ],
        [
            'wrong target',
            [{ name: 'setTrackGain', arguments: { trackId: 'track-bass', gain: 0.8 } }, ...MIX_PLAN.slice(1)],
        ],
    ] as const)('keeps the pending card when a refinement uses the %s', async (_case, calls) => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls, refines: () => pendingId }]);
        pendingId = await proposeTheMix();

        await sendChatMessage(REFINEMENT_PROMPT);

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        expectMixUntouched();
    });

    it('admits an expressly added command with one expressly removed command', async () => {
        let pendingId = '';
        scriptProvider([
            { calls: MIX_PLAN },
            { calls: [MIX_PLAN[0]!, MIX_PLAN[2]!, MIX_PLAN[3]!, BASS_GAIN_PLAN[0]!], refines: () => pendingId },
        ]);
        pendingId = await proposeTheMix();

        await sendChatMessage(
            'Drop Guitar Left pan from the pending proposal. Set Lead Vocal gain to 70%, pan Guitar Right 20% right, mute Room Mic, and set Bass gain to 50%, leaving Drum Bus unchanged.'
        );

        const [replacementId] = proposedIds();
        expect(getPendingActionConfirmation(replacementId ?? '')).toMatchObject({
            status: 'proposed',
            supersedes: pendingId,
        });
        expect(getPendingActionConfirmation(replacementId ?? '')?.actions).toHaveLength(4);
        expect(getPendingActionConfirmation(pendingId)?.supersededBy).toBe(replacementId);
    });

    it('admits an expressly removed command without dropping the others', async () => {
        let pendingId = '';
        scriptProvider([
            { calls: MIX_PLAN },
            { calls: [REFINED_PLAN[0]!, REFINED_PLAN[2]!, REFINED_PLAN[3]!], refines: () => pendingId },
        ]);
        pendingId = await proposeTheMix();

        await sendChatMessage(
            'Drop Guitar Left pan from the pending proposal. Set Lead Vocal gain to 80%, pan Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.'
        );

        const [replacementId] = proposedIds();
        expect(getPendingActionConfirmation(replacementId ?? '')).toMatchObject({
            status: 'proposed',
            supersedes: pendingId,
        });
        expect(getPendingActionConfirmation(replacementId ?? '')?.actions.map((action) => action.type)).toEqual([
            'setTrackGain',
            'setTrackPan',
            'muteTrack',
        ]);
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

    it('refuses a Bass-only replacement that silently drops the pending mix', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: BASS_GAIN_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();

        await sendChatMessage(BASS_GAIN_PROMPT);

        expect(proposedIds()).toEqual([pendingId]);
        expect(getPendingActionConfirmation(pendingId)).toMatchObject({ status: 'proposed', supersededBy: null });
        expect(lastAssistantMessage()?.content).toContain('omits');
        expect(getTrack('track-bass')).toMatchObject({ gain: 1 });
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
    });

    it('puts a low-risk one-command refinement to the user after explicit removals', async () => {
        let pendingId = '';
        scriptProvider([{ calls: MIX_PLAN }, { calls: INCOMPLETE_REFINEMENT_PLAN, refines: () => pendingId }]);
        pendingId = await proposeTheMix();

        await sendChatMessage(
            'Set Lead Vocal gain to 80%, leaving Drum Bus unchanged. Drop Guitar Left pan, drop Guitar Right pan, and drop Room Mic mute from the pending proposal.'
        );

        const [replacementId] = proposedIds();
        expect(getPendingActionConfirmation(replacementId ?? '')).toMatchObject({
            status: 'proposed',
            supersedes: pendingId,
        });
        expect(getPendingActionConfirmation(replacementId ?? '')?.actions).toHaveLength(1);
        expect(getPendingActionConfirmation(pendingId)?.supersededBy).toBe(replacementId);
        expectMixUntouched();
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

        it('refuses a replacement while cancellation waits on temporary-asset cleanup', async () => {
            let pendingId = '';
            let releaseCleanup!: () => void;
            const cleanupGate = new Promise<void>((resolve) => {
                releaseCleanup = resolve;
            });
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    beforeProposal: async () => {
                        expect(await cancelPendingChatActions({ confirmationId: pendingId })).toEqual({
                            status: 'cleanup-pending',
                        });
                        expect(getPendingActionConfirmation(pendingId)?.status).toBe('proposed');
                    },
                },
            ]);
            pendingId = await proposeTheMix();
            const originalRunId = getPendingActionConfirmation(pendingId)?.runId;
            if (!originalRunId) {
                throw new Error('Expected the pending card to own a run.');
            }
            agentRunLifecycle.registerTemporaryAsset({
                runId: originalRunId,
                assetId: 'refinement-cancellation-gate',
                kind: 'other',
                cleanupOwner: 'refinement-test',
            });
            const unregister = agentRunCancellation.registerTemporaryAssetCleanup({
                runId: originalRunId,
                assetId: 'refinement-cancellation-gate',
                cleanupOwner: 'refinement-test',
                cleanup: () => cleanupGate,
            });

            try {
                await sendChatMessage(REFINEMENT_PROMPT);

                expect(readRun(originalRunId)?.phase).toBe('cancelled');
                expect(proposedIds()).toEqual([pendingId]);
                expect(getPendingActionConfirmation(pendingId)).toMatchObject({
                    status: 'proposed',
                    supersededBy: null,
                });
                expect(lastAssistantMessage()).toMatchObject({
                    error: expect.stringContaining(NO_LONGER_PENDING) as string,
                });
                expectMixUntouched();
            } finally {
                releaseCleanup();
                unregister();
            }
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

        /** Rewrites the pending card's run in the store, as a lifecycle write landing during planning would. */
        function rewriteRun(runId: string, rewrite: (run: AgentRunRecord) => AgentRunRecord): void {
            const state = agentRunStore.value;
            if (!state) {
                throw new Error('Expected the agent run state.');
            }
            agentRunStore.set({ ...state, runs: state.runs.map((run) => (run.runId === runId ? rewrite(run) : run)) });
        }

        async function refineAfter(change: (pendingId: string, runId: string) => void) {
            let pendingId = '';
            let runId = '';
            scriptProvider([
                { calls: MIX_PLAN },
                {
                    calls: REFINED_PLAN,
                    refines: () => pendingId,
                    beforeProposal: () => {
                        change(pendingId, runId);
                        return Promise.resolve();
                    },
                },
            ]);
            pendingId = await proposeTheMix();
            runId = getPendingActionConfirmation(pendingId)?.runId ?? '';
            const confirmationCount = pendingActionConfirmationStore.value?.confirmations.length;

            await sendChatMessage(REFINEMENT_PROMPT);

            expect(pendingActionConfirmationStore.value?.confirmations).toHaveLength(confirmationCount ?? 0);
            expect(getPendingActionConfirmation(pendingId)?.supersededBy).toBeNull();
            expect(lastAssistantMessage()).toMatchObject({
                error: expect.stringContaining(NO_LONGER_PENDING) as string,
            });
            expectMixUntouched();
            return { pendingId, runId };
        }

        it('settled out of proposed while its run still waits for approval', async () => {
            const { pendingId, runId } = await refineAfter((id) => {
                updatePendingActionConfirmationStatus({ confirmationId: id, status: 'cancelled' });
            });

            expect(getPendingActionConfirmation(pendingId)?.status).toBe('cancelled');
            expect(readRun(runId)).toMatchObject({
                phase: 'waiting-for-approval',
                cancellation: { requestedAt: null },
            });
        });

        it('still proposed while its run no longer waits for approval', async () => {
            const { pendingId, runId } = await refineAfter((_id, run) => {
                rewriteRun(run, (record) => ({ ...record, phase: 'paused' }));
            });

            expect(getPendingActionConfirmation(pendingId)?.status).toBe('proposed');
            expect(readRun(runId)).toMatchObject({ phase: 'paused', cancellation: { requestedAt: null } });
        });

        it('still proposed in a waiting run whose cancellation was already requested', async () => {
            const { pendingId, runId } = await refineAfter((_id, run) => {
                rewriteRun(run, (record) => ({
                    ...record,
                    cancellation: { ...record.cancellation, requestedAt: Date.now(), reason: 'User cancelled.' },
                }));
            });

            expect(getPendingActionConfirmation(pendingId)?.status).toBe('proposed');
            expect(readRun(runId)).toMatchObject({
                phase: 'waiting-for-approval',
                cancellation: { requestedAt: expect.any(Number) as number },
            });
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
