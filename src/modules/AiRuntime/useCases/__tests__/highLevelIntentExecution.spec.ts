import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { MIDI_TRANSFORM_IMPLEMENTATIONS } from '#/modules/AiGeneration/useCases';
import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    clearHandlerRegistry,
    clearMidiTransformRegistry,
    macroStore,
    registerHandlerMap,
    registerMidiTransforms,
    undoStore,
} from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    executeAppAction,
    getVersionedCommandBatchIdempotentReplay,
    parseVersionedCommandBatchEnvelope,
    redo,
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
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { readAgentRunState } from '../../stores/agentRunStore';
import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
    type PendingAppActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { type CommittedEffectFailureResult } from '../agentRequestOrchestration/confirmedBatchOutcomeSupport';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { revertAiActionGroup } from '../aiHistoryActions';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { recoverAgentRunPendingEffects } from '../recoverAgentRunPendingEffects';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    BLUES_CLIP_END_BEAT,
    BLUES_CLIP_START_BEAT,
    BLUES_PROMPT,
    deriveBluesNotes,
    deriveBluesTransformCommands,
    emptyMidiState,
    GENERATED_CLIP_ID,
    GENERATED_TRACK_ID,
    scriptHighLevelIntentProvider,
} from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return { backend, generateWebLlmCompletion: vi.fn() };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const notificationEventBus = {
    emit: vi.fn(() => Promise.resolve()),
    on: vi.fn(() => () => undefined),
};

async function sendChatMessage(prompt: string, options?: { mode: 'preview' }): Promise<void> {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt, options);
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

function requireConfirmation(): PendingAppActionConfirmation {
    const confirmation = getPendingActionConfirmation(getConfirmationId());
    if (!confirmation) {
        throw new TypeError('Expected a pending action confirmation');
    }
    return confirmation;
}

function getCreatedTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

function requireCreatedClip(): Clip {
    const clip = getCreatedTracks().flatMap((track) => track.clips)[0];
    if (!clip) {
        throw new TypeError('Expected the batch to have created one clip');
    }
    return clip;
}

/** The store keeps an id on every note; the transform contract only fixes the musical fields. */
function getMusicalNotes(clipId: string) {
    return (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => ({
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    }));
}

function expectCommittedBluesSong(): void {
    const tracks = getCreatedTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: expect.stringMatching(GENERATED_TRACK_ID), kind: 'midi' });
    const clip = requireCreatedClip();
    expect(clip).toMatchObject({
        id: expect.stringMatching(GENERATED_CLIP_ID),
        startBeat: BLUES_CLIP_START_BEAT,
        endBeat: BLUES_CLIP_END_BEAT,
    });
    expect(getMusicalNotes(clip.id)).toEqual(deriveBluesNotes());
}

function expectEmptyProject(): void {
    expect(trackStore.value?.tracks).toEqual([]);
    expect(Object.keys(midiStore.value?.notesByClipId ?? {})).toEqual([]);
}

async function commitBluesSong(): Promise<PendingAppActionConfirmation> {
    await sendChatMessage(BLUES_PROMPT);
    const confirmation = requireConfirmation();
    await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
        status: 'executed',
    });
    return confirmation;
}

const OFFLINE_EVENT_BUS_REASON = 'Arrangement event bus is offline';

/**
 * Rejects only 'track.added': addTrack's real afterCommit and afterAmbiguousCommit
 * (src/modules/Arrangement/handlers/track/handleAddTrack.ts) both publish on this event, and no
 * other handler in the blues plan emits on the arrangement bus.
 */
function installOfflineTrackAddedEventBus() {
    const emit = vi.fn((event: string, _payload: unknown) =>
        event === 'track.added' ? Promise.reject(new Error(OFFLINE_EVENT_BUS_REASON)) : Promise.resolve()
    );
    setArrangementEventBus({ emit });
    return emit;
}

function requireCommandBatch(
    confirmation: PendingAppActionConfirmation
): NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']> {
    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!commandBatch) {
        throw new TypeError('Expected the confirmation to retain its command batch');
    }
    return commandBatch;
}

function requireParsedBatchEnvelope(commandBatch: ReturnType<typeof requireCommandBatch>) {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new TypeError(`Expected a valid command batch envelope, refused: ${parsed.reason}`);
    }
    return parsed.envelope;
}

function requireAddTrackCommandId(envelope: ReturnType<typeof requireParsedBatchEnvelope>): string {
    const addTrackCommand = envelope.commands.find((command) => command.operation === 'addTrack');
    if (!addTrackCommand) {
        throw new TypeError('Expected the blues plan to include an addTrack command');
    }
    return addTrackCommand.commandId;
}

