import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { agentRunLifecycle } from '../agentRunLifecycle';
import { revertAiActionGroup } from '../aiHistoryActions';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
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

describe('high-level intent execution', () => {
    beforeEach(async () => {
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
        expect(getCreatedTracks()).toHaveLength(tracksAfterCommit.length);
        expect(getMusicalNotes(clipId)).toEqual(notesAfterCommit);
        expect(undoStore.value?.past ?? []).toEqual(pastAfterCommit);
        expect(undoStore.value?.past ?? []).toHaveLength(pastAfterCommit.length);
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
});
