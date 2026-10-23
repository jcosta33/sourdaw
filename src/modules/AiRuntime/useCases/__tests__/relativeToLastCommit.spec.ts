import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../../models/LlmActionLimits';
import { agentRunStore } from '../../stores/agentRunStore';
import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore, stopGenerating } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { readLastCommitRequest } from '../../transformers/readLastCommitRequest';
import { revertThreadCommit } from '../agentRequestOrchestration/revertThreadCommit';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { planLastCommitContinuation } from '../planLastCommitContinuation';
import { readChatThreadContext } from '../readChatThreadContext';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

/**
 * AC-003 (#4380): a request relative to the thread's last commit compiles a new batch from the
 * committed batch itself — a further move bound to the committed values, the committed change's
 * group undo, or the same change on the tracks the request names — and never asks the provider to
 * derive the values again. Every row runs the chat route against the real stores, Command and CRDT
 * document, with only the provider scripted.
 */

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const VOCALS_DOWN_3_DB: ProviderCall = { name: 'setTrackGain', arguments: { trackId: 'track-vocals', deltaDb: -3 } };
const MUTE_BASS: ProviderCall = { name: 'muteTrack', arguments: { trackId: 'track-bass', muted: true } };

/** What a provider re-deriving the continuation from scratch would propose: an absolute level. */
const REDERIVED_VOCALS_LEVEL: ProviderCall = {
    name: 'setTrackGain',
    arguments: { trackId: 'track-vocals', gainDb: -5 },
};

const runtimeMocks = vi.hoisted(() => ({
    generateWebLlmCompletion: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

type GroupRevert = Awaited<ReturnType<typeof import('#/modules/Command/useCases').revertActionGroupAtomically>>;

/**
 * What the next group revert ends in, in place of the replay: a batch committing with a warning or
 * one rejected, which Command's own spec pins from the batch result, as the chat must then report it.
 */
const revertMocks = vi.hoisted(() => ({ outcome: null as (() => Promise<GroupRevert>) | null }));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        revertActionGroupAtomically: (groupId: string) => {
            if (revertMocks.outcome !== null) {
                return revertMocks.outcome();
            }
            return actual.revertActionGroupAtomically(groupId);
        },
    };
});

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

function decibelsOf(trackId: string): number {
    return Math.round(20 * Math.log10(getTrack(trackId).gain) * 1000) / 1000;
}

function asCommandBatchProposal(calls: readonly ProviderCall[]): ProviderCall {
    return {
        name: 'command.batch.propose',
        arguments: {
            commands: calls.map((call) => ({ name: call.name, arguments: call.arguments })),
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Apply the exact requested mix changes.',
                constraints: [],
                scope: {
                    targetIds: [
                        ...new Set(
                            calls.flatMap((call) =>
                                [call.arguments.trackId, call.arguments.busId].filter(
                                    (id): id is string => typeof id === 'string'
                                )
                            )
                        ),
                    ],
                    targetRanges: [],
                    protectedTargetIds: [],
                    protectedRanges: [],
                },
                capabilityIds: [...new Set(calls.map((call) => call.name))],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Validate exact track identities and values.'],
                stoppingConditions: ['Stop if any target precondition fails.'],
            },
        },
    };
}

/**
 * Each planning run the provider answers is a discovery turn and a proposal turn; the runs take the
 * plans in order, and any later run takes the last plan again.
 */
function scriptProvider(plans: ReadonlyArray<readonly ProviderCall[]>): void {
    let turn = 0;
    runtimeMocks.generateWebLlmCompletion.mockImplementation(async () => {
        turn += 1;
        const plan = plans[Math.min(Math.floor((turn - 1) / 2), plans.length - 1)];
        if (plan === undefined) {
            throw new Error('Expected a scripted planning run.');
        }
        if (turn % 2 === 1) {
            const names = [...new Set(plan.map((call) => call.name))];
            return JSON.stringify([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }]);
        }
        return JSON.stringify([asCommandBatchProposal(plan)]);
    });
}

async function sendChatMessage(prompt: string, options?: Parameters<typeof sendChatMessageWithoutDocumentFlush>[1]) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt, options);
}

function providerCallCount(): number {
    return runtimeMocks.generateWebLlmCompletion.mock.calls.length;
}

function lastAssistantMessage() {
    return chatStore.value?.messages.findLast((message) => message.role === 'assistant');
}

function proposedIds(): string[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? [])
        .filter((confirmation) => confirmation.status === 'proposed')
        .map((confirmation) => confirmation.id);
}

/** The newest commit's undo entries, as the undo history holds them applied. */
function newestCommittedActions() {
    const past = undoHistoryStore.value?.past ?? [];
    const groupId = past.at(-1)?.groupId;
    return past
        .filter((entry) => entry.groupId === groupId)
        .map((entry) => (entry.kind === 'action' ? entry.action : null));
}

/** Commits "turn Vocals down 3 dB" through the chat, which the risk policy applies directly. */
async function commitVocalsDown3Db(): Promise<void> {
    await sendChatMessage('Turn Vocals down 3 dB');
    expect(proposedIds()).toEqual([]);
    expect(decibelsOf('track-vocals')).toBe(-3);
    expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
}

/** Commits a batch the risk policy puts to the user, by confirming its card. */
async function commitThroughCard(prompt: string): Promise<void> {
    await sendChatMessage(prompt);
    const [pendingId] = proposedIds();
    if (pendingId === undefined) {
        throw new Error(`Expected "${prompt}" to wait for approval: ${lastAssistantMessage()?.error ?? ''}`);
    }
    await expect(confirmPendingChatActions({ confirmationId: pendingId })).resolves.toEqual({ status: 'executed' });
    expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
}