function expectedOfflineTrackAddedEffect(addTrackCommandId: string) {
    return {
        commandId: addTrackCommandId,
        kind: 'external-effect' as const,
        operation: 'addTrack',
        reason: OFFLINE_EVENT_BUS_REASON,
        remediation: 'reconcile' as const,
        state: 'pending' as const,
    };
}

function requireCommittedEffectFailure(
    result: Awaited<ReturnType<typeof confirmPendingChatActions>>
): CommittedEffectFailureResult {
    if (result.status === 'failed' && 'effects' in result) {
        return result;
    }
    throw new TypeError(`Expected a committed effect failure result, received status: ${result.status}`);
}

function countTrackAddedEmits(emit: ReturnType<typeof installOfflineTrackAddedEventBus>): number {
    return emit.mock.calls.filter(([event]) => event === 'track.added').length;
}

async function commitBluesSongWithOfflineEventBus(): Promise<{
    confirmation: PendingAppActionConfirmation;
    runId: string;
    batchId: string;
    addTrackCommandId: string;
    emit: ReturnType<typeof installOfflineTrackAddedEventBus>;
    commandBatch: ReturnType<typeof requireCommandBatch>;
}> {
    const emit = installOfflineTrackAddedEventBus();
    await sendChatMessage(BLUES_PROMPT);
    const confirmation = requireConfirmation();
    const commandBatch = requireCommandBatch(confirmation);
    const envelope = requireParsedBatchEnvelope(commandBatch);
    const addTrackCommandId = requireAddTrackCommandId(envelope);
    return { confirmation, runId: envelope.runId, batchId: envelope.batchId, addTrackCommandId, emit, commandBatch };
}

