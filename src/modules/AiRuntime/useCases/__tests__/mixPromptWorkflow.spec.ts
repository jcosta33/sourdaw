import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    setAutomationRecordingDependencies,
    startAutomationRecording,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

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

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    createHostedSemanticListPlanningResponder,
    createProviderSemanticListPlanningResponder,
    decodeHostedProviderUserMessage,
    type ProviderPlanCall,
    type SemanticCommandListItem,
} from './providerToolPlanningFixture';

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

function createProviderList(plan: readonly ProviderPlanCall[]): SemanticCommandListItem[] {
    const trackNames = new Map([
        ['track-lead-vocal', 'Lead Vocal'],
        ['track-guitar-left', 'Guitar Left'],
        ['track-guitar-right', 'Guitar Right'],
        ['track-room-mic', 'Room Mic'],
        ['track-drum-bus', 'Drum Bus'],
    ]);
    return plan.map((call, index) => {
        const { trackId, ...argumentsWithoutTrackId } = call.arguments;
        const trackName = typeof trackId === 'string' ? trackNames.get(trackId) : undefined;
        if (trackName === undefined) {
            throw new TypeError('Expected an exact mix fixture target');
        }
        return {
            id: `mix-command-${String(index + 1)}`,
            name: call.name,
            arguments: argumentsWithoutTrackId,
            selector: {
                targetArgument: 'trackId',
                entity: 'track',
                where: { name: trackName },
                quantity: { unit: 'targets', exactly: 1 },
            },
            ...(index === 0 ? {} : { dependsOn: [`mix-command-${String(index)}`] }),
        };
    });
}