function addTrack(track: Track, kind: Track['kind']): void {
    const current = trackStore.value!;
    trackStore.set({ ...current, tracks: [...current.tracks, { ...track, kind }] });
}

/**
 * Rewrites the newest commit's one undo entry to another forward action, as a commit of that command
 * would have left it: for command shapes the scripted chat route cannot commit on its own.
 */
function rewriteCommittedAction(action: { type: string; payload: Record<string, unknown> }): void {
    const history = undoHistoryStore.value!;
    const newest = history.past.at(-1);
    if (newest?.kind !== 'action') {
        throw new Error('Expected the newest commit to hold an action entry.');
    }
    const rewritten = { ...newest, action: { ...newest.action, ...action } } as typeof newest;
    const earlier = history.past.filter((entry) => entry.groupId !== newest.groupId);
    undoHistoryStore.set({ ...history, past: [...earlier, rewritten] });
}

/** Asserts the request changed nothing and never reached the provider. */
async function expectAnsweredWithoutChange(prompt: string, text: string): Promise<void> {
    const calls = providerCallCount();
    flushAutomergeStorageWrites();
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const entries = undoHistoryStore.value?.past.length ?? 0;

    await sendChatMessage(prompt);

    expect(lastAssistantMessage()?.content).toContain(text);
    expect(providerCallCount()).toBe(calls);
    expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
    expect(undoHistoryStore.value?.past ?? []).toHaveLength(entries);
    expect(proposedIds()).toEqual([]);
}

