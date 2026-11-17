import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { MIDI_TRANSFORM_IMPLEMENTATIONS } from '#/modules/AiGeneration/useCases';
import { takeLaneStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import {
    addClip,
    clearClipSelection,
    createTrack,
    getArrangementHandlers,
    selectClip,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
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
    parseVersionedCommandBatchEnvelope,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    clearPianoRollSelection,
    getMidiNoteTransformHandlers,
    projectPianoRollTakeNotes,
    setPianoRollSelection,
} from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
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
    assertDiscoveredCommandSchemas,
    catalogDiscoveryCall,
    getApplicationToolReceipts,
    proposeCall,
    BLUES_PROMPT,
    bluesProposalItems,
    deriveBluesNotes,
    deriveBluesTransformCommands,
    discoverSearchedCalls,
    emptyMidiState,
    GENERATED_CLIP_ID,
    GENERATED_TRACK_ID,
    proposeDiscoveredCalls,
    scriptProviderTurns,
    type ScriptedTurn,
    searchCalls,
} from './highLevelIntentWorkflowFixture';
import { literalMetricIntakeTurn, nonAcousticMetricIntakeTurn } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

const bluesIntake = nonAcousticMetricIntakeTurn({
    modeId: 'create',
    dimensions: ['arrangement', 'midi-content'],
    creationSlotObjectTypes: ['track'],
    nestedCreationSlotObjectTypes: ['clip'],
});

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return { backend, generateWebLlmCompletion: vi.fn(), updateDeviceParam: vi.fn() };
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

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: runtimeMocks.updateDeviceParam,
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
        chatStore.value?.messages.findLast((message) => message.pendingActionConfirmationId)
            ?.pendingActionConfirmationId ?? ''
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

const PHRASE_TASK =
    'Reshape the selected MIDI notes in the Lead Motif clip into a blues phrase, with the opening intact and the same instrument sound.';
const SPARSE_PHRASE_TASK = 'Keep that tone, but make the lick less busy';
const PHRASE_CLIP_ID = 'existing-midi-motif';
const PHRASE_TRACK_ID = 'existing-motif-track';
const PHRASE_SIBLING_ID = 'existing-midi-sibling';
const OPENING = {
    id: 'protected-opening',
    pitch: 60,
    startBeat: 0,
    duration: 1,
    velocity: 81,
    expression: { slide: [{ offsetBeats: 0.25, value: 99 }] },
};
const THIRD = {
    id: 'major-third',
    pitch: 64,
    startBeat: 2,
    duration: 1,
    velocity: 88,
    channel: 3,
    articulation: 'accent',
    expression: { pressure: [{ offsetBeats: 0.25, value: 55 }] },
};
const FILLER = { id: 'filler', pitch: 67, startBeat: 3.5, duration: 0.25, velocity: 77 };
const ENDING = { id: 'untouched-ending', pitch: 60, startBeat: 6, duration: 1, velocity: 89 };
const PHRASE_NOTES = [OPENING, THIRD, FILLER, ENDING];
const PHRASE_OPERATIONS = [
    { type: 'patch', noteId: THIRD.id, patch: { pitch: 63, startBeat: 2.25, duration: 0.75, velocity: 96 } },
    { type: 'delete', noteId: FILLER.id },
    { type: 'insert', note: { pitch: 58, startBeat: 3.25, duration: 0.25, velocity: 84 } },
];

function durablePhraseNotes() {
    return getCrdtDoc<{ midi?: NonNullable<typeof midiStore.value> }>('root')?.midi?.notesByClipId[PHRASE_CLIP_ID];
}

function durablePhraseDevices() {
    return getCrdtDoc<{ tracks?: { tracks: Track[] } }>('root')?.tracks?.tracks.find(
        (track) => track.id === PHRASE_TRACK_ID
    )?.devices;
}

function selectPhraseNotes(noteIds: string[]) {
    const track = trackStore.value?.tracks.find(({ id }) => id === PHRASE_TRACK_ID);
    const clip = track?.clips.find(({ id }) => id === PHRASE_CLIP_ID);
    const notes = midiStore.value?.notesByClipId[PHRASE_CLIP_ID];
    if (!track || !clip || !notes) {
        throw new Error('Expected a live motif to select');
    }
    const projection = projectPianoRollTakeNotes(clip, track.id, takeLaneStore.value, notes);
    setPianoRollSelection(clip.id, noteIds, [], [{ clipId: clip.id, projection }]);
}