function setProviderPlan(plan: readonly ProviderPlanCall[]): void {
    const scope = {
        targetIds: plan.flatMap((call) => (typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : [])),
        targetRanges: [],
        protectedTargetIds: ['track-drum-bus'],
        protectedRanges: [],
    };
    const webResponder = createProviderSemanticListPlanningResponder(createProviderList(plan), scope);
    const hostedResponder = createHostedSemanticListPlanningResponder(createProviderList(plan), scope);
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) =>
        Promise.resolve(webResponder(userMessage))
    );
    runtimeMocks.fetch.mockImplementation(async (_input, init) =>
        hostedResponder(decodeHostedProviderUserMessage(init))
    );
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
    beforeEach(async () => {
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        setProviderPlan(providerPlan);
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('mix prompt workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        configureAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
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
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
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

    afterEach(async () => {
        clearUndoHistory();
        resetAiWorkflowCommandPreflightFixture();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
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
            { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.7, expectedGain: 1 } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar-left', pan: -20, expectedPan: 0 } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar-right', pan: 20, expectedPan: 0 } },
            { type: 'muteTrack', payload: { trackId: 'track-room-mic', muted: true, expectedMuted: false } },
        ]);
        expect(confirmation).toMatchObject({
            executionMode: 'atomic',
            // Four commands across four tracks resolve broader than any single
            // bounded default, so the risk policy reports broad-reversible.
            risk: { level: 'broad-reversible' },
            protectedUnchanged: [{ id: 'track-drum-bus', name: 'Drum Bus' }],
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain('Set track "Lead Vocal" (track-lead-vocal) gain to 0.7');
        expect(proposal?.content).toContain('Set track "Guitar Left" (track-guitar-left) pan to -20');
        expect(proposal?.content).toContain('Set track "Guitar Right" (track-guitar-right) pan to +20');
        expect(proposal?.content).toContain('Mute track "Room Mic" (track-room-mic) (muted=true)');
        expect(proposal?.content).toContain('Approval risk: broad-reversible');
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
        expect(receipt?.content).toContain('Set track "Lead Vocal" (track-lead-vocal) gain to 0.7');
        expect(receipt?.content).toContain('Set track "Guitar Left" (track-guitar-left) pan to -20');
        expect(receipt?.content).toContain('Set track "Guitar Right" (track-guitar-right) pan to +20');
        expect(receipt?.content).toContain('Mute track "Room Mic" (track-room-mic) (muted=true)');
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
        expect(confirmation?.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.7, expectedGain: 1 } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar-left', pan: -20, expectedPan: 0 } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar-right', pan: 20, expectedPan: 0 } },
            { type: 'muteTrack', payload: { trackId: 'track-room-mic', muted: true, expectedMuted: false } },
        ]);

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
        setProviderPlan([
            ...providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } })),
            { name: 'muteTrack', arguments: { trackId: 'track-drum-bus', muted: true } },
        ]);
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

    it('preserves collaborator mixer edits and keeps grouped undo and redo retryable', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected the proposed mix batch');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });

        const collaboratorMuted = false;
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-room-mic' ? { ...track, muted: collaboratorMuted } : track
            ),
        });
        runtimeMocks.mutes.set('track-room-mic', collaboratorMuted);
        const pastBeforeConflict = structuredClone(undoStore.value?.past);

        await undo();

        expect(getTrack('track-room-mic').muted).toBe(collaboratorMuted);
        expect(runtimeMocks.mutes.get('track-room-mic')).toBe(collaboratorMuted);
        expect(undoStore.value?.past).toEqual(pastBeforeConflict);
        expect(undoStore.value?.future).toEqual([]);

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-room-mic' ? { ...track, muted: true } : track
            ),
        });
        runtimeMocks.mutes.set('track-room-mic', true);
        await undo();
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(4);

        const collaboratorPan = 7;
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-guitar-left' ? { ...track, pan: collaboratorPan } : track
            ),
        });
        runtimeMocks.pans.set('track-guitar-left', collaboratorPan);
        const futureBeforeConflict = structuredClone(undoStore.value?.future);

        await redo();

        expect(getTrack('track-guitar-left').pan).toBe(collaboratorPan);
        expect(runtimeMocks.pans.get('track-guitar-left')).toBe(collaboratorPan);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toEqual(futureBeforeConflict);

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-guitar-left' ? { ...track, pan: 0 } : track
            ),
        });
        runtimeMocks.pans.set('track-guitar-left', 0);
        await redo();
        expectExactMix();
        expect(undoStore.value?.past).toHaveLength(4);
        expect(undoStore.value?.future).toEqual([]);
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

    it('rejects a stale later pan guard before any earlier runtime effect', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected the proposed mix batch');
        }
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-guitar-left' ? { ...track, pan: 12 } : track
            ),
        });
        runtimeMocks.pans.set('track-guitar-left', 12);

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result).toMatchObject({ status: 'failed' });
        expect(runtimeMocks.setTrackGain).not.toHaveBeenCalled();
        expect(runtimeMocks.setTrackPan).not.toHaveBeenCalled();
        expect(runtimeMocks.setTrackMute).not.toHaveBeenCalled();
        expect(getTrack('track-lead-vocal').gain).toBe(1);
        expect(getTrack('track-guitar-left').pan).toBe(12);
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each(['write', 'touch', 'latch'] as const)(
        'rolls back %s-mode automation buffered by a failed atomic mix batch',
        async (automationMode) => {
            const beforePoints = [
                { beat: 0, value: 0.25, curve: 'linear' as const, tension: 0 },
                { beat: 32, value: 0.4, curve: 'linear' as const, tension: 0 },
            ];
            trackStore.set({
                ...trackStore.value!,
                tracks: trackStore.value!.tracks.map((track) =>
                    track.id === 'track-lead-vocal' ? { ...track, automationMode } : track
                ),
            });
            automationStore.set({
                lanes: [
                    {
                        id: 'lane-lead-vocal-gain',
                        trackId: 'track-lead-vocal',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        points: beforePoints.map((point) => ({ ...point })),
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: 0,
                        maxValue: 1,
                    },
                ],
            });
            transportStore.set({
                ...defaultTransportState,
                isPlaying: true,
                playheadPosition: 4,
                tempo: 120,
            });
            setAutomationRecordingDependencies({
                getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as AudioContext,
                getCompensationDelay: () => 0,
            });
            startAutomationRecording();
            await sendChatMessage(PROMPT);
            const confirmation = getPendingActionConfirmation(getConfirmationId());
            if (!confirmation) {
                throw new Error('Expected the proposed mix batch');
            }
            runtimeMocks.setTrackMute.mockImplementationOnce(() => {
                throw new Error('injected Room Mic runtime failure');
            });

            await confirmPendingChatActions({ confirmationId: confirmation.id });
            stopAutomationRecording();

            expect(automationStore.value?.lanes[0]?.points).toEqual(beforePoints);
            expect(undoStore.value?.past).toEqual([]);
            expect(undoStore.value?.future).toEqual([]);
        }
    );
});