describe('relative to the last commit', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('relative to last commit test');
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
        trackStore.set({
            tracks: [
                createTrack('track-vocals', 'Vocals'),
                createTrack('track-guitars', 'Guitars'),
                createTrack('track-bass', 'Bass'),
                createTrack('track-keys', 'Keys'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        revertMocks.outcome = null;
        vi.restoreAllMocks();
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

    describe('continues a committed level relative to the committed value', () => {
        it.each([
            ['another 2 dB', -2, -5],
            ['2 dB more', -2, -5],
            ['make it 1 dB less than that', 1, -2],
            ['Please make it 1.5 dB less.', 1.5, -1.5],
        ])(
            '"%s" after a committed 3 dB cut moves Vocals by %s dB, never re-deriving its level',
            async (prompt, deltaDb, landed) => {
                scriptProvider([[VOCALS_DOWN_3_DB], [REDERIVED_VOCALS_LEVEL]]);
                await commitVocalsDown3Db();
                const calls = providerCallCount();

                await sendChatMessage(prompt);

                expect(providerCallCount()).toBe(calls);
                expect(newestCommittedActions()).toEqual([
                    {
                        type: 'setTrackGain',
                        payload: expect.objectContaining({ trackId: 'track-vocals', deltaDb }) as unknown,
                    },
                ]);
                expect(newestCommittedActions()[0]?.payload).not.toHaveProperty('gainDb');
                expect(decibelsOf('track-vocals')).toBe(landed);
                expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
            }
        );

        it('chains: each continuation is the new last commit, continued from its own committed move', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await sendChatMessage('another 2 dB');
            await sendChatMessage('another 2 dB');

            expect(decibelsOf('track-vocals')).toBe(-7);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(3);
            expect(new Set((undoHistoryStore.value?.past ?? []).map((entry) => entry.groupId)).size).toBe(3);
        });

        it('continues a committed level from that level, never from where the fader has moved since', async () => {
            scriptProvider([[{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }]]);
            await sendChatMessage('Set Vocals gain to -6 dB');
            expect(decibelsOf('track-vocals')).toBe(-6);
            // The musician rides the fader back to unity after the commit; the commit still stands.
            await executeAppAction({
                type: 'setTrackGain',
                payload: { trackId: 'track-vocals', gain: 1, expectedGain: getTrack('track-vocals').gain },
            });
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
            const calls = providerCallCount();

            await sendChatMessage('2 dB less');

            expect(providerCallCount()).toBe(calls);
            expect(newestCommittedActions()).toEqual([
                {
                    type: 'setTrackGain',
                    payload: expect.objectContaining({ trackId: 'track-vocals', gainDb: -8 }) as unknown,
                },
            ]);
            expect(decibelsOf('track-vocals')).toBe(-8);
        });

        it('continues only the committed levels of a confirmed batch, leaving its other commands alone', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB, MUTE_BASS]]);
            await sendChatMessage('Turn Vocals down 3 dB and mute Bass');
            const [pendingId] = proposedIds();
            if (pendingId === undefined) {
                throw new Error('Expected the two-command batch to wait for approval.');
            }
            await expect(confirmPendingChatActions({ confirmationId: pendingId })).resolves.toEqual({
                status: 'executed',
            });
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');

            await sendChatMessage('another 2 dB');

            expect(proposedIds()).toEqual([]);
            expect(newestCommittedActions()).toEqual([
                {
                    type: 'setTrackGain',
                    payload: expect.objectContaining({ trackId: 'track-vocals', deltaDb: -2 }) as unknown,
                },
            ]);
            expect(decibelsOf('track-vocals')).toBe(-5);
            expect(getTrack('track-bass').muted).toBe(true);
        });
    });

    describe('undoes the last commit as one group through the revert route', () => {
        it('reverts the committed run, and a second undo is a no-op', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [REDERIVED_VOCALS_LEVEL]]);
            await commitVocalsDown3Db();
            const committedGroupId = undoHistoryStore.value?.past.at(-1)?.groupId;
            const calls = providerCallCount();

            await sendChatMessage('undo that');

            expect(providerCallCount()).toBe(calls);
            expect(decibelsOf('track-vocals')).toBe(0);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
            expect(undoHistoryStore.value?.future.map((entry) => entry.groupId)).toEqual([committedGroupId]);
            expect(lastAssistantMessage()?.content).toContain('Undid the last committed change');
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('undone');

            await expectAnsweredWithoutChange('revert that', 'already undone');
            expect(decibelsOf('track-vocals')).toBe(0);
            expect(undoHistoryStore.value?.future).toHaveLength(1);
        });

        it('reverts a confirmed batch whole, leaving the commit before it applied', async () => {
            scriptProvider([
                [VOCALS_DOWN_3_DB],
                [{ name: 'setTrackGain', arguments: { trackId: 'track-keys', deltaDb: -2 } }, MUTE_BASS],
            ]);
            await commitVocalsDown3Db();
            await sendChatMessage('Turn Keys down 2 dB and mute Bass');
            const [pendingId] = proposedIds();
            await expect(confirmPendingChatActions({ confirmationId: pendingId ?? '' })).resolves.toEqual({
                status: 'executed',
            });
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(3);
            const groupId = undoHistoryStore.value?.past.at(-1)?.groupId;
            const calls = providerCallCount();

            await sendChatMessage('Undo the last change, please.');

            expect(providerCallCount()).toBe(calls);
            expect(decibelsOf('track-keys')).toBe(0);
            expect(getTrack('track-bass').muted).toBe(false);
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);
            expect(undoHistoryStore.value?.future ?? []).toHaveLength(2);
            expect(aiActionHistoryStore.value?.groups.find((group) => group.groupId === groupId)?.reverted).toBe(true);
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('undone');

            await expectAnsweredWithoutChange('undo that', 'already undone');
            expect(getTrack('track-bass').muted).toBe(false);
        });

        it('refuses the whole undo, changing nothing, when one committed command can no longer be undone', async () => {
            scriptProvider([[{ name: 'setTrackGain', arguments: { trackId: 'track-keys', deltaDb: -2 } }, MUTE_BASS]]);
            await commitThroughCard('Turn Keys down 2 dB and mute Bass');
            const groupId = undoHistoryStore.value?.past.at(-1)?.groupId;
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 'track-keys' } });
            expect(trackStore.value?.tracks.some((track) => track.id === 'track-keys')).toBe(false);
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
            const past = undoHistoryStore.value?.past.map((entry) => entry.id);

            await expectAnsweredWithoutChange('undo that', 'nothing was undone');

            expect(lastAssistantMessage()?.error).toContain('project has changed');
            expect(getTrack('track-bass').muted).toBe(true);
            expect(undoHistoryStore.value?.past.map((entry) => entry.id)).toEqual(past);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
            expect(aiActionHistoryStore.value?.groups.find((group) => group.groupId === groupId)?.reverted).toBe(false);
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
        });

        it('reads the group again when it runs, refusing one no longer applied whole or out of the AI history', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const groupId = undoHistoryStore.value?.past.at(-1)?.groupId ?? '';
            const groups = aiActionHistoryStore.value?.groups ?? [];

            aiActionHistoryStore.set({ ...aiActionHistoryStore.value!, groups: [] });
            await expect(revertThreadCommit(groupId)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringContaining('AI history no longer holds') as unknown,
            });
            aiActionHistoryStore.set({ ...aiActionHistoryStore.value!, groups });
            await undo();
            await expect(revertThreadCommit(groupId)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringContaining('no longer stands') as unknown,
            });
            expect(undoHistoryStore.value?.future).toHaveLength(1);
            expect(decibelsOf('track-vocals')).toBe(0);
        });

        it('refuses the undo in preview mode, which never changes the project', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await sendChatMessage('undo that', { mode: 'preview' });

            expect(lastAssistantMessage()?.content).toContain('cannot commit actions');
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toHaveLength(0);
        });
    });

    describe('re-targets the committed change to the tracks the request names', () => {
        it('applies the committed move to the Guitars, leaving the committed Vocals where they are', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [REDERIVED_VOCALS_LEVEL]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await sendChatMessage('do the same to the Guitars');

            expect(providerCallCount()).toBe(calls);
            expect(newestCommittedActions()).toEqual([
                {
                    type: 'setTrackGain',
                    payload: expect.objectContaining({ trackId: 'track-guitars', deltaDb: -3 }) as unknown,
                },
            ]);
            expect(decibelsOf('track-guitars')).toBe(-3);
            expect(decibelsOf('track-vocals')).toBe(-3);
        });

        it('repeats every command of a confirmed batch on each named track', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB, MUTE_BASS]]);
            await sendChatMessage('Turn Vocals down 3 dB and mute Bass');
            const [pendingId] = proposedIds();
            await confirmPendingChatActions({ confirmationId: pendingId ?? '' });
            const calls = providerCallCount();

            await sendChatMessage('now Guitars and Keys too');

            expect(providerCallCount()).toBe(calls);
            const [repeatId] = proposedIds();
            const repeat = pendingActionConfirmationStore.value?.confirmations.find(
                (confirmation) => confirmation.id === repeatId
            );
            expect(repeat?.actions.map((action) => [action.type, action.payload])).toEqual([
                ['setTrackGain', expect.objectContaining({ trackId: 'track-guitars', deltaDb: -3 })],
                ['muteTrack', expect.objectContaining({ trackId: 'track-guitars', muted: true })],
                ['setTrackGain', expect.objectContaining({ trackId: 'track-keys', deltaDb: -3 })],
                ['muteTrack', expect.objectContaining({ trackId: 'track-keys', muted: true })],
            ]);
            await confirmPendingChatActions({ confirmationId: repeatId ?? '' });
            expect(decibelsOf('track-guitars')).toBe(-3);
            expect(decibelsOf('track-keys')).toBe(-3);
            expect(getTrack('track-guitars').muted).toBe(true);
            expect(getTrack('track-keys').muted).toBe(true);
        });

        it('leaves "mute Bass too" to ordinary planning, since it names an action of its own', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await sendChatMessage('mute Bass too');

            expect(providerCallCount()).toBeGreaterThan(calls);
            expect(getTrack('track-bass').muted).toBe(true);
            expect(getTrack('track-bass').gain).toBe(1);
        });

        it.each([
            ['solo Bass too', 'track-solo', 'Solo'],
            ['Solo Bass as well', 'track-solo', 'Solo'],
            ['mute Bass too', 'track-mute', 'Mute'],
        ])(
            'leaves "%s" to ordinary planning though its leading action word is also a track name',
            async (prompt, trackId, name) => {
                addTrack(createTrack(trackId, name), 'audio');
                scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
                await commitVocalsDown3Db();
                const calls = providerCallCount();

                await sendChatMessage(prompt);

                expect(providerCallCount()).toBeGreaterThan(calls);
                expect(decibelsOf(trackId)).toBe(0);
                expect(decibelsOf('track-bass')).toBe(0);
                expect(decibelsOf('track-vocals')).toBe(-3);
            }
        );

        /** Leaves the thread's last commit in the named state before an ordinary `too` request. */
        async function leaveThreadIn(state: string): Promise<void> {
            if (state === 'no commit in the chat') {
                return;
            }
            await commitVocalsDown3Db();
            if (state === 'an undone commit') {
                await undo();
            }
            if (state === 'a commit of unknown standing') {
                clearUndoHistory();
            }
            if (state === 'a commit the history holds partly as callbacks') {
                const history = undoHistoryStore.value!;
                undoHistoryStore.set({
                    ...history,
                    past: history.past.map((entry) => ({
                        id: entry.id,
                        label: entry.label,
                        timestamp: entry.timestamp,
                        source: entry.source,
                        groupId: entry.groupId,
                        kind: 'callback' as const,
                        undo: () => undefined,
                        redo: () => undefined,
                    })),
                });
            }
        }

        describe.each([
            'no commit in the chat',
            'an undone commit',
            'a commit of unknown standing',
            'a commit the history holds partly as callbacks',
        ])('with %s, a too or as-well request naming an action of its own is planned as any request', (state) => {
            it.each([
                ['mute Bass too', MUTE_BASS, () => getTrack('track-bass').muted],
                [
                    'mute the Keys as well',
                    { name: 'muteTrack', arguments: { trackId: 'track-keys', muted: true } },
                    () => getTrack('track-keys').muted,
                ],
                [
                    'turn the Bass down 3 dB too',
                    { name: 'setTrackGain', arguments: { trackId: 'track-bass', deltaDb: -3 } },
                    () => decibelsOf('track-bass') === -3,
                ],
            ])('"%s"', async (prompt, call, landed) => {
                scriptProvider([[VOCALS_DOWN_3_DB], [call]]);
                if (state === 'no commit in the chat') {
                    scriptProvider([[call]]);
                }
                await leaveThreadIn(state);
                const calls = providerCallCount();

                await sendChatMessage(prompt);

                expect(providerCallCount()).toBeGreaterThan(calls);
                expect(lastAssistantMessage()?.error).toBeUndefined();
                expect(landed()).toBe(true);
            });
        });
    });

    describe('refuses or asks, and changes nothing', () => {
        it.each([
            ['another 2 dB', 'no committed change to continue'],
            ['undo that', 'no committed change to undo'],
            ['do the same to the Guitars', 'no committed change to repeat'],
        ])('"%s" with no commit in the chat', async (prompt, text) => {
            scriptProvider([[REDERIVED_VOCALS_LEVEL]]);

            await expectAnsweredWithoutChange(prompt, text);
        });

        it('a continuation of an undone commit', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            await undo();
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('undone');

            await expectAnsweredWithoutChange('another 2 dB', 'was undone');
            await expectAnsweredWithoutChange('do the same to the Guitars', 'was undone');
            expect(decibelsOf('track-vocals')).toBe(0);
        });

        it('an undo or continuation of a commit whose standing the undo history no longer shows', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            clearUndoHistory();
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('unknown');

            await expectAnsweredWithoutChange('undo that', 'no longer shows whether');
            await expectAnsweredWithoutChange('another 2 dB', 'no longer shows whether');
            expect(decibelsOf('track-vocals')).toBe(-3);
        });

        it('a continuation whose committed target is gone from the project', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const current = trackStore.value!;
            trackStore.set({ ...current, tracks: current.tracks.filter((track) => track.id !== 'track-vocals') });
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');

            await expectAnsweredWithoutChange('another 2 dB', 'no longer in the project');
        });

        it.each([
            ['a bit more', 'How many decibels more?'],
            ['less', 'How many decibels less?'],
        ])('an ambiguous continuation "%s" asks how much', async (prompt, question) => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await expectAnsweredWithoutChange(prompt, question);
            expect(decibelsOf('track-vocals')).toBe(-3);
        });

        it('"another" against a committed level, which has no way to go, asks which way', async () => {
            scriptProvider([[{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }]]);
            await sendChatMessage('Set Vocals gain to -6 dB');

            await expectAnsweredWithoutChange('another 2 dB', 'Should it go up or down?');
            expect(decibelsOf('track-vocals')).toBe(-6);
        });

        it.each([
            ['3 dB less', 'undo that'],
            ['4 dB less', 'would reverse it'],
        ])('"%s" against a committed 3 dB cut, which would cancel or reverse it', async (prompt, text) => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await expectAnsweredWithoutChange(prompt, text);
        });

        it('a continuation of a commit that sets no level in decibels', async () => {
            scriptProvider([[MUTE_BASS]]);
            await sendChatMessage('mute Bass');
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');

            await expectAnsweredWithoutChange('another 2 dB', 'sets no level in decibels');
        });

        it('a re-target naming the committed track, or a stretch it cannot read as tracks', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await expectAnsweredWithoutChange('do the same to Vocals', 'already took the last committed change');
            await expectAnsweredWithoutChange('do the same to the snare', 'not a list of this project');
            expect(decibelsOf('track-vocals')).toBe(-3);
        });

        it('a 0 dB continuation, which changes nothing', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await expectAnsweredWithoutChange('0 dB more', 'leaves every committed level where it is');
        });

        it('a continuation of a batch that moved one level and set another asks which to change', async () => {
            scriptProvider([
                [VOCALS_DOWN_3_DB, { name: 'setTrackGain', arguments: { trackId: 'track-bass', gainDb: -6 } }],
            ]);
            await commitThroughCard('Turn Vocals down 3 dB and set Bass gain to -6 dB');

            await expectAnsweredWithoutChange('2 dB more', 'moved some levels and set others');
        });

        it('a continuation or re-target of a change that created a send, which would create another', async () => {
            addTrack(createTrack('track-reverb', 'Reverb'), 'bus');
            scriptProvider([
                [{ name: 'addSend', arguments: { trackId: 'track-vocals', busId: 'track-reverb', levelDb: -12 } }],
            ]);
            await commitThroughCard('Send Vocals to Reverb at -12 dB');
            expect(getTrack('track-vocals').sends).toHaveLength(1);

            await expectAnsweredWithoutChange('2 dB less', 'sets no level in decibels');
            await expectAnsweredWithoutChange('do the same to Bass', 'cannot be repeated on other tracks');
            expect(getTrack('track-vocals').sends).toHaveLength(1);
            expect(getTrack('track-bass').sends).toHaveLength(0);
        });

        it.each([
            ['a send', { type: 'setSend', payload: { trackId: 'track-vocals', busId: 'track-reverb', deltaDb: -3 } }],
            ['the master', { type: 'setMasterGain', payload: { deltaDb: -3 } }],
        ])("a re-target of a committed move of %s, which is no one track's own setting", async (_label, action) => {
            addTrack(createTrack('track-reverb', 'Reverb'), 'bus');
            scriptProvider([
                [{ name: 'addSend', arguments: { trackId: 'track-vocals', busId: 'track-reverb', levelDb: -12 } }],
            ]);
            await commitThroughCard('Send Vocals to Reverb at -12 dB');
            rewriteCommittedAction(action);

            await expectAnsweredWithoutChange('do the same to Bass', 'cannot be repeated on other tracks');
        });

        it('continues a committed send move on the committed track and bus', async () => {
            addTrack(createTrack('track-reverb', 'Reverb'), 'bus');
            scriptProvider([
                [{ name: 'addSend', arguments: { trackId: 'track-vocals', busId: 'track-reverb', levelDb: -12 } }],
            ]);
            await commitThroughCard('Send Vocals to Reverb at -12 dB');
            rewriteCommittedAction({
                type: 'setSend',
                payload: { trackId: 'track-vocals', busId: 'track-reverb', deltaDb: -3 },
            });
            const calls = providerCallCount();

            await sendChatMessage('another 2 dB');

            expect(providerCallCount()).toBe(calls);
            const [continuationId] = proposedIds();
            const continuation = pendingActionConfirmationStore.value?.confirmations.find(
                (confirmation) => confirmation.id === continuationId
            );
            expect(continuation?.actions.map((action) => [action.type, action.payload])).toEqual([
                ['setSend', expect.objectContaining({ trackId: 'track-vocals', busId: 'track-reverb', deltaDb: -2 })],
            ]);
        });

        it('a re-target of a change that created an automation lane', async () => {
            registerHandlerMap(getAutomationHandlers());
            scriptProvider([
                [{ name: 'addAutomationLane', arguments: { trackId: 'track-bass', parameterId: 'gain' } }],
            ]);
            await sendChatMessage('Add automation lane for Bass gain');
            const [pendingId] = proposedIds();
            if (pendingId !== undefined) {
                await confirmPendingChatActions({ confirmationId: pendingId });
            }
            expect(automationStore.value?.lanes.map((lane) => lane.trackId)).toEqual(['track-bass']);
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');

            await expectAnsweredWithoutChange('do the same to Keys', 'cannot be repeated on other tracks');
            expect(automationStore.value?.lanes.map((lane) => lane.trackId)).toEqual(['track-bass']);
        });

        it('a re-target to a track that cannot take the committed change', async () => {
            addTrack(createTrack('track-master', 'Master'), 'master');
            scriptProvider([[{ name: 'removeTrack', arguments: { trackId: 'track-bass' } }]]);
            await commitThroughCard('Remove the Bass track');
            expect(trackStore.value?.tracks.some((track) => track.id === 'track-bass')).toBe(false);

            await expectAnsweredWithoutChange('do the same to the Master', 'cannot take the committed');
            expect(trackStore.value?.tracks.some((track) => track.id === 'track-master')).toBe(true);
        });

        it('a re-target naming a stretch two tracks share asks which one', async () => {
            addTrack(createTrack('track-keys-2', 'Keys'), 'audio');
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await expectAnsweredWithoutChange('do the same to Keys', 'Which track should take the last change');
        });

        it('a re-target larger than one batch', async () => {
            const strings = Array.from({ length: 13 }, (_, index) =>
                createTrack(`track-strings-${String(index + 1)}`, `Strings ${String(index + 1)}`)
            );
            for (const track of strings) {
                addTrack(track, 'audio');
            }
            scriptProvider([[VOCALS_DOWN_3_DB, MUTE_BASS]]);
            await commitThroughCard('Turn Vocals down 3 dB and mute Bass');

            await expectAnsweredWithoutChange(
                `do the same to ${strings.map((track) => track.name).join(', ')}`,
                'more than one batch'
            );
        });

        it('a commit whose revert group the undo history holds only in part as commands', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB, MUTE_BASS]]);
            await commitThroughCard('Turn Vocals down 3 dB and mute Bass');
            const history = undoHistoryStore.value!;
            const groupId = history.past.at(-1)?.groupId;
            const mute = history.past.findLast(
                (entry) => entry.groupId === groupId && entry.kind === 'action' && entry.action.type === 'muteTrack'
            );
            const asCallback = (entry: (typeof history.past)[number]) => ({
                id: entry.id,
                label: entry.label,
                timestamp: entry.timestamp,
                source: entry.source,
                groupId: entry.groupId,
                kind: 'callback' as const,
                undo: () => undefined,
                redo: () => undefined,
            });
            undoHistoryStore.set({
                ...history,
                past: history.past.map((entry) => (entry === mute ? asCallback(entry) : entry)),
            });
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');

            await expectAnsweredWithoutChange('another 2 dB', 'no longer holds the last committed change as one group');
        });

        it.each([
            ['no commit in the chat', 'no committed change to repeat'],
            ['an undone commit', 'was undone'],
            ['a commit of unknown standing', 'no longer shows whether'],
        ])('a too list of track names with %s', async (state, text) => {
            scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
            if (state !== 'no commit in the chat') {
                await commitVocalsDown3Db();
            }
            if (state === 'an undone commit') {
                await undo();
            }
            if (state === 'a commit of unknown standing') {
                clearUndoHistory();
            }

            await expectAnsweredWithoutChange('now Guitars and Keys too', text);
        });

        it('leaves a pending card to its own refinement, never continuing the commit beneath it', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [VOCALS_DOWN_3_DB, MUTE_BASS], [REDERIVED_VOCALS_LEVEL]]);
            await commitVocalsDown3Db();
            await sendChatMessage('Turn Vocals down 3 dB and mute Bass');
            expect(proposedIds()).toHaveLength(1);
            const calls = providerCallCount();

            await sendChatMessage('another 2 dB');

            expect(providerCallCount()).toBeGreaterThan(calls);
            expect(decibelsOf('track-vocals')).toBe(-3);
        });
    });

    describe('reads the whole request in one closed grammar', () => {
        const undoRequest = { kind: 'undo' };
        const another = (figure: number) => ({ kind: 'continue', phrasing: 'another', comparative: 'more', figure });
        const vague = (comparative: string) => ({
            kind: 'continue',
            phrasing: 'comparative',
            comparative,
            figure: null,
        });

        it.each([
            ['actually undo that', undoRequest],
            ['and another 2 dB', another(2)],
            ['undo that, thank you', undoRequest],
            ['take it back', undoRequest],
            ['undo what you just did', undoRequest],
            ['revert the last edit', undoRequest],
            ['an extra 2 dB', another(2)],
            ['another 2 decibels', another(2)],
            ['a touch more', vague('more')],
            ['make it more', vague('more')],
            ['2 dB LESS', { kind: 'continue', phrasing: 'comparative', comparative: 'less', figure: 2 }],
            ['apply the same to the Guitars', { kind: 'retarget', form: 'same', targetText: 'the Guitars' }],
            ['the same for Bass', { kind: 'retarget', form: 'same', targetText: 'Bass' }],
            ['the same to Bass', { kind: 'retarget', form: 'same', targetText: 'Bass' }],
            ['Bass as well', { kind: 'retarget', form: 'too', targetText: 'Bass' }],
            ['  undo that', undoRequest],
            ['take it\tback', undoRequest],
            ['undo that?', { kind: 'none' }],
            ['undo your last change', undoRequest],
            ['slightly more', vague('more')],
            ['another 2', { kind: 'none' }],
            ['do the same to the Guitars please', { kind: 'retarget', form: 'same', targetText: 'the Guitars' }],
        ])('"%s"', (prompt, request) => {
            expect(readLastCommitRequest(prompt)).toEqual(request);
        });

        it('plans "another 2", which states no unit, as any request', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await sendChatMessage('another 2');

            expect(providerCallCount()).toBeGreaterThan(calls);
            expect(decibelsOf('track-vocals')).toBe(-3);
        });

        it('leaves a question about the last change to ordinary planning, never undoing it', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await sendChatMessage('undo that?');

            expect(providerCallCount()).toBeGreaterThan(calls);
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
        });
    });

    describe('compiles from the committed batch at its bounds', () => {
        it('refuses a committed batch the undo history stopped holding after the thread was read', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const thread = readChatThreadContext();
            // A Ctrl+Z, a size cap or a cleared history between the thread read and the plan.
            clearUndoHistory();

            expect(
                planLastCommitContinuation({ prompt: 'another 2 dB', context: getProjectContext(), thread })
            ).toMatchObject({
                status: 'denied',
                reason: expect.stringContaining('no longer holds the last committed change as one group') as unknown,
            });
        });

        it('reads the revert group from the receipt of the commit, not the first receipt its run holds', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
            await commitVocalsDown3Db();
            const firstRunId = readChatThreadContext()?.lastCommit?.runId;
            await sendChatMessage('Mute Bass');
            expect(getTrack('track-bass').muted).toBe(true);
            const thread = readChatThreadContext();
            const commit = thread?.lastCommit;
            const committedGroupId = undoHistoryStore.value?.past.at(-1)?.groupId;
            expect(commit?.runId).not.toBe(firstRunId);
            // A run that commits several batches, as a schedule does, holds one receipt per batch and
            // may hold an earlier batch's receipt first: the scripted chat route commits one batch per
            // run, so the second run is given the first run's receipt ahead of its own.
            const state = agentRunStore.value!;
            const earlierReceipts = state.runs.find((run) => run.runId === firstRunId)?.receipts ?? [];
            expect(earlierReceipts).toHaveLength(1);
            agentRunStore.set({
                ...state,
                runs: state.runs.map((run) =>
                    run.runId === commit?.runId ? { ...run, receipts: [...earlierReceipts, ...run.receipts] } : run
                ),
            });

            expect(planLastCommitContinuation({ prompt: 'undo that', context: getProjectContext(), thread })).toEqual({
                status: 'revert',
                runId: commit?.runId,
                revertGroupId: committedGroupId,
            });
        });

        it('continues a committed level by a figure the float sum would miss, landing on the stated level', async () => {
            scriptProvider([[{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: 0.1 } }]]);
            await sendChatMessage('Set Vocals gain to 0.1 dB');
            expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');

            await sendChatMessage('0.2 dB more');

            expect(newestCommittedActions()).toEqual([
                {
                    type: 'setTrackGain',
                    payload: expect.objectContaining({ trackId: 'track-vocals', gainDb: 0.3 }) as unknown,
                },
            ]);
        });

        it('compiles a re-target of exactly one batch', async () => {
            const strings = Array.from({ length: MAX_LLM_ACTIONS_PER_BATCH }, (_, index) =>
                createTrack(`track-strings-${String(index + 1)}`, `Strings ${String(index + 1)}`)
            );
            for (const track of strings) {
                addTrack(track, 'audio');
            }
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await sendChatMessage(`do the same to ${strings.map((track) => track.name).join(', ')}`);

            expect(providerCallCount()).toBe(calls);
            expect(lastAssistantMessage()?.error).toBeUndefined();
            const [repeatId] = proposedIds();
            const repeat = pendingActionConfirmationStore.value?.confirmations.find(
                (confirmation) => confirmation.id === repeatId
            );
            expect(repeat?.actions.map((action) => [action.type, action.payload])).toEqual(
                strings.map((track) => ['setTrackGain', expect.objectContaining({ trackId: track.id, deltaDb: -3 })])
            );
        });

        it('refuses a continuation the action bridge rejects', async () => {
            scriptProvider([[{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: 6 } }]]);
            await sendChatMessage('Set Vocals gain to 6 dB');
            expect(decibelsOf('track-vocals')).toBe(6);

            await expectAnsweredWithoutChange('2 dB more', 'could not be compiled');
        });

        it('asks when a "the same" list names no track at all', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await expectAnsweredWithoutChange('do the same to the', 'not a list of this project');
        });

        it('refuses a continuation of a committed send whose bus is gone, though its track stands', async () => {
            addTrack(createTrack('track-reverb', 'Reverb'), 'bus');
            scriptProvider([
                [{ name: 'addSend', arguments: { trackId: 'track-vocals', busId: 'track-reverb', levelDb: -12 } }],
            ]);
            await commitThroughCard('Send Vocals to Reverb at -12 dB');
            rewriteCommittedAction({
                type: 'setSend',
                payload: { trackId: 'track-vocals', busId: 'track-reverb', deltaDb: -3 },
            });
            const current = trackStore.value!;
            trackStore.set({ ...current, tracks: current.tracks.filter((track) => track.id !== 'track-reverb') });

            await expectAnsweredWithoutChange('another 2 dB', 'no longer in the project');
        });
    });

    describe('runs the undo only where the run may commit, and reports how it ended', () => {
        function newestRun(request: string) {
            return agentRunStore.value?.runs.findLast((run) => run.request === request);
        }

        it('refuses the undo under an analyze-only trust ceiling, though the mode applies changes', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();

            await sendChatMessage('undo that', { trustCeiling: 'analyze-only' });

            expect(lastAssistantMessage()?.content).toContain('Undoing the last committed change changes the project');
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
        });

        it('cancels the run when the user stops it before the undo runs', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            vi.spyOn(agentRunCancellation, 'bindAbortController').mockReturnValue(() => undefined);
            const settle = agentRunWorkLease.settle.bind(agentRunWorkLease);
            vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
                stopGenerating();
                return settle(input);
            });

            await sendChatMessage('undo that');

            expect(newestRun('undo that')?.phase).toBe('cancelled');
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
        });

        it('refuses the undo when the user undid the commit while it was being planned', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const settle = agentRunWorkLease.settle.bind(agentRunWorkLease);
            vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
                void undo();
                return settle(input);
            });

            await sendChatMessage('undo that');

            expect(lastAssistantMessage()?.content).toContain(
                'Command not executed: The last committed change no longer stands'
            );
            expect(lastAssistantMessage()?.error).toContain('nothing was undone');
            expect(newestRun('undo that')?.phase).toBe('failed');
            expect(decibelsOf('track-vocals')).toBe(0);
            expect(undoHistoryStore.value?.future ?? []).toHaveLength(1);
        });

        it('records the refusal of an undo the user undid while it was planned as a conflict', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const settle = agentRunWorkLease.settle.bind(agentRunWorkLease);
            vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
                void undo();
                return settle(input);
            });

            await sendChatMessage('undo that');

            expect(newestRun('undo that')?.errors.map((error) => error.category)).toEqual(['conflict']);
        });

        it('lists what it undid and the warning of a replay that committed with one', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const label = undoHistoryStore.value?.past.at(-1)?.label ?? '';
            revertMocks.outcome = () => Promise.resolve({ status: 'reverted', warning: 'Effects are still settling' });

            await sendChatMessage('undo that');

            expect(newestRun('undo that')?.phase).toBe('completed');
            expect(lastAssistantMessage()?.content).toBe(
                `Undid the last committed change:\n\n- ${label}\n\nWarning: Effects are still settling`
            );
        });

        it('fails, never reporting an undo, when the group revert throws', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            revertMocks.outcome = () => Promise.reject(new Error('Grouped undo failed: The inverse write failed'));

            await sendChatMessage('undo that');

            expect(lastAssistantMessage()?.content).toBe('Failed to execute prompt command.');
            expect(lastAssistantMessage()?.error).toContain('Grouped undo failed: The inverse write failed');
            expect(newestRun('undo that')?.phase).toBe('failed');
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
        });

        it('completes the run and lists what it undid', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const label = undoHistoryStore.value?.past.at(-1)?.label ?? '';
            expect(label).not.toBe('');

            await sendChatMessage('undo that');

            expect(newestRun('undo that')?.phase).toBe('completed');
            expect(lastAssistantMessage()?.content).toBe(`Undid the last committed change:\n\n- ${label}`);
        });
    });

    describe('undoes only a group the undo and AI histories hold applied whole', () => {
        async function commitTwoCommands(): Promise<string> {
            scriptProvider([[VOCALS_DOWN_3_DB, MUTE_BASS]]);
            await commitThroughCard('Turn Vocals down 3 dB and mute Bass');
            return undoHistoryStore.value?.past.at(-1)?.groupId ?? '';
        }

        it('refuses a group the undo history holds nowhere', async () => {
            const groupId = await commitTwoCommands();
            clearUndoHistory();

            await expect(revertThreadCommit(groupId)).resolves.toMatchObject({ status: 'refused' });
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(getTrack('track-bass').muted).toBe(true);
        });

        it('refuses a group the undo history holds partly undone', async () => {
            const groupId = await commitTwoCommands();
            const history = undoHistoryStore.value!;
            const newest = history.past.at(-1)!;
            undoHistoryStore.set({ ...history, past: history.past.slice(0, -1), future: [newest, ...history.future] });

            await expect(revertThreadCommit(groupId)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringContaining('no longer stands') as unknown,
            });
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(getTrack('track-bass').muted).toBe(true);
        });

        it('refuses a group the AI history holds only as a runtime group', async () => {
            const groupId = await commitTwoCommands();
            const ai = aiActionHistoryStore.value!;
            aiActionHistoryStore.set({
                ...ai,
                groups: ai.groups.map((group) =>
                    group.groupId === groupId ? { ...group, executionKind: 'runtime' as const } : group
                ),
            });

            await expect(revertThreadCommit(groupId)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringContaining('AI history no longer holds') as unknown,
            });
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
        });
    });

    describe('reads the last commit only from the chat, before the fast paths', () => {
        it('plans "undo that" from the Prompt Bar as any request, leaving the chat commit applied', async () => {
            scriptProvider([[VOCALS_DOWN_3_DB], [MUTE_BASS]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await submitAdmittedPromptRequest({ prompt: 'undo that', source: 'prompt-bar' });

            expect(providerCallCount()).toBeGreaterThan(calls);
            expect(decibelsOf('track-vocals')).toBe(-3);
            expect(undoHistoryStore.value?.future ?? []).toEqual([]);
        });

        // A list that is an action word alone gives that action nothing to act on, so it reads only as
        // the track of that name: "mute too" re-targets the Mute track, while "mute Bass too" is a mute.
        it('re-targets a too list a parameterized fast path would read as a mute of another track', async () => {
            addTrack(createTrack('track-mute', 'Mute'), 'audio');
            addTrack(createTrack('track-too', 'Too'), 'audio');
            scriptProvider([[VOCALS_DOWN_3_DB]]);
            await commitVocalsDown3Db();
            const calls = providerCallCount();

            await sendChatMessage('mute too');

            expect(providerCallCount()).toBe(calls);
            expect(newestCommittedActions()).toEqual([
                {
                    type: 'setTrackGain',
                    payload: expect.objectContaining({ trackId: 'track-mute', deltaDb: -3 }) as unknown,
                },
            ]);
            expect(getTrack('track-too').muted).toBe(false);
        });
    });
});
