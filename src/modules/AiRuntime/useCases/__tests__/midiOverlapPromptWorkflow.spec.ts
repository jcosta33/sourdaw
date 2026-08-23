import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    trackStore,
    type Clip,
    type Track,
} from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
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
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    createHostedWorkflowPlanningResponder,
    createProviderWorkflowPlanningResponder,
    decodeHostedProviderUserMessage,
    decodeProviderPlanningFixtureContext,
    type ProviderScope,
} from './providerToolPlanningFixture';

const PROMPT =
    'On every selected MIDI clip, shorten only overlaps strictly below 30 ms and leave overlaps exactly at or above 30 ms unchanged.';
const PARAPHRASE =
    'Across the selected MIDI clips, trim just the note collisions under thirty milliseconds and leave longer ones alone.';

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn<(systemPrompt: string, userMessage: string) => Promise<string>>(),
        transformPlan: { value: (plan: ProviderCall[]) => plan },
    };
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

function createAudioTrack(id: string, name: string, clipId: string): Track {
    const track = createTrack(id, name, clipId);
    return {
        ...track,
        kind: 'audio',
        clips: track.clips.map((clip) => ({ ...clip, type: 'audio' })),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getProviderCapability(userMessage: string) {
    const planningContext = decodeProviderPlanningFixtureContext(userMessage);
    const capability = planningContext.capabilityData.midiOverlapTransformCapability;
    if (!isRecord(capability) || capability.baseRevision !== planningContext.revision) {
        throw new TypeError('Expected revision-bound EX-04 capability');
    }
    const allowedAction = capability.allowedAction;
    if (!isRecord(allowedAction)) {
        throw new TypeError('Expected exact selected MIDI clip capability');
    }
    const { exactClipIds, maximumOverlapMs } = allowedAction;
    if (
        !Array.isArray(exactClipIds) ||
        !exactClipIds.every((clipId): clipId is string => typeof clipId === 'string') ||
        maximumOverlapMs !== 30
    ) {
        throw new TypeError('Expected exact selected MIDI clip capability');
    }
    return { allowedAction: { exactClipIds, maximumOverlapMs }, capability };
}

function createProviderPlan(userMessage: string) {
    const { allowedAction } = getProviderCapability(userMessage);
    return allowedAction.exactClipIds.map((clipId) => {
        return {
            name: 'removeShortMidiOverlaps',
            arguments: {
                clipId,
                maximumOverlapMs: allowedAction.maximumOverlapMs,
            },
        };
    });
}

function getProviderScope(userMessage: string): ProviderScope {
    const { allowedAction, capability } = getProviderCapability(userMessage);
    const exactClipIds = allowedAction.exactClipIds;
    const selectedClips = Array.isArray(capability.selectedClips) ? capability.selectedClips : [];
    const trackIds = exactClipIds.map((clipId) => {
        const selectedClip = selectedClips.find((candidate) => isRecord(candidate) && candidate.clipId === clipId);
        if (!isRecord(selectedClip) || typeof selectedClip.trackId !== 'string') {
            throw new TypeError(`Expected exact EX-04 track for ${clipId}`);
        }
        return selectedClip.trackId;
    });
    const targetRanges = exactClipIds.map((clipId) => {
        const starts = (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => note.startBeat);
        if (starts.length === 0) {
            throw new TypeError(`Expected EX-04 note range for ${clipId}`);
        }
        return { startBeat: Math.min(...starts), endBeat: Math.max(...starts) };
    });
    if (!Array.isArray(capability.protectedClipIds)) {
        throw new TypeError('Expected complete EX-04 protected scope');
    }
    return {
        targetIds: [...exactClipIds, ...trackIds],
        targetRanges,
        protectedTargetIds: capability.protectedClipIds.filter(
            (targetId): targetId is string => typeof targetId === 'string'
        ),
        protectedRanges: [],
    };
}

function useHostedFixture(): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const userMessage = decodeHostedProviderUserMessage(init);
        return Promise.resolve(
            createHostedWorkflowPlanningResponder(
                runtimeMocks.transformPlan.value(createProviderPlan(userMessage)),
                'midi-overlap-shortening',
                getProviderScope
            )(userMessage)
        );
    });
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

function getNoteDuration(clipId: string, noteId: string): number {
    const note = midiStore.value?.notesByClipId[clipId]?.find((candidate) => candidate.id === noteId);
    if (!note) {
        throw new TypeError(`Expected note ${noteId} in ${clipId}`);
    }
    return note.duration;
}

