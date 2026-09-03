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
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { parsePromptToActions } from '../parsePromptToActions';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    BLUES_CLIP_END_BEAT,
    BLUES_CLIP_START_BEAT,
    BLUES_PROMPT,
    bluesProposalItems,
    cycleProviderAttempt,
    declineCall,
    deriveBluesNotes,
    discoverSearchedCalls,
    emptyMidiState,
    getDiscoveryReceipt,
    getSearchedCommandNames,
    GENERATED_CLIP_ID,
    GENERATED_TRACK_ID,
    isRecord,
    proposeDiscoveredCalls,
    PROPOSED_COMMAND_NAMES,
    scriptCloudProviderTurns,
    scriptHighLevelIntentProvider,
    scriptProviderTurns,
    SEARCH_INTENTS,
    searchCalls,
    TEMPO_SEARCH_INTENT,
} from './highLevelIntentWorkflowFixture';

const CLARIFY_PROMPT = 'make it sound better';
const UNSUPPORTED_PROMPT = 'master this for vinyl';
const NO_MATCH_TEXT = 'No command matched the request.';

const EXISTING_TRACK_ID = 'track-existing';
const EXISTING_CLIP_ID = 'clip-existing';

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return { backend, generateWebLlmCompletion: vi.fn(), generateCloudToolCalls: vi.fn() };
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