function seedMidiPhrase(clipName = 'Lead Motif') {
    projectStore.set(defaultProjectStoreState);
    const track = createTrack({ id: PHRASE_TRACK_ID, kind: 'midi', name: 'Electric piano' });
    const instrument = track.devices[0];
    if (!instrument) {
        throw new Error('Expected the motif to have an instrument');
    }
    instrument.parameterValues.filterCutoff = 1_720;
    instrument.parameterValues.filterResonance = 2.8;
    instrument.parameterValues.sustain = 0.61;
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    const add = (id: string, startBeat: number, name: string) =>
        addClip({
            id,
            trackId: track.id,
            name,
            type: 'midi',
            startBeat,
            endBeat: startBeat + 8,
        });
    const clip = add(PHRASE_CLIP_ID, 16, clipName);
    expect(add(PHRASE_SIBLING_ID, 26, 'Sibling Motif')).not.toBeNull();
    if (!clip) {
        throw new Error('Expected the existing motif clip');
    }
    midiStore.set({
        ...emptyMidiState(),
        notesByClipId: {
            [PHRASE_CLIP_ID]: structuredClone(PHRASE_NOTES),
            [PHRASE_SIBLING_ID]: [{ id: 'sibling-note', pitch: 72, duration: 1, startBeat: 2, velocity: 90 }],
        },
    });
    selectPhraseNotes([THIRD.id, FILLER.id]);
}

function scriptMidiPhraseEdit(
    options: {
        clipId?: string;
        operations?: unknown[];
        read?: boolean | 'partial';
        selectedNoteIds?: string[];
        canInsert?: boolean;
        changeDuringRead?: () => void;
        plain?: boolean;
    } = {}
) {
    const clipId = options.clipId ?? PHRASE_CLIP_ID;
    const read = () => [
        {
            name: 'project.query',
            arguments: {
                type: 'musical-content',
                filters: { stableId: PHRASE_CLIP_ID, startBeat: 16, endBeat: 20 },
                page: { limit: options.read === 'partial' ? 1 : 50 },
            },
        },
    ];
    const command = {
        name: 'editMidiNotes',
        arguments: { clipId, operations: options.operations ?? PHRASE_OPERATIONS },
    };
    const proposal = () =>
        options.plain
            ? [{ name: 'command.batch.propose', arguments: { commands: [command] } }]
            : [
                  proposeCall([{ id: 'edit-phrase', ...command }], {
                      semantic: { classification: 'complex', uncertainty: [] },
                      objective: 'Reshape the phrase while preserving the opening and the instrument.',
                      constraints: [],
                      scope: {
                          targetIds: [clipId, PHRASE_TRACK_ID],
                          targetRanges: [],
                          protectedTargetIds: [],
                          protectedRanges: [],
                      },
                      capabilityIds: [],
                      assetIds: [],
                      alternatives: [],
                      validationStrategy: ['Preserve all notes outside the selection.'],
                      stoppingConditions: ['Stop if the selected notes changed.'],
                  }),
              ];
    const turns: ScriptedTurn[] = [
        nonAcousticMetricIntakeTurn({
            modeId: 'edit',
            targetObjectIds: [PHRASE_CLIP_ID],
            dimensions: ['midi-content'],
            creationSlotObjectTypes: options.canInsert === false ? [] : ['notes'],
        }),
    ];
    if (options.read !== false) {
        turns.push(read);
    }
    turns.push(
        (message) => {
            if (options.read !== false) {
                const receipt = getApplicationToolReceipts(message).find(
                    (entry) =>
                        typeof entry === 'object' &&
                        entry !== null &&
                        'toolName' in entry &&
                        entry.toolName === 'project.query'
                );
                if (options.read === 'partial') {
                    expect(receipt).toMatchObject({ status: 'success', data: { nextCursor: expect.any(String) } });
                    return [catalogDiscoveryCall(['editMidiNotes'])];
                }
                expect(receipt).toMatchObject({
                    status: 'success',
                    data: {
                        queryType: 'musical-content',
                        nextCursor: null,
                        items: expect.arrayContaining(
                            (options.selectedNoteIds ?? [THIRD.id, FILLER.id]).map((noteId) =>
                                expect.objectContaining({ noteId, selected: true })
                            )
                        ),
                    },
                });
            }
            options.changeDuringRead?.();
            return [catalogDiscoveryCall(['editMidiNotes'])];
        },
        (message) => {
            if (options.read !== false) {
                assertDiscoveredCommandSchemas(message, ['editMidiNotes']);
            }
            return proposal();
        }
    );
    if (options.read === false || options.read === 'partial') {
        turns.push(proposal, proposal);
    }
    turns.push(() => []);
    return scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, turns);
}