describe('high-level intent execution', () => {
    beforeEach(async () => {
        // Dependency resolutions are cached per invoker for the process lifetime (src/infra/di/
        // inject.ts); without a clear, an earlier test's arrangement event bus registration stays
        // resolved and this suite's per-test setArrangementEventBus calls below are silently ignored.
        Container.clear();
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        scriptHighLevelIntentProvider(runtimeMocks.generateWebLlmCompletion);
        await cloudSession.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('high-level intent execution test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        // Without the note handlers the batch still commits and undo is inert: the atomic group has
        // nothing registered to reverse the notes it wrote.
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearMidiTransformRegistry();
        registerMidiTransforms(MIDI_TRANSFORM_IMPLEMENTATIONS);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus(notificationEventBus);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        // A created track carries an application-assigned colour; without the provider the command
        // never materializes one and the serialized envelope is refused as non-deterministic.
        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(emptyMidiState());
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetAiWorkflowCommandPreflightFixture();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearMidiTransformRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(emptyMidiState());
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('previews a blues song without touching the project or the undo history', async () => {
        await sendChatMessage(BLUES_PROMPT, { mode: 'preview' });

        // Preview proposes nothing, so the run is read from the run state rather than from a
        // confirmation. It is the only run: the suite clears the state before each case.
        const runs = readAgentRunState().runs;
        expect(runs).toHaveLength(1);
        expect(runs[0]?.phase).toBe('completed');
        expect(runs[0]?.batches.map((batch) => batch.status)).toEqual(['previewed']);
        expect(chatStore.value?.messages.at(-1)?.content).toContain('Previewed without changing the project:');
        expect(getPendingActionConfirmation(getConfirmationId())).toBeNull();
        expectEmptyProject();
        expect(undoStore.value?.past ?? []).toEqual([]);
    });

    it('binds the approval to the revision it was planned against and commits one atomic group', async () => {
        // The revision the plan is bound to is the one after pending writes settle, which is what
        // the send does first.
        flushAutomergeStorageWrites();
        const revisionBefore = captureProjectRevision();
        await sendChatMessage(BLUES_PROMPT);

        const confirmation = requireConfirmation();
        expect(confirmation.projectRevision).toBe(revisionBefore);
        expect(confirmation.approvalSnapshot.commandBatch?.authority.baseRevision).toBe(revisionBefore);
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('waiting-for-approval');

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('completed');
        expect(aiActionHistoryStore.value?.groups).toHaveLength(1);
        expect(captureProjectRevision()).not.toBe(revisionBefore);
        expectCommittedBluesSong();
        const past = undoStore.value?.past ?? [];
        expect(past).toHaveLength(2 + deriveBluesTransformCommands().length);
    });

    it('asks for reapproval instead of discarding the proposal after an unrelated edit, then commits the unchanged plan on the second confirm', async () => {
        await sendChatMessage(BLUES_PROMPT);
        const confirmation = requireConfirmation();

        // An edit with no relationship to the blues plan's targets: a brand new track, not one of
        // the ids the plan creates or touches.
        landProjectEdit(() => {
            executeAppAction({ type: 'addTrack', payload: { name: 'Unrelated Track', kind: 'audio' } });
        });

        const firstConfirm = await confirmPendingChatActions({ confirmationId: confirmation.id });
        expect(firstConfirm).toMatchObject({
            status: 'reapproval_required',
            divergence: { kind: 'non-overlapping' },
        });

        const reapprovalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(reapprovalMessage?.pendingActionConfirmationStatus).toBe('proposed');
        expect(reapprovalMessage?.content).toContain(
            'The project changed after the prior approval. Divergence was classified as non-overlapping; the unchanged command plan was revalidated and rebound to the current project revision. Review and confirm again:'
        );
        expect(getPendingActionConfirmation(confirmation.id)?.status).toBe('proposed');

        const secondConfirm = await confirmPendingChatActions({ confirmationId: confirmation.id });
        expect(secondConfirm).toEqual({ status: 'executed' });

        // The unrelated edit survives alongside the committed blues song rather than blocking it:
        // expectCommittedBluesSong assumes a lone track, which the unrelated addTrack invalidates.
        const bluesTrack = getCreatedTracks().find((track) => track.id.match(GENERATED_TRACK_ID));
        expect(bluesTrack).toMatchObject({ kind: 'midi' });
        const bluesClip = bluesTrack?.clips[0];
        expect(bluesClip).toMatchObject({
            id: expect.stringMatching(GENERATED_CLIP_ID),
            startBeat: BLUES_CLIP_START_BEAT,
            endBeat: BLUES_CLIP_END_BEAT,
        });
        if (!bluesClip) {
            throw new TypeError('Expected the blues track to have one clip');
        }
        expect(getMusicalNotes(bluesClip.id)).toEqual(deriveBluesNotes());
        expect(getCreatedTracks().find((track) => track.kind === 'audio')).toMatchObject({
            name: 'Unrelated Track',
        });
    });

    it('cancels a pending blues proposal and refuses a later confirm of the same confirmation', async () => {
        await sendChatMessage(BLUES_PROMPT);
        const confirmation = requireConfirmation();

        await expect(cancelPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'cancelled',
        });

        const message = chatStore.value?.messages.find(
            (candidate) => candidate.pendingActionConfirmationId === confirmation.id
        );
        expect(message?.content).toContain('Cancelled pending actions:');
        expect(getPendingActionConfirmation(confirmation.id)?.status).toBe('cancelled');
        expectEmptyProject();
        expect(undoStore.value?.past ?? []).toEqual([]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'cancelled',
        });
        expectEmptyProject();
    });

    it('replays a committed batch without writing the song a second time', async () => {
        const confirmation = await commitBluesSong();
        const tracksAfterCommit = structuredClone(getCreatedTracks());
        const clipId = requireCreatedClip().id;
        const notesAfterCommit = getMusicalNotes(clipId);
        const pastAfterCommit = structuredClone(undoStore.value?.past ?? []);
        const revisionAfterCommit = captureProjectRevision();
        const executed = getPendingActionConfirmation(confirmation.id);
        if (!executed?.approvalSnapshot.commandBatch) {
            throw new TypeError('Expected the executed confirmation to retain its command batch');
        }

        proposePendingActionConfirmation({
            id: 'confirmation-replay',
            runId: executed.runId,
            prompt: executed.prompt,
            assistantMessageId: executed.assistantMessageId,
            actions: structuredClone(executed.approvalSnapshot.actions),
            actionLabels: structuredClone(executed.approvalSnapshot.actionLabels),
            commandEnvelopes: executed.approvalSnapshot.commandEnvelopes
                ? [...executed.approvalSnapshot.commandEnvelopes]
                : undefined,
            commandBatch: structuredClone(executed.approvalSnapshot.commandBatch),
            agentApproval: executed.approvalSnapshot.agentApproval
                ? structuredClone(executed.approvalSnapshot.agentApproval)
                : undefined,
            executionMode: 'atomic',
            groupId: executed.groupId,
            groupLabel: executed.groupLabel,
            projectRevision: captureProjectRevision(),
        });

        // The durable receipt settles the replay: it reports the commit that already happened
        // instead of writing a second one, so the document revision never moves.
        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-replay' })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).toBe(revisionAfterCommit);
        expect(getCreatedTracks()).toEqual(tracksAfterCommit);
        expect(getMusicalNotes(clipId)).toEqual(notesAfterCommit);
        expect(undoStore.value?.past ?? []).toEqual(pastAfterCommit);
        expect(aiActionHistoryStore.value?.groups ?? []).toHaveLength(1);
    });

    it('reverts the committed group back to the empty project it started from', async () => {
        await commitBluesSong();
        const group = aiActionHistoryStore.value?.groups[0];
        if (!group) {
            throw new TypeError('Expected one AI action history group');
        }

        await revertAiActionGroup(group);

        expectEmptyProject();
    });

    it('undoes and redoes the whole song as one atomic group', async () => {
        const confirmation = await commitBluesSong();
        const clipId = requireCreatedClip().id;
        const receiptBefore = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        )?.content;
        const undoDepth = (undoStore.value?.past ?? []).length;

        await undo();

        expectEmptyProject();
        expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
        expect(undoStore.value?.past ?? []).toEqual([]);
        expect(undoStore.value?.future ?? []).toHaveLength(undoDepth);
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('completed');
        expect(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId === confirmation.id)
                ?.content
        ).toBe(receiptBefore);

        await redo();

        expectCommittedBluesSong();
    });

    describe('partially committed recovery through the real event bus seam', () => {
        it('commits the song durably and reports the track-added effect as pending when the event bus is offline', async () => {
            const { confirmation, runId, batchId, addTrackCommandId, emit, commandBatch } =
                await commitBluesSongWithOfflineEventBus();

            const result = requireCommittedEffectFailure(
                await confirmPendingChatActions({ confirmationId: confirmation.id })
            );
            expect(result).toMatchObject({
                status: 'failed',
                durableCommit: true,
                continuation: {
                    authority: 'authoritative-collaboration-host',
                    idempotency: 'project-checkpoint',
                    kind: 'manual-repair',
                },
            });
            expect(result.effects).toEqual([expectedOfflineTrackAddedEffect(addTrackCommandId)]);

            // The atomic project commit is durable even though the post-commit effect failed.
            // Undo entries are recorded per committed command before post-commit effects run
            // (executeAppActionBatch.ts's recordCommittedBatch precedes the afterCommit/
            // afterAmbiguousCommit loop), so the pending track.added effect does not shrink the
            // undo group: it still holds one entry per command in the plan.
            expectCommittedBluesSong();
            expect(undoStore.value?.past).toHaveLength(2 + deriveBluesTransformCommands().length);
            expect(aiActionHistoryStore.value?.groups).toHaveLength(1);
            expect(getPendingActionConfirmation(confirmation.id)?.status).toBe('failed');

            // Both the real afterCommit and the real afterAmbiguousCommit ran on 'track.added',
            // and no other handler in the blues plan emits on this bus.
            expect(countTrackAddedEmits(emit)).toBe(2);

            const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
                authority: commandBatch.authority,
                serialized: commandBatch.serialized,
            });
            if (!priorReceipt) {
                throw new TypeError('Expected an idempotent replay receipt for the committed batch');
            }
            expect(priorReceipt).toMatchObject({
                outcome: 'partially-committed',
                atomicity: 'durable-atomic-with-non-atomic-effects',
                runId,
                batchId,
            });
            expect(priorReceipt.pendingEffects).toEqual([expectedOfflineTrackAddedEffect(addTrackCommandId)]);
        });

        it('recovers a partially committed plan only through the durable receipt, the run lifecycle and the same Command authority', async () => {
            const { confirmation, runId, batchId, emit, commandBatch, addTrackCommandId } =
                await commitBluesSongWithOfflineEventBus();
            await confirmPendingChatActions({ confirmationId: confirmation.id });

            const revisionAfterCommit = captureProjectRevision();
            const tracksAfterCommit = structuredClone(getCreatedTracks());
            const pastAfterCommit = structuredClone(undoStore.value?.past ?? []);
            const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
                authority: commandBatch.authority,
                serialized: commandBatch.serialized,
            });
            if (!priorReceipt) {
                throw new TypeError('Expected an idempotent replay receipt for the committed batch');
            }

            // Leg A: run-level recovery reuses the durable receipt and refuses without exact
            // post-commit revision evidence. The manual-repair state it would require is already
            // durable — the confirm's promote and the receipt saga projection wrote it before
            // recovery ever runs — so this call must leave the durable continuation and saga
            // untouched rather than re-derive them.
            const runBeforeRecovery = agentRunLifecycle.get(runId);
            const recoveryBeforeRecovery = agentRunLifecycle.getPendingEffectRecovery({ runId, batchId });
            expect(recoveryBeforeRecovery).toMatchObject({ checkpoint: 'durable', recovery: 'manual-repair' });
            const recoveryLedgerBefore = structuredClone(recoveryBeforeRecovery);
            expect(runBeforeRecovery).toMatchObject({ phase: 'partially-completed' });
            const addTrackStepId = `effect:${batchId}:${addTrackCommandId}`;
            const sagaStepBeforeRecovery = runBeforeRecovery?.saga.steps.find((step) => step.stepId === addTrackStepId);
            expect(sagaStepBeforeRecovery).toMatchObject({ state: 'manual-repair' });
            const continuationBefore = structuredClone(runBeforeRecovery?.pendingEffectContinuations ?? []);
            expect(continuationBefore).toEqual([
                expect.objectContaining({
                    batchId,
                    receiptIdentity: `${priorReceipt.schemaVersion}:${runId}:${batchId}:partially-committed`,
                    recovery: 'manual-repair',
                    effects: [
                        {
                            commandId: addTrackCommandId,
                            kind: 'external-effect',
                            operation: 'addTrack',
                            reason: OFFLINE_EVENT_BUS_REASON,
                            remediation: 'reconcile',
                            state: 'pending',
                        },
                    ],
                }),
            ]);
            expect(continuationBefore[0]).not.toHaveProperty('sourceRevision');
            const sagaBefore = (runBeforeRecovery?.saga.steps ?? []).map(({ updatedAt: _updatedAt, ...step }) => step);

            await expect(recoverAgentRunPendingEffects({ runId, batchId })).resolves.toEqual({
                status: 'failed',
                reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            });

            // No-alternate-path (Leg A on its own): recovery neither replayed the project mutation,
            // nor re-ran the offline effect, nor rewrote the durable continuation or saga step it
            // already found settled.
            const runAfterRecovery = agentRunLifecycle.get(runId);
            expect(runAfterRecovery).toMatchObject({ phase: 'partially-completed' });
            expect(runAfterRecovery?.pendingEffectContinuations).toEqual(continuationBefore);
            expect(agentRunLifecycle.getPendingEffectRecovery({ runId, batchId })).toEqual(recoveryLedgerBefore);
            const sagaAfterRecovery = (runAfterRecovery?.saga.steps ?? []).map(
                ({ updatedAt: _updatedAt, ...step }) => step
            );
            expect(sagaAfterRecovery).toEqual(sagaBefore);
            expect(captureProjectRevision()).toBe(revisionAfterCommit);
            expect(undoStore.value?.past ?? []).toEqual(pastAfterCommit);
            expect(countTrackAddedEmits(emit)).toBe(2);

            // Leg B: re-confirmation through the same Command authority. It refuses to replay the
            // project mutation and instead surfaces the same durable pending effect.
            proposePendingActionConfirmation({
                id: 'confirmation-recovery',
                runId: confirmation.runId,
                prompt: confirmation.prompt,
                assistantMessageId: confirmation.assistantMessageId,
                actions: structuredClone(confirmation.approvalSnapshot.actions),
                actionLabels: structuredClone(confirmation.approvalSnapshot.actionLabels),
                commandEnvelopes: confirmation.approvalSnapshot.commandEnvelopes
                    ? [...confirmation.approvalSnapshot.commandEnvelopes]
                    : undefined,
                commandBatch: structuredClone(confirmation.approvalSnapshot.commandBatch),
                agentApproval: confirmation.approvalSnapshot.agentApproval
                    ? structuredClone(confirmation.approvalSnapshot.agentApproval)
                    : undefined,
                executionMode: 'atomic',
                groupId: confirmation.groupId,
                groupLabel: confirmation.groupLabel,
                projectRevision: captureProjectRevision(),
            });

            await expect(confirmPendingChatActions({ confirmationId: 'confirmation-recovery' })).resolves.toEqual({
                status: 'failed',
                durableCommit: true,
                reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
                effects: priorReceipt.pendingEffects,
                continuation: {
                    authority: 'authoritative-collaboration-host',
                    idempotency: 'project-checkpoint',
                    kind: 'manual-repair',
                },
            });

            const recoveryMessage = chatStore.value?.messages.find(
                (message) => message.id === confirmation.assistantMessageId
            );
            expect(recoveryMessage?.content).toContain(
                'The project change remains durably committed, but pending-effect reconciliation is still incomplete:'
            );

            // No-alternate-path: neither leg replayed the committed mutation or re-ran the effect.
            expect(captureProjectRevision()).toBe(revisionAfterCommit);
            expect(getCreatedTracks()).toEqual(tracksAfterCommit);
            expect(undoStore.value?.past ?? []).toEqual(pastAfterCommit);
            expect(aiActionHistoryStore.value?.groups).toHaveLength(1);
            expect(countTrackAddedEmits(emit)).toBe(2);
        });
    });
});
