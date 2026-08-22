import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
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
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const PROMPT = 'Copy chorus-one articulation to chorus two without copying pitches or velocities.';
const PARAPHRASE =
    'Transfer note articulations from the first chorus into the matching second-chorus clips, leaving pitch and velocity intact.';

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        transformPlan: { value: (plan: Array<{ name: string; arguments: Record<string, string> }>) => plan },
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

function createClip(id: string, trackId: string, name: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId,
        name,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function createTrack(
    trackId = 'track-strings',
    name = 'Strings',
    kind: Track['kind'] = 'midi',
    clipPrefix = 'clip'
): Track {
    return {
        id: trackId,
        name,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [
            createClip(`${clipPrefix}-chorus-one`, trackId, `${name} Chorus One`, 0, 16),
            createClip(`${clipPrefix}-chorus-two`, trackId, `${name} Chorus Two`, 16, 32),
        ],
        devices:
            kind === 'midi'
                ? [
                      {
                          id: `${trackId}-levain`,
                          name: 'Levain',
                          type: 'levain',
                          bypassed: false,
                          parameterValues: {},
                      },
                  ]
                : [],
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

function addSecondMidiAndAudioTracks(): void {
    const current = trackStore.value;
    if (!current) {
        throw new TypeError('Expected track state');
    }
    trackStore.set({
        ...current,
        tracks: [
            ...current.tracks,
            createTrack('track-brass', 'Brass', 'midi', 'brass'),
            createTrack('track-audio-fx', 'Audio FX', 'audio', 'audio-fx'),
        ],
    });
    const midi = midiStore.value;
    if (!midi) {
        throw new TypeError('Expected MIDI state');
    }
    midiStore.set({
        ...midi,
        notesByClipId: {
            ...midi.notesByClipId,
            'brass-chorus-one': [
                Object.assign(
                    { id: 'brass-source', pitch: 48, startBeat: 2, duration: 1, velocity: 118 },
                    { articulation: 'marcato' }
                ),
            ],
            'brass-chorus-two': [
                Object.assign(
                    { id: 'brass-target', pitch: 50, startBeat: 2, duration: 1, velocity: 68 },
                    { articulation: 'legato' }
                ),
            ],
        },
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createProviderPlan(userMessage: string) {
    const match = /<project_context>\n(?<contextJson>.+)\n<\/project_context>/u.exec(userMessage);
    const contextJson = match?.groups?.contextJson;
    if (!contextJson) {
        throw new TypeError('Expected serialized project context');
    }
    const context: unknown = JSON.parse(contextJson);
    if (!isRecord(context) || typeof context.projectRevision !== 'string') {
        throw new TypeError('Expected revision-bound project context');
    }
    const capability = context.articulationTransferCapability;
    if (!isRecord(capability) || capability.baseRevision !== context.projectRevision) {
        throw new TypeError('Expected revision-bound MF-03 capability');
    }
    const allowedAction = capability.allowedAction;
    if (!isRecord(allowedAction) || !Array.isArray(allowedAction.exactClipPairs)) {
        throw new TypeError('Expected exact MF-03 clip-pair capability');
    }
    return allowedAction.exactClipPairs.map((pair) => {
        if (!isRecord(pair) || typeof pair.sourceClipId !== 'string' || typeof pair.targetClipId !== 'string') {
            throw new TypeError('Expected exact MF-03 source and target clip IDs');
        }
        return {
            name: 'copyMidiArticulations',
            arguments: { sourceClipId: pair.sourceClipId, targetClipId: pair.targetClipId },
        };
    });
}

function getHostedUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    if (!isRecord(request) || !Array.isArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    const userMessage = request.messages.find(
        (message) => isRecord(message) && message.role === 'user' && typeof message.content === 'string'
    );
    if (!isRecord(userMessage) || typeof userMessage.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return userMessage.content;
}

function useHostedFixture(): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const plan = withWorkflowCapabilitySelection(
            'articulation-transfer',
            runtimeMocks.transformPlan.value(createProviderPlan(getHostedUserMessage(init.body)))
        );
        return Promise.resolve(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                tool_calls: plan.map((call) => ({
                                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                })),
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
    });
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

describe('MF-03 articulation transfer prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.transformPlan.value = (plan) => plan;
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(
                JSON.stringify(
                    withWorkflowCapabilitySelection(
                        'articulation-transfer',
                        runtimeMocks.transformPlan.value(createProviderPlan(userMessage))
                    )
                )
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
        resetCrdtProjectAuthority('MF-03 articulation workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [createTrack()], selectedTrackId: null, ghostClips: [] });
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 0, endBeat: 16, color: '#ffffff' },
                { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 16, endBeat: 32, color: '#ffffff' },
            ],
        });
        midiStore.set({
            notesByClipId: {
                'clip-chorus-one': [
                    Object.assign(
                        { id: 'source-high', pitch: 67, startBeat: 0, duration: 1, velocity: 96 },
                        { articulation: 'marcato' }
                    ),
                    Object.assign(
                        { id: 'source-low', pitch: 60, startBeat: 0, duration: 1, velocity: 110 },
                        { articulation: 'staccato' }
                    ),
                ],
                'clip-chorus-two': [
                    Object.assign(
                        { id: 'target-low', pitch: 62, startBeat: 0, duration: 1, velocity: 72 },
                        { articulation: 'legato' }
                    ),
                    Object.assign(
                        { id: 'target-high', pitch: 69, startBeat: 0, duration: 1, velocity: 84 },
                        { articulation: 'sustain' }
                    ),
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
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
        resetCrdtProjectAuthority('MF-03 articulation workflow cleanup');
        removeCrdtDoc('root');
    });

    it('routes a semantic paraphrase to the articulation-transfer capability', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(getConfirmationId()).not.toBe('');
    });

    it('copies only exact articulation state through confirmation and one Command write', async () => {
        await sendChatMessage(PROMPT);

        const confirmationId = getConfirmationId();
        expect(confirmationId).not.toBe('');
        const confirmation = getPendingActionConfirmation(confirmationId);
        expect(confirmation?.actions).toEqual([
            expect.objectContaining({
                type: 'copyMidiArticulations',
                payload: expect.objectContaining({
                    sourceClipId: 'clip-chorus-one',
                    targetClipId: 'clip-chorus-two',
                    notePairs: [
                        { sourceNoteId: 'source-low', targetNoteId: 'target-low' },
                        { sourceNoteId: 'source-high', targetNoteId: 'target-high' },
                    ],
                }),
            }),
        ]);
        const exactSemanticDiff =
            'Track "Strings" (track-strings): "Strings Chorus One" (clip-chorus-one) → "Strings Chorus Two" (clip-chorus-two); target note target-low from source-low articulation legato → staccato; target note target-high from source-high articulation sustain → marcato; preserve target pitches, velocities, timing, and expression';
        expect(confirmation?.actionLabels).toEqual([exactSemanticDiff]);
        expect(confirmation?.approvalSnapshot.actionLabels).toEqual([exactSemanticDiff]);
        expect(confirmation?.affectedIds).toEqual([
            'track-strings',
            'clip-chorus-one',
            'clip-chorus-two',
            'target-low',
            'target-high',
        ]);
        expect(confirmation?.risk).toEqual({
            level: 'broad-reversible',
            reason: 'This action can change a broad section of the project.',
        });

        expect(await confirmPendingChatActions({ confirmationId })).toEqual({ status: 'executed' });

        expect(midiStore.value?.notesByClipId['clip-chorus-two']).toEqual([
            {
                id: 'target-low',
                pitch: 62,
                startBeat: 0,
                duration: 1,
                velocity: 72,
                articulation: 'staccato',
            },
            {
                id: 'target-high',
                pitch: 69,
                startBeat: 0,
                duration: 1,
                velocity: 84,
                articulation: 'marcato',
            },
        ]);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'executed',
            executionMode: 'atomic',
            executedActions: [
                {
                    actionType: 'copyMidiArticulations',
                    label: exactSemanticDiff,
                    executionKind: 'project',
                    affectedIds: ['track-strings', 'clip-chorus-one', 'clip-chorus-two', 'target-low', 'target-high'],
                    outcome: 'committed',
                },
            ],
        });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmationId
        );
        expect(receipt?.content).toContain(exactSemanticDiff);
        expect(receipt?.content).toContain(
            'Affected IDs: track-strings, clip-chorus-one, clip-chorus-two, target-low, target-high'
        );

        await undo();
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
        await redo();
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'staccato',
            'marcato',
        ]);
    });

    it('normalizes the hosted OpenAI-compatible plan from the same revision-bound capability', async () => {
        useHostedFixture();

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions).toEqual([
            expect.objectContaining({
                type: 'copyMidiArticulations',
                payload: expect.objectContaining({
                    sourceClipId: 'clip-chorus-one',
                    targetClipId: 'clip-chorus-two',
                }),
            }),
        ]);
        expect(runtimeMocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('includes every unambiguous MIDI chorus pair and protects audio clips and non-articulation fields', async () => {
        addSecondMidiAndAudioTracks();

        await sendChatMessage(PROMPT);

        const confirmationId = getConfirmationId();
        const confirmation = getPendingActionConfirmation(confirmationId);
        expect(
            confirmation?.actions.map((action) => ({
                type: action.type,
                sourceClipId: action.type === 'copyMidiArticulations' ? action.payload.sourceClipId : null,
                targetClipId: action.type === 'copyMidiArticulations' ? action.payload.targetClipId : null,
            }))
        ).toEqual([
            {
                type: 'copyMidiArticulations',
                sourceClipId: 'clip-chorus-one',
                targetClipId: 'clip-chorus-two',
            },
            {
                type: 'copyMidiArticulations',
                sourceClipId: 'brass-chorus-one',
                targetClipId: 'brass-chorus-two',
            },
        ]);
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'audio-fx-chorus-one', name: 'Audio FX Chorus One' },
                { id: 'audio-fx-chorus-two', name: 'Audio FX Chorus Two' },
                {
                    id: 'clip-chorus-two:non-articulation',
                    name: 'Strings Chorus Two pitches, velocities, timing, and expression',
                },
                {
                    id: 'brass-chorus-two:non-articulation',
                    name: 'Brass Chorus Two pitches, velocities, timing, and expression',
                },
            ])
        );

        await confirmPendingChatActions({ confirmationId });

        expect(midiStore.value?.notesByClipId['brass-chorus-two']).toEqual([
            {
                id: 'brass-target',
                pitch: 50,
                startBeat: 2,
                duration: 1,
                velocity: 68,
                articulation: 'marcato',
            },
        ]);
    });

    it.each([
        ['omits the exact pair', () => []],
        [
            'duplicates the exact pair',
            (plan: Array<{ name: string; arguments: Record<string, string> }>) => [...plan, ...plan],
        ],
        [
            'enlarges the exact pair set',
            (plan: Array<{ name: string; arguments: Record<string, string> }>) => [
                ...plan,
                {
                    name: 'copyMidiArticulations',
                    arguments: { sourceClipId: 'clip-chorus-one', targetClipId: 'protected-clip' },
                },
            ],
        ],
    ])('rejects a provider plan that %s', async (_label, transform) => {
        runtimeMocks.transformPlan.value = transform;

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
    });

    it.each([
        [
            'locks the target clip',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-chorus-two' ? { ...clip, locked: true } : clip
                        ),
                    })),
                });
            },
        ],
        [
            'freezes the candidate track',
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
        [
            'removes the target chorus clip',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.filter((clip) => clip.id !== 'clip-chorus-two'),
                    })),
                });
            },
        ],
        [
            'adds a second target chorus clip',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) =>
                        track.id === 'track-strings'
                            ? {
                                  ...track,
                                  clips: [
                                      ...track.clips,
                                      createClip('clip-chorus-two-duplicate', track.id, 'Duplicate', 20, 28),
                                  ],
                              }
                            : track
                    ),
                });
            },
        ],
        [
            'changes the target note topology',
            () => {
                const state = midiStore.value!;
                midiStore.set({
                    ...state,
                    notesByClipId: {
                        ...state.notesByClipId,
                        'clip-chorus-two': state.notesByClipId['clip-chorus-two']!.map((note, index) =>
                            index === 0 ? { ...note, startBeat: 0.5 } : note
                        ),
                    },
                });
            },
        ],
    ])('fails closed before confirmation when project state %s', async (_label, mutateProject) => {
        mutateProject();

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
    });

    it('invalidates a confirmed proposal after a collaborator changes a source articulation', async () => {
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const state = midiStore.value!;
        midiStore.set({
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                'clip-chorus-one': state.notesByClipId['clip-chorus-one']!.map((note, index) =>
                    index === 0 ? { ...note, articulation: 'sustain' } : note
                ),
            },
        });

        await confirmPendingChatActions({ confirmationId });

        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'failed',
            executedActions: [],
        });
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
    });

    it('fails closed before confirmation when the target track has no per-note articulation instrument', async () => {
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, type: 'fermenter', name: 'Fermenter' })),
            })),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
    });

    it('fails closed before confirmation when a source articulation has no canonical runtime mapping', async () => {
        const state = midiStore.value!;
        midiStore.set({
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                'clip-chorus-one': state.notesByClipId['clip-chorus-one']!.map((note, index) =>
                    index === 0 ? { ...note, articulation: 'accent' } : note
                ),
            },
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
    });

    it('keeps a grouped redo retryable when a collaborator changes a source articulation after undo', async () => {
        addSecondMidiAndAudioTracks();
        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmationId() });
        await undo();
        const historyBeforeConflict = structuredClone(undoStore.value);
        const state = midiStore.value!;
        midiStore.set({
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                'brass-chorus-one': state.notesByClipId['brass-chorus-one']!.map((note) => ({
                    ...note,
                    articulation: 'sforzando',
                })),
            },
        });

        await redo();

        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
        expect(midiStore.value?.notesByClipId['brass-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
        ]);
        expect(undoStore.value).toEqual(historyBeforeConflict);

        const conflictedState = midiStore.value!;
        midiStore.set({
            ...conflictedState,
            notesByClipId: {
                ...conflictedState.notesByClipId,
                'brass-chorus-one': conflictedState.notesByClipId['brass-chorus-one']!.map((note) => ({
                    ...note,
                    articulation: 'marcato',
                })),
            },
        });
        await redo();
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'staccato',
            'marcato',
        ]);
        expect(midiStore.value?.notesByClipId['brass-chorus-two']?.map((note) => note.articulation)).toEqual([
            'marcato',
        ]);
    });

    it.each([
        [
            'track freeze',
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
        [
            'source clip lock',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-chorus-one' ? { ...clip, locked: true } : clip
                        ),
                    })),
                });
            },
        ],
        [
            'target clip lock',
            () => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-chorus-two' ? { ...clip, locked: true } : clip
                        ),
                    })),
                });
            },
        ],
    ])('keeps grouped undo retryable when replay eligibility changes through %s', async (_label, mutateGuard) => {
        addSecondMidiAndAudioTracks();
        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmationId() });
        const eligibleTrackState = structuredClone(trackStore.value!);
        mutateGuard();
        const historyBeforeConflict = structuredClone(undoStore.value);

        await undo();

        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'staccato',
            'marcato',
        ]);
        expect(midiStore.value?.notesByClipId['brass-chorus-two']?.map((note) => note.articulation)).toEqual([
            'marcato',
        ]);
        expect(undoStore.value).toEqual(historyBeforeConflict);

        trackStore.set(eligibleTrackState);
        await undo();
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
        expect(midiStore.value?.notesByClipId['brass-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
        ]);
    });

    it('keeps articulation-less legacy source notes compatible with guarded undo and redo', async () => {
        const state = midiStore.value!;
        midiStore.set({
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                'clip-chorus-one': state.notesByClipId['clip-chorus-one']!.map((note) => {
                    const { articulation: _articulation, ...legacyNote } = note;
                    return legacyNote;
                }),
            },
        });

        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmationId() });
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            undefined,
            undefined,
        ]);
        await undo();
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
        await redo();
        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            undefined,
            undefined,
        ]);
    });

    it('rolls back the whole group without receipt or history residue when a later pair conflicts', async () => {
        addSecondMidiAndAudioTracks();
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const state = midiStore.value!;
        midiStore.set({
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                'brass-chorus-one': state.notesByClipId['brass-chorus-one']!.map((note) => ({
                    ...note,
                    articulation: 'sforzando',
                })),
            },
        });

        await confirmPendingChatActions({ confirmationId });

        expect(midiStore.value?.notesByClipId['clip-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
            'sustain',
        ]);
        expect(midiStore.value?.notesByClipId['brass-chorus-two']?.map((note) => note.articulation)).toEqual([
            'legato',
        ]);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'failed',
            executedActions: [],
        });
        expect(undoStore.value?.past).toEqual([]);
    });
});