async function commitScriptedPhraseEdit(prompt = PHRASE_TASK) {
    scriptMidiPhraseEdit();
    await sendChatMessage(prompt);
    const confirmation = requireConfirmation();
    await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
        status: 'executed',
    });
    return confirmation;
}

function readAcceptedReceipt(confirmation: PendingAppActionConfirmation) {
    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!commandBatch) {
        throw new Error('Expected an accepted versioned Command batch');
    }
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error(parsed.reason);
    }
    const receipt = agentRunLifecycle
        .get(confirmation.runId)
        ?.receipts.find(({ workId }) => workId === parsed.envelope.batchId);
    if (!receipt) {
        throw new Error('Expected a receipt for the exact accepted batch');
    }
    return receipt;
}

function readCapturedThread(requests: string[]) {
    const section = /^thread_context:\n(?<payload>.+)$/mu.exec(requests[0] ?? '')?.groups?.payload;
    if (!section) {
        throw new Error('Expected the prior accepted result in the next actual provider request');
    }
    const thread: unknown = JSON.parse(section);
    return { section, thread };
}

const FOLLOWUP_CUTOFF = 1_840;
const FOLLOWUP_RESONANCE = 3.2;
const REPLACEMENT_CUTOFF = 2_060;

async function commitScriptedToneChange(track: Track) {
    const device = track.devices[0];
    if (!device) {
        throw new Error('Expected a Synth on the tone target');
    }
    const deviceId = device.id;
    const name = 'setDeviceParameter';
    const changes = [
        { deviceId, paramId: 'filterCutoff', value: FOLLOWUP_CUTOFF },
        { deviceId, paramId: 'filterResonance', value: FOLLOWUP_RESONANCE },
    ];
    scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
        literalMetricIntakeTurn,
        () => [catalogDiscoveryCall([name])],
        (message) => {
            assertDiscoveredCommandSchemas(message, [name]);
            return [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        commands: changes.map((args) => ({ name, arguments: args })),
                        plan: {
                            semantic: { classification: 'simple', uncertainty: [] },
                            objective: 'Set the requested filter cutoff and resonance.',
                            constraints: [],
                            scope: {
                                targetIds: [track.id, deviceId, ...changes.map(({ paramId }) => paramId)],
                                targetRanges: [],
                                protectedTargetIds: [`${deviceId}:sustain`],
                                protectedRanges: [],
                            },
                            capabilityIds: [name],
                            assetIds: [],
                            alternatives: [],
                            validationStrategy: ['Check the device owner and preserve its other settings.'],
                            stoppingConditions: ['Stop if the device changed.'],
                        },
                    },
                },
            ];
        },
        () => [],
    ]);
    await sendChatMessage(
        `Set the ${track.name} ${device.name} Filter Cutoff to ${String(FOLLOWUP_CUTOFF)} Hz and Filter Resonance to ${String(FOLLOWUP_RESONANCE)}, leaving Sustain unchanged.`
    );
    const reply = chatStore.value?.messages.at(-1);
    expect(getConfirmationId(), reply?.error ?? reply?.content).not.toBe('');
    const confirmation = requireConfirmation();
    expect(confirmation.actions).toEqual(
        changes.map((payload) => ({
            type: 'setDeviceParameter',
            payload: expect.objectContaining({ ...payload, expectedTrackId: track.id }),
        }))
    );
    await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
        status: 'executed',
    });
    return { confirmation, deviceId, receipt: readAcceptedReceipt(confirmation) };
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
        scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
            bluesIntake,
            () => searchCalls(),
            discoverSearchedCalls(),
            proposeDiscoveredCalls(bluesProposalItems()),
        ]);
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
        clearClipSelection();
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

    it('reads the selected motif, previews exact note edits, and commits and undoes one guarded batch', async () => {
        seedMidiPhrase();
        const tracksBefore = structuredClone(trackStore.value);
        scriptMidiPhraseEdit();
        await sendChatMessage(PHRASE_TASK);
        expect(getConfirmationId(), JSON.stringify(chatStore.value?.messages)).not.toBe('');
        const confirmation = requireConfirmation();
        expect(confirmation.actionLabels[0]).toContain('change pitch 64 at beat 2 to pitch 63');
        expect(confirmation.actionLabels[0]).toContain('remove pitch 67 at beat 3.5');
        expect(confirmation.actionLabels[0]).toContain('insert pitch 58 at beat 3.25');
        expect(confirmation.actions).toMatchObject([
            {
                type: 'editMidiNotes',
                payload: {
                    clipId: PHRASE_CLIP_ID,
                    guard: {
                        expectedNotes: PHRASE_NOTES,
                        scope: { allowedNoteIds: [THIRD.id, FILLER.id], protectedNoteIds: [OPENING.id, ENDING.id] },
                    },
                },
            },
        ]);
        expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
        expect(undoStore.value?.past).toHaveLength(0);
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(durablePhraseNotes()).toEqual([
            OPENING,
            { ...THIRD, pitch: 63, startBeat: 2.25, duration: 0.75, velocity: 96 },
            ENDING,
            {
                id: expect.stringMatching(/^note-command-/u),
                pitch: 58,
                startBeat: 3.25,
                duration: 0.25,
                velocity: 84,
                probability: 100,
            },
        ]);
        expect(trackStore.value).toEqual(tracksBefore);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId === confirmation.id)
                ?.content
        ).toContain('Outcome: committed');
        await undo();
        expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
        expect(trackStore.value).toEqual(tracksBefore);
    });

    it.each([
        {
            name: 'wrong clip owner',
            input: { clipId: PHRASE_SIBLING_ID },
            reason: 'positive edit authority and complete current musical evidence',
        },
        {
            name: 'protected opening',
            input: { operations: [{ type: 'delete', noteId: OPENING.id }] },
            reason: 'outside the admitted MIDI selection',
        },
        { name: 'missing read', input: { read: false }, reason: 'Required musical evidence was not read' },
        { name: 'partial read', input: { read: 'partial' as const }, reason: 'Required musical evidence was not read' },
        {
            name: 'stale read',
            input: { changeDuringRead: () => clearPianoRollSelection() },
            reason: 'Musical evidence is stale',
        },
        { name: 'direct command escape', input: { plain: true }, reason: 'requires one structured command list item' },
        {
            name: 'provider-supplied insert ID',
            input: {
                operations: [{ type: 'insert', note: { id: 'forged-note', pitch: 48, duration: 0.5, startBeat: 2 } }],
            },
            reason: 'positive edit authority and complete current musical evidence',
        },
    ])('does not propose a MIDI edit with $name', async ({ input, reason }) => {
        seedMidiPhrase();
        const transcript = scriptMidiPhraseEdit(input);
        await sendChatMessage(PHRASE_TASK);
        expect(getConfirmationId()).toBe('');
        expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
        expect(undoStore.value?.past).toHaveLength(0);
        expect([...transcript, JSON.stringify(chatStore.value?.messages)].join('\n')).toContain(reason);
    });

    it('invalidates a selective edit when the note selection changes after proposal', async () => {
        seedMidiPhrase();
        scriptMidiPhraseEdit();
        await sendChatMessage(PHRASE_TASK);
        const confirmation = requireConfirmation();
        clearPianoRollSelection();
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toMatchObject({
            status: 'invalidated',
            detail: expect.stringContaining('MIDI note selection changed'),
        });
        expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('requires a new musical read after project revision drift, even on another track', async () => {
        seedMidiPhrase();
        scriptMidiPhraseEdit();
        await sendChatMessage(PHRASE_TASK);
        const confirmation = requireConfirmation();
        await executeAppAction({ type: 'addTrack', payload: { name: 'New unrelated track', kind: 'audio' } });
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toMatchObject({
            status: 'invalidated',
            detail: expect.stringContaining('project revision changed'),
        });
        expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
    });

    it('keeps internal note guards out of the next provider request', async () => {
        seedMidiPhrase();
        scriptMidiPhraseEdit();
        await sendChatMessage(PHRASE_TASK);
        requireConfirmation();
        const messages = scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [() => []]);
        await sendChatMessage('Which edit is waiting for confirmation?');
        expect(messages[0]).toContain('thread_context');
        expect(messages[0]).toContain('editMidiNotes');
        expect(messages[0]).not.toContain('expectedNotes');
        expect(messages[0]).not.toContain('selectionToken');
        expect(messages[0]).not.toContain(ENDING.id);
    });

    it('follows an accepted motif edit with fresh authority to simplify only its notes and preserve its tone', async () => {
        seedMidiPhrase();
        const first = await commitScriptedPhraseEdit();
        const receipt = readAcceptedReceipt(first);
        const acceptedNotes = structuredClone(durablePhraseNotes());
        const acceptedDevices = structuredClone(durablePhraseDevices());
        const acceptedRevision = captureProjectRevision();
        const pickup = acceptedNotes?.find(({ pitch, startBeat }) => pitch === 58 && startBeat === 3.25);
        if (!acceptedNotes || !acceptedDevices || !pickup) {
            throw new Error('Expected an accepted, receipted motif and its generated pickup');
        }
        expect(acceptedDevices[0]?.parameterValues).toMatchObject({ filterCutoff: 1_720, filterResonance: 2.8 });
        const firstUndo = structuredClone(undoStore.value?.past ?? []);
        expect(firstUndo).toHaveLength(1);

        const selectedNoteIds = [THIRD.id, pickup.id];
        selectClip(PHRASE_CLIP_ID);
        selectPhraseNotes(selectedNoteIds);
        const operations = [
            { type: 'patch', noteId: THIRD.id, patch: { duration: 0.5 } },
            { type: 'delete', noteId: pickup.id },
        ];
        const requests = scriptMidiPhraseEdit({ selectedNoteIds, canInsert: false, operations });
        await sendChatMessage(SPARSE_PHRASE_TASK);
        const { section, thread } = readCapturedThread(requests);
        expect(thread).toMatchObject({
            requests: [{ value: PHRASE_TASK, trust: 'untrusted_user_string', truncated: false }],
            pendingProposal: null,
            lastCommit: {
                runId: first.runId,
                receiptIds: [receipt.receiptIdentity],
                standing: 'standing',
                commands: [{ name: 'editMidiNotes', arguments: { clipId: PHRASE_CLIP_ID } }],
            },
        });
        for (const privateField of ['expectedNotes', 'guard', 'selectionToken', 'authorityId']) {
            expect(section).not.toContain(`"${privateField}"`);
        }
        expect(section).not.toContain(pickup.id);
        expect(section).not.toContain(OPENING.id);
        expect(section).not.toContain(ENDING.id);

        const second = requireConfirmation();
        expect(second.id, chatStore.value?.messages.at(-1)?.content).not.toBe(first.id);
        expect(second.runId).not.toBe(first.runId);
        expect(second.projectRevision).toBe(acceptedRevision);
        expect(second.projectRevision).not.toBe(first.projectRevision);
        expect(second.actions).toMatchObject([
            {
                type: 'editMidiNotes',
                payload: {
                    clipId: PHRASE_CLIP_ID,
                    operations,
                    guard: {
                        trackId: PHRASE_TRACK_ID,
                        expectedNotes: acceptedNotes,
                        scope: {
                            allowedNoteIds: selectedNoteIds,
                            protectedNoteIds: [OPENING.id, ENDING.id],
                            insertionBudget: 0,
                        },
                    },
                },
            },
        ]);
        expect(durablePhraseNotes()).toEqual(acceptedNotes);
        await expect(confirmPendingChatActions({ confirmationId: second.id })).resolves.toEqual({ status: 'executed' });
        expect(durablePhraseNotes()).toEqual(
            acceptedNotes
                .filter(({ id }) => id !== pickup.id)
                .map((note) => (note.id === THIRD.id ? { ...note, duration: 0.5 } : note))
        );
        expect(durablePhraseDevices()).toEqual(acceptedDevices);
        expect(undoStore.value?.past).toEqual([...firstUndo, expect.any(Object)]);
        await undo();
        expect(durablePhraseNotes()).toEqual(acceptedNotes);
        expect(durablePhraseDevices()).toEqual(acceptedDevices);
        expect(undoStore.value?.past).toEqual(firstUndo);
    });

    it.each([
        { name: 'same track', prior: 'same' },
        { name: 'different track', prior: 'different' },
        { name: 'undone result', prior: 'undone' },
        { name: 'superseded parameter', prior: 'changed' },
    ] as const)(
        'checks the $name against a recorded processing receipt before a MIDI continuation',
        async ({ prior }) => {
            seedMidiPhrase();
            const phaseTrack = trackStore.value?.tracks.find(({ id }) => id === PHRASE_TRACK_ID);
            if (!phaseTrack) {
                throw new Error('Expected the seeded motif track');
            }
            let toneTrack = phaseTrack;
            if (prior === 'different') {
                toneTrack = createTrack({ kind: 'midi', name: 'Other Keys' });
                const device = toneTrack.devices[0];
                if (!device) {
                    throw new Error('Expected a device on the unrelated track');
                }
                device.parameterValues = { filterCutoff: 960, filterResonance: 4, sustain: 0.63 };
                trackStore.set({ tracks: [phaseTrack, toneTrack], selectedTrackId: phaseTrack.id, ghostClips: [] });
            }
            const { confirmation: first, deviceId, receipt } = await commitScriptedToneChange(toneTrack);
            if (prior === 'undone') {
                await undo();
            }
            if (prior === 'changed') {
                await executeAppAction({
                    type: 'setDeviceParameter',
                    payload: { deviceId, paramId: 'filterCutoff', value: REPLACEMENT_CUTOFF },
                });
            }
            const devicesBefore = structuredClone(durablePhraseDevices());
            const runtimeWritesBefore = runtimeMocks.updateDeviceParam.mock.calls.length;
            expect(runtimeWritesBefore).toBeGreaterThan(0);
            const acceptedSettings = { filterCutoff: FOLLOWUP_CUTOFF, filterResonance: FOLLOWUP_RESONANCE };
            const originalSettings = { filterCutoff: 1_720, filterResonance: 2.8 };
            const expectedSettings = {
                same: acceptedSettings,
                different: originalSettings,
                undone: originalSettings,
                changed: { ...acceptedSettings, filterCutoff: REPLACEMENT_CUTOFF },
            };
            expect(devicesBefore?.[0]?.parameterValues).toMatchObject(expectedSettings[prior]);
            expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
            selectClip(PHRASE_CLIP_ID);
            selectPhraseNotes([THIRD.id, FILLER.id]);
            const requests = scriptMidiPhraseEdit({
                canInsert: false,
                operations: [
                    { type: 'patch', noteId: THIRD.id, patch: { duration: 0.5 } },
                    { type: 'delete', noteId: FILLER.id },
                ],
            });
            await sendChatMessage(SPARSE_PHRASE_TASK);
            const { section, thread } = readCapturedThread(requests);
            expect(thread).toMatchObject({
                lastCommit: {
                    runId: first.runId,
                    receiptIds: [receipt.receiptIdentity],
                    standing: prior === 'undone' ? 'undone' : 'standing',
                    commands: [
                        {
                            name: 'setDeviceParameter',
                            targetTrackId: toneTrack.id,
                            arguments: {
                                deviceId,
                                paramId: 'filterCutoff',
                                value: FOLLOWUP_CUTOFF,
                            },
                        },
                        {
                            name: 'setDeviceParameter',
                            targetTrackId: toneTrack.id,
                            arguments: {
                                deviceId,
                                paramId: 'filterResonance',
                                value: FOLLOWUP_RESONANCE,
                            },
                        },
                    ],
                },
            });
            for (const guard of ['expectedTrackId', 'expectedDeviceType', 'expectedDeviceIds', 'expectedValue']) {
                expect(section).not.toContain(`"${guard}"`);
            }
            const second = requireConfirmation();
            expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
            if (prior !== 'same') {
                expect(second.id).toBe(first.id);
                expect([...requests, chatStore.value?.messages.at(-1)?.content].join('\n')).toContain(
                    'Transform compilation includes a protected or unresolved target'
                );
                expect(durablePhraseDevices()).toEqual(devicesBefore);
                expect(runtimeMocks.updateDeviceParam).toHaveBeenCalledTimes(runtimeWritesBefore);
                return;
            }
            expect(second.id, chatStore.value?.messages.at(-1)?.content).not.toBe(first.id);
            expect(second.actions.map(({ type }) => type)).toEqual(['editMidiNotes']);
            await expect(confirmPendingChatActions({ confirmationId: second.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(durablePhraseNotes()).toEqual([OPENING, { ...THIRD, duration: 0.5 }, ENDING]);
            expect(durablePhraseDevices()).toEqual(devicesBefore);
            await undo();
            expect(durablePhraseNotes()).toEqual(PHRASE_NOTES);
            expect(durablePhraseDevices()).toEqual(devicesBefore);
            expect(runtimeMocks.updateDeviceParam).toHaveBeenCalledTimes(runtimeWritesBefore);
            expect(undoStore.value?.past).toHaveLength(2);
        }
    );

    it.each([
        {
            name: 'a selected clip named Tone',
            clipName: 'Tone',
            prompt: SPARSE_PHRASE_TASK,
            read: true,
            reason: 'Transform compilation includes a protected or unresolved target',
        },
        {
            name: 'an adjacent unresolved protection',
            clipName: 'Lead Motif',
            prompt: `${SPARSE_PHRASE_TASK}. Keep Ghost unchanged.`,
            read: true,
            reason: 'Transform compilation includes a protected or unresolved target',
        },
        {
            name: 'a broader protection that mentions tone',
            clipName: 'Lead Motif',
            prompt: 'Keep that tone and the arrangement, but make the lick less busy',
            read: true,
            reason: 'Transform compilation includes a protected or unresolved target',
        },
        {
            name: 'no fresh musical read',
            clipName: 'Lead Motif',
            prompt: SPARSE_PHRASE_TASK,
            read: false,
            reason: 'Required musical evidence was not read',
        },
    ])('refuses a contextual tone continuation with $name', async ({ clipName, prompt, read, reason }) => {
        seedMidiPhrase(clipName);
        const first = await commitScriptedPhraseEdit(PHRASE_TASK.replace('Lead Motif', clipName));
        const notes = durablePhraseNotes();
        const pickup = notes?.find(({ pitch, startBeat }) => pitch === 58 && startBeat === 3.25);
        if (!pickup) {
            throw new Error('Expected the accepted result to contain its generated pickup');
        }
        const selectedNoteIds = [THIRD.id, pickup.id];
        selectClip(PHRASE_CLIP_ID);
        selectPhraseNotes(selectedNoteIds);
        const requests = scriptMidiPhraseEdit({
            selectedNoteIds,
            canInsert: false,
            read,
            operations: [{ type: 'delete', noteId: pickup.id }],
        });
        await sendChatMessage(prompt);
        expect(requireConfirmation().id, chatStore.value?.messages.at(-1)?.content).toBe(first.id);
        expect(durablePhraseNotes()).toEqual(notes);
        expect(undoStore.value?.past).toHaveLength(1);
        expect([...requests, chatStore.value?.messages.at(-1)?.content].join('\n')).toContain(reason);
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
        const run = agentRunLifecycle.get(confirmation.runId);
        expect(run?.phase).toBe('waiting-for-approval');
        expect(run?.plan?.applicationToolReceipts).toBeDefined();
        expect(run?.plan?.applicationToolReceipts?.some((receipt) => receipt.toolName === 'analysis.measure')).toBe(
            false
        );
        expect(runtimeMocks.generateWebLlmCompletion).toHaveBeenCalledTimes(4);

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
        // the ids the plan creates or touches. executeAppAction lands the write in the project
        // document itself before it resolves, so awaiting it is the landing; no flush follows.
        await executeAppAction({ type: 'addTrack', payload: { name: 'Unrelated Track', kind: 'audio' } });

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
});