vi.mock('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: runtimeMocks.generateCloudToolCalls,
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

function createClip(id: string, trackId: string, name: string): Clip {
    return {
        id,
        trackId,
        name,
        startBeat: 0,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function createTrack(id: string, name: string, clipId: string): Track {
    return {
        id,
        name,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [createClip(clipId, id, `${name} Phrase`)],
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

const existingNotes = [
    { id: 'existing-note-a', pitch: 55, startBeat: 0, duration: 1, velocity: 90 },
    { id: 'existing-note-b', pitch: 59, startBeat: 2, duration: 1, velocity: 84 },
];

function seedPartiallyBuiltProject(): void {
    trackStore.set({
        tracks: [createTrack(EXISTING_TRACK_ID, 'Rhodes', EXISTING_CLIP_ID)],
        selectedTrackId: null,
        ghostClips: [],
    });
    midiStore.set({ ...emptyMidiState(), notesByClipId: { [EXISTING_CLIP_ID]: existingNotes } });
}

async function sendChatMessage(prompt: string): Promise<void> {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt);
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

function getAssistantContent(): string {
    return chatStore.value?.messages.at(-1)?.content ?? '';
}

function getTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

function getMusicalNotes(clipId: string) {
    return (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => ({
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    }));
}

function requireCreatedTrack(): Track {
    const track = getTracks().find((candidate) => GENERATED_TRACK_ID.test(candidate.id));
    if (!track) {
        throw new TypeError('Expected the batch to have created a track');
    }
    return track;
}

async function commitScriptedBatch(prompt: string): Promise<void> {
    await sendChatMessage(prompt);
    await expect(confirmPendingChatActions({ confirmationId: getConfirmationId() })).resolves.toEqual({
        status: 'executed',
    });
}

function expectNoBatchWasProposedOrExecuted(): void {
    expect(getPendingActionConfirmation(getConfirmationId())).toBeNull();
    expect(undoStore.value?.past ?? []).toEqual([]);
}

describe('high-level intent conformance', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        scriptHighLevelIntentProvider(runtimeMocks.generateWebLlmCompletion);
        await cloudSession.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('high-level intent conformance test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
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

    it('executes exactly the requested song on an empty project and undoes back to empty', async () => {
        await commitScriptedBatch(BLUES_PROMPT);

        const track = requireCreatedTrack();
        expect(getTracks()).toHaveLength(1);
        expect(track.kind).toBe('midi');
        expect(track.clips).toHaveLength(1);
        const clip = track.clips[0];
        expect(clip).toMatchObject({
            id: expect.stringMatching(GENERATED_CLIP_ID),
            startBeat: BLUES_CLIP_START_BEAT,
            endBeat: BLUES_CLIP_END_BEAT,
        });
        expect(getMusicalNotes(clip?.id ?? '')).toEqual(deriveBluesNotes());
        expect(getAssistantContent()).toContain('Outcome: committed');

        await undo();

        expect(getTracks()).toEqual([]);
        expect(midiStore.value?.notesByClipId[clip?.id ?? '']).toBeUndefined();
    });

    it('adds the requested song to a partially built project without disturbing what was there', async () => {
        seedPartiallyBuiltProject();
        const existingTrackBefore = structuredClone(getTracks()[0]);
        const existingNotesBefore = structuredClone(getMusicalNotes(EXISTING_CLIP_ID));

        await commitScriptedBatch(BLUES_PROMPT);

        expect(getTracks()).toHaveLength(2);
        expect(getTracks().find((track) => track.id === EXISTING_TRACK_ID)).toEqual(existingTrackBefore);
        expect(getMusicalNotes(EXISTING_CLIP_ID)).toEqual(existingNotesBefore);
        const createdClipId = requireCreatedTrack().clips[0]?.id ?? '';
        expect(getMusicalNotes(createdClipId)).toEqual(deriveBluesNotes());

        await undo();

        expect(getTracks()).toEqual([existingTrackBefore]);
        expect(getMusicalNotes(EXISTING_CLIP_ID)).toEqual(existingNotesBefore);
        expect(midiStore.value?.notesByClipId[createdClipId]).toBeUndefined();
    });

    it('asks the questions that would resolve an ambiguous request instead of proposing a batch', async () => {
        runtimeMocks.backend.value = 'cloud';
        scriptCloudProviderTurns(runtimeMocks.generateCloudToolCalls, [
            () => [
                declineCall({
                    kind: 'clarify',
                    reason: 'The request does not say which part of the mix to change.',
                    questions: ['Which tracks should change?', 'What should sound different about them?'],
                }),
            ],
        ]);

        await sendChatMessage(CLARIFY_PROMPT);

        expect(getAssistantContent()).toBe(
            'The request does not say which part of the mix to change. 1. Which tracks should change? 2. What should sound different about them?'
        );
        expectNoBatchWasProposedOrExecuted();
        expect(getTracks()).toEqual([]);
    });

    it('reports what it searched for when the catalog holds no command for the request', async () => {
        runtimeMocks.backend.value = 'cloud';
        scriptCloudProviderTurns(runtimeMocks.generateCloudToolCalls, [
            () => searchCalls(['master the song for vinyl']),
            () => [
                declineCall({
                    kind: 'unsupported',
                    reason: 'No command in this project masters for vinyl.',
                    questions: [],
                }),
            ],
        ]);

        await sendChatMessage(UNSUPPORTED_PROMPT);

        expect(getAssistantContent()).toBe(
            'Not supported: No command in this project masters for vinyl. Searched: master the song for vinyl'
        );
        expectNoBatchWasProposedOrExecuted();
        expect(getTracks()).toEqual([]);
    });

    it('refuses the whole batch when the proposal carries a project-wide change the request never asked for', async () => {
        const searchedNames = [...PROPOSED_COMMAND_NAMES, 'setTempo'];
        scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
            () => searchCalls([...SEARCH_INTENTS, TEMPO_SEARCH_INTENT]),
            discoverSearchedCalls(searchedNames),
            proposeDiscoveredCalls(
                [...bluesProposalItems(), { id: 'set-tempo', name: 'setTempo', arguments: { bpm: 96 } }],
                searchedNames
            ),
        ]);

        await sendChatMessage(BLUES_PROMPT);

        expect(getAssistantContent()).toBe(
            'Command not executed: Provider action rejected: setTempo: Provider action is not grounded in the user request'
        );
        expectNoBatchWasProposedOrExecuted();
        expect(getTracks()).toEqual([]);
    });

    it('refuses every attempt to reach an existing project object the request never named', async () => {
        seedPartiallyBuiltProject();
        const projectBefore = structuredClone(getTracks());
        const [makeTrack, makeClip, writeChords] = bluesProposalItems();
        const ungroundedItems = [
            makeTrack ?? {},
            // The clip lands on a track the project already holds, and the request named no track at
            // all: the creation waiver covers only objects this same batch creates.
            { ...makeClip, arguments: { ...(makeClip?.arguments as object), trackId: EXISTING_TRACK_ID } },
            writeChords ?? {},
        ];
        cycleProviderAttempt(runtimeMocks.generateWebLlmCompletion, [
            () => searchCalls(),
            discoverSearchedCalls(),
            proposeDiscoveredCalls(ungroundedItems),
        ]);

        await sendChatMessage(BLUES_PROMPT);

        expect(getAssistantContent()).toBe(
            'Command not executed: Provider action rejected: Targeted command requires a bounded semantic bulk selector.'
        );
        expectNoBatchWasProposedOrExecuted();
        expect(getTracks()).toEqual(projectBefore);
        expect(getMusicalNotes(EXISTING_CLIP_ID)).toEqual(
            existingNotes.map(({ pitch, startBeat, duration, velocity }) => ({
                pitch,
                startBeat,
                duration,
                velocity,
            }))
        );
    });

    it('proposes from what the command index returned rather than collapsing to no-match', async () => {
        const messages = scriptHighLevelIntentProvider(runtimeMocks.generateWebLlmCompletion);

        const result = await parsePromptToActions(
            BLUES_PROMPT,
            getProjectContext(),
            undefined,
            captureProjectRevision()
        );

        const discoverTurnMessage = messages[1] ?? '';
        const proposeTurnMessage = messages[2] ?? '';
        const searched = getSearchedCommandNames(discoverTurnMessage);
        expect([...PROPOSED_COMMAND_NAMES].every((name) => searched.has(name))).toBe(true);
        const discovery = getDiscoveryReceipt(proposeTurnMessage);
        const discoveredChordProgression = isRecord(discovery.data)
            ? (discovery.data.items as unknown[]).find(
                  (item) => isRecord(item) && isRecord(item.function) && item.function.name === 'chordProgression'
              )
            : undefined;
        expect(discoveredChordProgression).toMatchObject({
            type: 'function',
            function: {
                name: 'chordProgression',
                parameters: {
                    required: ['clipId', 'bars'],
                    properties: {
                        bars: { type: 'integer', minimum: 1, maximum: 16 },
                        seed: { type: 'integer', minimum: 0, maximum: 2_147_483_647, default: 1 },
                    },
                },
            },
        });
        expect(result.planningOutcome).toEqual({ kind: 'proposal' });
        expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes']);
    });

    it('says a decided no-match in its own words rather than the text a missing outcome produces', async () => {
        // The run searched and then returned no call at all: that is a decided outcome, and it is the
        // one the orchestrator's generic fallback would otherwise swallow.
        scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [() => searchCalls(), () => []]);

        await sendChatMessage(BLUES_PROMPT);

        expect(getAssistantContent()).not.toContain('No actions were matched or executed for your command.');
        expect(getAssistantContent()).toBe(NO_MATCH_TEXT);
        expectNoBatchWasProposedOrExecuted();
    });
});
