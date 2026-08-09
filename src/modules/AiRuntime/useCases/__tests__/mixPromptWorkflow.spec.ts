import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
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

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { generateWebLlmCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

const PROMPT =
    'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';

const providerPlan = [
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.7 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-left', pan: -20 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-right', pan: 20 } },
    { name: 'muteTrack', arguments: { trackId: 'track-room-mic', muted: true } },
] as const;

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        gains: new Map<string, number>(),
        generateWebLlmCompletion: vi.fn(),
        getAllSidechainRoutes: vi.fn(() => []),
        mutes: new Map<string, boolean>(),
        pans: new Map<string, number>(),
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

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

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

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

function getHostedRequestBody(): string {
    const body = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

function expectExactMix(): void {
    expect(getTrack('track-lead-vocal')).toMatchObject({ gain: 0.7, pan: 0, muted: false });
    expect(getTrack('track-guitar-left')).toMatchObject({ gain: 1, pan: -20, muted: false });
    expect(getTrack('track-guitar-right')).toMatchObject({ gain: 1, pan: 20, muted: false });
    expect(getTrack('track-room-mic')).toMatchObject({ gain: 1, pan: 0, muted: true });
    expect(runtimeMocks.gains.get('track-lead-vocal')).toBe(0.7);
    expect(runtimeMocks.pans.get('track-guitar-left')).toBe(-20);
    expect(runtimeMocks.pans.get('track-guitar-right')).toBe(20);
    expect(runtimeMocks.mutes.get('track-room-mic')).toBe(true);
}

describe('mix prompt workflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(providerPlan));
        runtimeMocks.fetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                tool_calls: providerPlan.map((call) => ({
                                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                })),
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        cloudSession.clear();
        cloudSession.replace_runtime({
            provider: 'openai-compatible',
            api_key: '',
            model: 'fixture-model',
            base_url: 'https://provider.example/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('mix prompt workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
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
        runtimeMocks.gains.clear();
        runtimeMocks.pans.clear();
        runtimeMocks.mutes.clear();
        for (const track of tracks) {
            runtimeMocks.gains.set(track.id, track.gain);
            runtimeMocks.pans.set(track.id, track.pan);
            runtimeMocks.mutes.set(track.id, track.muted);
        }
        chatStore.set({
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds, protects, confirms, atomically commits, receipts, undoes, and redoes the exact mix', async () => {
        const protectedBefore = structuredClone(getTrack('track-drum-bus'));
        const unrelatedBefore = structuredClone(getTrack('track-bass'));

        await sendChatMessage(PROMPT);

        const providerRequest = vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[1];
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('track-lead-vocal');
        expect(providerRequest).toContain('track-guitar-left');
        expect(providerRequest).toContain('track-guitar-right');
        expect(providerRequest).toContain('track-room-mic');
        expect(providerRequest).toContain('track-drum-bus');
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.7 } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar-left', pan: -20 } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar-right', pan: 20 } },
            { type: 'muteTrack', payload: { trackId: 'track-room-mic', muted: true } },
        ]);
        expect(confirmation).toMatchObject({
            executionMode: 'atomic',
            protectedUnchanged: [{ id: 'track-drum-bus', name: 'Drum Bus' }],
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain('Protected unchanged: "Drum Bus" (track-drum-bus)');
        const revisionBefore = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).not.toBe(revisionBefore);
        expectExactMix();
        expect(getTrack('track-drum-bus')).toEqual(protectedBefore);
        expect(getTrack('track-bass')).toEqual(unrelatedBefore);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Protected unchanged: "Drum Bus" (track-drum-bus)');
        expect(getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions).toHaveLength(4);
        const undoEntries = undoStore.value?.past ?? [];
        expect(undoEntries).toHaveLength(4);

        await undo();

        expect(['track-lead-vocal', 'track-guitar-left', 'track-guitar-right', 'track-room-mic'].map(getTrack)).toEqual(
            [
                expect.objectContaining({ gain: 1, pan: 0, muted: false }),
                expect.objectContaining({ gain: 1, pan: 0, muted: false }),
                expect.objectContaining({ gain: 1, pan: 0, muted: false }),
                expect.objectContaining({ gain: 1, pan: 0, muted: false }),
            ]
        );
        expect(runtimeMocks.gains.get('track-lead-vocal')).toBe(1);
        expect(runtimeMocks.pans.get('track-guitar-left')).toBe(0);
        expect(runtimeMocks.pans.get('track-guitar-right')).toBe(0);
        expect(runtimeMocks.mutes.get('track-room-mic')).toBe(false);
        expect(getTrack('track-drum-bus')).toEqual(protectedBefore);
        expect(getTrack('track-bass')).toEqual(unrelatedBefore);

        await redo();

        expectExactMix();
        expect(getTrack('track-drum-bus')).toEqual(protectedBefore);
        expect(getTrack('track-bass')).toEqual(unrelatedBefore);
    });

    it('grounds the hosted OpenAI-compatible fixture to the same terminal result', async () => {
        runtimeMocks.backend.value = 'cloud';
        const protectedBefore = structuredClone(getTrack('track-drum-bus'));

        await sendChatMessage(PROMPT);

        const providerRequest = getHostedRequestBody();
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('track-lead-vocal');
        expect(providerRequest).toContain('track-guitar-left');
        expect(providerRequest).toContain('track-guitar-right');
        expect(providerRequest).toContain('track-room-mic');
        expect(providerRequest).toContain('track-drum-bus');
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions).toEqual(
            providerPlan.map((call) => ({ type: call.name, payload: call.arguments }))
        );

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expectExactMix();
        expect(getTrack('track-drum-bus')).toEqual(protectedBefore);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Protected unchanged: "Drum Bus" (track-drum-bus)');
    });

    it('rejects provider enlargement that targets the protected Drum Bus', async () => {
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(
            JSON.stringify([
                ...providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } })),
                { name: 'muteTrack', arguments: { trackId: 'track-drum-bus', muted: true } },
            ])
        );
        const projectBefore = structuredClone(trackStore.value?.tracks);
        const runtimeBefore = {
            gains: new Map(runtimeMocks.gains),
            pans: new Map(runtimeMocks.pans),
            mutes: new Map(runtimeMocks.mutes),
        };

        await sendChatMessage(PROMPT);

        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(trackStore.value?.tracks).toEqual(projectBefore);
        expect(runtimeMocks.gains).toEqual(runtimeBefore.gains);
        expect(runtimeMocks.pans).toEqual(runtimeBefore.pans);
        expect(runtimeMocks.mutes).toEqual(runtimeBefore.mutes);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('compensates runtime effects and publishes no project prefix, receipt, or undo after a later action fails', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected the proposed mix batch');
        }
        const projectBefore = structuredClone(trackStore.value?.tracks);
        const runtimeBefore = {
            gains: new Map(runtimeMocks.gains),
            pans: new Map(runtimeMocks.pans),
            mutes: new Map(runtimeMocks.mutes),
        };
        runtimeMocks.setTrackMute.mockImplementationOnce(() => {
            throw new Error('injected Room Mic runtime failure');
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result).toEqual({ status: 'failed', reason: 'injected Room Mic runtime failure' });
        expect(trackStore.value?.tracks).toEqual(projectBefore);
        expect(runtimeMocks.gains).toEqual(runtimeBefore.gains);
        expect(runtimeMocks.pans).toEqual(runtimeBefore.pans);
        expect(runtimeMocks.mutes).toEqual(runtimeBefore.mutes);
        expect(runtimeMocks.setTrackGain.mock.calls).toEqual([
            ['track-lead-vocal', 0.7],
            ['track-lead-vocal', 1],
        ]);
        expect(runtimeMocks.setTrackPan.mock.calls).toEqual([
            ['track-guitar-left', -20],
            ['track-guitar-right', 20],
            ['track-guitar-right', 0],
            ['track-guitar-left', 0],
        ]);
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(terminalMessage?.content).not.toContain('Affected IDs:');
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
    });
});