describe('EX-04 selected MIDI overlap prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.transformPlan.value = (plan) => plan;
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(
                createProviderWorkflowPlanningResponder(
                    runtimeMocks.transformPlan.value(createProviderPlan(userMessage)),
                    'midi-overlap-shortening',
                    getProviderScope
                )(userMessage)
            )
        );
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('EX-04 overlap workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({
            tracks: [
                createTrack('track-piano', 'Piano', 'clip-piano'),
                createTrack('track-strings', 'Strings', 'clip-strings'),
                createTrack('track-unselected', 'Unselected', 'clip-unselected'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        clipSelectionStore.set({
            ...defaultClipSelectionState,
            selectedClipId: 'clip-piano',
            selectedClipIds: ['clip-piano', 'clip-strings'],
        });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        midiStore.set({
            notesByClipId: {
                'clip-piano': [
                    { id: 'piano-short-a', pitch: 60, startBeat: 0, duration: 1.04, velocity: 100, channel: 0 },
                    { id: 'piano-short-b', pitch: 60, startBeat: 1, duration: 1, velocity: 96, channel: 0 },
                    { id: 'piano-exact-a', pitch: 62, startBeat: 0, duration: 1.06, velocity: 92, channel: 0 },
                    { id: 'piano-exact-b', pitch: 62, startBeat: 1, duration: 1, velocity: 88, channel: 0 },
                    { id: 'piano-long-a', pitch: 64, startBeat: 0, duration: 1.08, velocity: 84, channel: 0 },
                    { id: 'piano-long-b', pitch: 64, startBeat: 1, duration: 1, velocity: 80, channel: 0 },
                    { id: 'piano-poly-a', pitch: 70, startBeat: 0, duration: 2, velocity: 76, channel: 0 },
                    { id: 'piano-poly-b', pitch: 71, startBeat: 1, duration: 1, velocity: 72, channel: 0 },
                    { id: 'piano-channel-a', pitch: 72, startBeat: 0, duration: 2, velocity: 68, channel: 1 },
                    { id: 'piano-channel-b', pitch: 72, startBeat: 1, duration: 1, velocity: 64, channel: 2 },
                ],
                'clip-strings': [
                    { id: 'strings-short-a', pitch: 67, startBeat: 2, duration: 1.02, velocity: 100, channel: 1 },
                    { id: 'strings-short-b', pitch: 67, startBeat: 3, duration: 1, velocity: 100, channel: 1 },
                ],
                'clip-unselected': [
                    { id: 'unselected-short-a', pitch: 48, startBeat: 0, duration: 1.02, velocity: 100, channel: 0 },
                    { id: 'unselected-short-b', pitch: 48, startBeat: 1, duration: 1, velocity: 100, channel: 0 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        resetAiWorkflowCommandPreflightFixture();
        clearPendingActionConfirmations();
        clearHandlerRegistry();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('EX-04 overlap workflow cleanup');
        removeCrdtDoc('root');
    });

    it('routes a semantic paraphrase to the MIDI-overlap capability', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(getConfirmationId()).not.toBe('');
    });

    it('confirms and commits only sub-30 ms same-pitch/channel overlaps as one guarded history group', async () => {
        const originalPiano = structuredClone(midiStore.value?.notesByClipId['clip-piano']);
        const originalStrings = structuredClone(midiStore.value?.notesByClipId['clip-strings']);
        const originalUnselected = structuredClone(midiStore.value?.notesByClipId['clip-unselected']);

        await sendChatMessage(PROMPT);

        const confirmationId = getConfirmationId();
        expect(confirmationId).not.toBe('');
        const confirmation = getPendingActionConfirmation(confirmationId);
        expect(confirmation?.actions).toHaveLength(2);
        expect(confirmation?.actions[0]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: {
                clipId: 'clip-piano',
                maximumOverlapMs: 30,
                expectedTempo: 120,
                expectedTrackId: 'track-piano',
                expectedTrackFrozen: false,
                expectedClipLocked: false,
            },
        });
        expect(confirmation?.actions[1]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: {
                clipId: 'clip-strings',
                maximumOverlapMs: 30,
                expectedTempo: 120,
                expectedTrackId: 'track-strings',
                expectedTrackFrozen: false,
                expectedClipLocked: false,
            },
        });
        const pianoLabel =
            'Track "Piano" (track-piano), clip "Piano Phrase" (clip-piano): shorten 1 same-pitch/channel overlap strictly below 30 ms; note piano-short-a duration 1.04 → 1 beats (remove 20 ms overlap); preserve note starts, pitches, velocities, channels, expression, articulations, and overlaps at or above 30 ms';
        const stringsLabel =
            'Track "Strings" (track-strings), clip "Strings Phrase" (clip-strings): shorten 1 same-pitch/channel overlap strictly below 30 ms; note strings-short-a duration 1.02 → 1 beats (remove 10 ms overlap); preserve note starts, pitches, velocities, channels, expression, articulations, and overlaps at or above 30 ms';
        expect(confirmation?.actionLabels).toEqual([pianoLabel, stringsLabel]);
        expect(confirmation?.affectedIds).toEqual([
            'track-piano',
            'clip-piano',
            'piano-short-a',
            'track-strings',
            'clip-strings',
            'strings-short-a',
        ]);
        expect(confirmation?.risk).toEqual({
            level: 'broad-reversible',
            reason: 'This action can change a broad section of the project.',
        });
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'clip-unselected', name: 'Unselected Phrase (unselected)' },
                {
                    id: 'clip-piano:non-duration',
                    name: 'Piano Phrase note starts, pitches, velocities, channels, expression, and articulations',
                },
                {
                    id: 'clip-piano:overlap-at-or-above-30ms',
                    name: 'Piano Phrase overlaps exactly at or above 30 ms',
                },
            ])
        );

        await confirmPendingChatActions({ confirmationId });

        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1);
        expect(getNoteDuration('clip-piano', 'piano-exact-a')).toBe(1.06);
        expect(getNoteDuration('clip-piano', 'piano-long-a')).toBe(1.08);
        expect(getNoteDuration('clip-piano', 'piano-poly-a')).toBe(2);
        expect(getNoteDuration('clip-piano', 'piano-channel-a')).toBe(2);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1);
        expect(midiStore.value?.notesByClipId['clip-unselected']).toEqual(originalUnselected);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'executed',
            executionMode: 'atomic',
            executedActions: [
                expect.objectContaining({
                    actionType: 'removeShortMidiOverlaps',
                    label: pianoLabel,
                    affectedIds: ['track-piano', 'clip-piano', 'piano-short-a'],
                    outcome: 'committed',
                }),
                expect.objectContaining({
                    actionType: 'removeShortMidiOverlaps',
                    label: stringsLabel,
                    affectedIds: ['track-strings', 'clip-strings', 'strings-short-a'],
                    outcome: 'committed',
                }),
            ],
        });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmationId
        );
        expect(receipt?.content).toContain(pianoLabel);
        expect(receipt?.content).toContain(stringsLabel);
        expect(receipt?.content).toContain('Protected unchanged:');
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();
        expect(midiStore.value?.notesByClipId['clip-piano']).toEqual(originalPiano);
        expect(midiStore.value?.notesByClipId['clip-strings']).toEqual(originalStrings);
        await redo();
        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1);
        expect(midiStore.value?.notesByClipId['clip-unselected']).toEqual(originalUnselected);
    });

    it('excludes a selected audio clip while applying the workflow to every selected MIDI clip', async () => {
        const audioTrack = createAudioTrack('track-audio', 'Audio', 'clip-audio');
        trackStore.set({
            ...trackStore.value!,
            tracks: [...trackStore.value!.tracks, audioTrack],
        });
        clipSelectionStore.set({
            ...clipSelectionStore.value!,
            selectedClipIds: ['clip-piano', 'clip-audio', 'clip-strings'],
        });

        await sendChatMessage(PROMPT);

        const confirmationId = getConfirmationId();
        const confirmation = getPendingActionConfirmation(confirmationId);
        expect(confirmation?.actions).toHaveLength(2);
        expect(confirmation?.actions[0]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: { clipId: 'clip-piano' },
        });
        expect(confirmation?.actions[1]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: { clipId: 'clip-strings' },
        });
        expect(confirmation?.protectedUnchanged).toContainEqual({
            id: 'clip-audio',
            name: 'Audio Phrase (selected non-MIDI clip)',
        });

        await confirmPendingChatActions({ confirmationId });

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-audio')).toEqual(audioTrack);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmationId
        );
        expect(receipt?.content).toContain('Audio Phrase (selected non-MIDI clip)');
    });

    it('normalizes the hosted OpenAI-compatible plan from the same revision-bound capability', async () => {
        useHostedFixture();

        await sendChatMessage(PROMPT);

        const actions = getPendingActionConfirmation(getConfirmationId())?.actions;
        expect(actions).toHaveLength(2);
        expect(actions?.[0]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: { clipId: 'clip-piano', maximumOverlapMs: 30 },
        });
        expect(actions?.[1]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: { clipId: 'clip-strings', maximumOverlapMs: 30 },
        });
        expect(runtimeMocks.fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['omits a selected clip', (plan: ProviderCall[]) => plan.slice(0, 1)],
        ['duplicates a selected clip', (plan: ProviderCall[]) => [...plan, plan[0]!]],
        [
            'enlarges the selected set',
            (plan: ProviderCall[]) => [
                ...plan,
                {
                    name: 'removeShortMidiOverlaps',
                    arguments: { clipId: 'clip-unselected', maximumOverlapMs: 30 },
                },
            ],
        ],
        [
            'changes the strict threshold',
            (plan: ProviderCall[]) =>
                plan.map((call) => ({ ...call, arguments: { ...call.arguments, maximumOverlapMs: 30.001 } })),
        ],
    ])('rejects a provider plan that %s', async (_label, transformPlan) => {
        runtimeMocks.transformPlan.value = transformPlan;

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1.04);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1.02);
    });

    it.each([
        [
            'locks a selected clip',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-strings' ? { ...clip, locked: true } : clip
                        ),
                    })),
                });
            },
        ],
        [
            'freezes a selected track',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) =>
                        track.id === 'track-strings' ? { ...track, frozen: true } : track
                    ),
                });
            },
        ],
    ])('fails closed before confirmation when the scope %s', async (_label, mutateScope) => {
        mutateScope();

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1.04);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1.02);
    });

    it.each([
        [
            'locks the later selected clip',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-strings' ? { ...clip, locked: true } : clip
                        ),
                    })),
                });
            },
        ],
        [
            'freezes the later selected track',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) =>
                        track.id === 'track-strings' ? { ...track, frozen: true } : track
                    ),
                });
            },
        ],
    ])('rejects the entire confirmed batch when current scope %s', async (_label, mutateScope) => {
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        mutateScope();

        await confirmPendingChatActions({ confirmationId });

        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1.04);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1.02);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({ status: 'failed', executedActions: [] });
        expect(undoStore.value?.past).toEqual([]);
    });

    it('converts the 30 ms threshold against the current project tempo', async () => {
        transportStore.set({ ...defaultTransportState, tempo: 60 });

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions).toHaveLength(1);
        expect(confirmation?.actions[0]).toMatchObject({
            type: 'removeShortMidiOverlaps',
            payload: {
                clipId: 'clip-strings',
                expectedTempo: 60,
                maximumOverlapMs: 30,
            },
        });
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([{ id: 'clip-piano', name: 'Piano Phrase (no overlap strictly below 30 ms)' }])
        );
    });

    it('rolls back the whole project batch without receipt or history when a later clip conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const state = midiStore.value!;
        midiStore.set({
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                'clip-strings': state.notesByClipId['clip-strings']!.map((note) =>
                    note.id === 'strings-short-a' ? { ...note, duration: 1.03 } : note
                ),
            },
        });

        await confirmPendingChatActions({ confirmationId });

        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1.04);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1.03);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({ status: 'failed', executedActions: [] });
        expect(undoStore.value?.past).toEqual([]);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmationId
        );
        expect(receipt?.content).not.toContain('Executed 2 actions');
    });

    it('keeps grouped undo and tempo-sensitive redo atomic and retryable on collaborator conflicts', async () => {
        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmationId() });
        const committed = midiStore.value!;
        midiStore.set({
            ...committed,
            notesByClipId: {
                ...committed.notesByClipId,
                'clip-piano': committed.notesByClipId['clip-piano']!.map((note) =>
                    note.id === 'piano-short-a' ? { ...note, duration: 0.9 } : note
                ),
            },
        });
        const historyBeforeUndoConflict = structuredClone(undoStore.value);

        await undo();

        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(0.9);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1);
        expect(undoStore.value).toEqual(historyBeforeUndoConflict);

        const conflicted = midiStore.value!;
        midiStore.set({
            ...conflicted,
            notesByClipId: {
                ...conflicted.notesByClipId,
                'clip-piano': conflicted.notesByClipId['clip-piano']!.map((note) =>
                    note.id === 'piano-short-a' ? { ...note, duration: 1 } : note
                ),
            },
        });
        await undo();
        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1.04);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1.02);

        transportStore.set({ ...defaultTransportState, tempo: 90 });
        const historyBeforeRedoConflict = structuredClone(undoStore.value);
        await redo();
        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1.04);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1.02);
        expect(undoStore.value).toEqual(historyBeforeRedoConflict);

        transportStore.set({ ...defaultTransportState, tempo: 120 });
        await redo();
        expect(getNoteDuration('clip-piano', 'piano-short-a')).toBe(1);
        expect(getNoteDuration('clip-strings', 'strings-short-a')).toBe(1);
    });
});
