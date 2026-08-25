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

const PROMPT =
    'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';

const providerPlan = [
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.7 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-left', pan: -20 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-right', pan: 20 } },
    { name: 'muteTrack', arguments: { trackId: 'track-room-mic', muted: true } },
] as const;

type ProviderCall = { name: string; arguments: Record<string, unknown> };

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

const notificationEventBus = {
    emit: vi.fn(() => Promise.resolve()),
    on: vi.fn(() => () => undefined),
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getProviderSection(userMessage: string, section: string): Record<string, unknown> {
    const match = new RegExp(String.raw`^${section}:\n(?<payload>.+)$`, 'mu').exec(userMessage);
    const payload = match?.groups?.payload;
    if (!payload) {
        throw new TypeError(`Expected ${section} in provider request`);
    }
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed)) {
        throw new TypeError(`Expected object-shaped ${section}`);
    }
    return parsed;
}

function asCommandBatchProposal(plan: readonly ProviderCall[]): ProviderCall[] {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                commands: plan.map((call) => ({ name: call.name, arguments: call.arguments })),
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Apply the exact requested mix changes while preserving the Drum Bus.',
                    constraints: ['Leave the Drum Bus unchanged.'],
                    scope: {
                        targetIds: [
                            ...new Set(
                                plan.flatMap((call) =>
                                    typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : []
                                )
                            ),
                        ],
                        targetRanges: [],
                        protectedTargetIds: ['track-drum-bus'],
                        protectedRanges: [],
                    },
                    capabilityIds: [...new Set(plan.map((call) => call.name))],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate exact track identities, values, and protected Drum Bus state.'],
                    stoppingConditions: ['Stop if any target or protected-state precondition fails.'],
                },
            },
        },
    ];
}

function getApplicationToolReceipts(userMessage: string): unknown[] {
    const evidence = getProviderSection(userMessage, 'relevant_evidence');
    if (!Array.isArray(evidence.receipts)) {
        throw new TypeError('Expected serialized application tool receipts in provider request');
    }
    const receiptSummary = evidence.receipts.find(
        (receipt) =>
            isRecord(receipt) &&
            receipt.id === 'application-tool-loop' &&
            isRecord(receipt.summary) &&
            receipt.summary.truncated === false &&
            typeof receipt.summary.value === 'string'
    );
    if (!isRecord(receiptSummary) || !isRecord(receiptSummary.summary)) {
        throw new TypeError('Expected application tool receipt context in provider request');
    }
    const lines = String(receiptSummary.summary.value).split('\n');
    const parsed: unknown = JSON.parse(lines.at(-1) ?? '');
    if (!isRecord(parsed) || !Array.isArray(parsed.receipts)) {
        throw new TypeError('Expected serialized application tool receipt list');
    }
    return parsed.receipts;
}

function assertDiscoveredCommandSchemas(userMessage: string, names: readonly string[]): void {
    const discovery = getApplicationToolReceipts(userMessage).find(
        (receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover'
    );
    if (
        !isRecord(discovery) ||
        discovery.status !== 'success' ||
        discovery.turn !== 1 ||
        !isRecord(discovery.data) ||
        discovery.data.schema !== 'sourdaw.agent-tool-catalog' ||
        discovery.data.schemaVersion !== 1 ||
        discovery.data.category !== 'command' ||
        discovery.data.truncated !== false ||
        !Array.isArray(discovery.data.items)
    ) {
        throw new TypeError('Expected a successful complete command catalog discovery receipt');
    }
    const disclosedNames = new Set(
        discovery.data.items.flatMap((item) =>
            isRecord(item) && isRecord(item.function) && typeof item.function.name === 'string'
                ? [item.function.name]
                : []
        )
    );
    for (const name of names) {
        if (!disclosedNames.has(name)) {
            throw new TypeError(`Expected disclosed command schema for ${name}`);
        }
    }
}

function toolCallsResponse(calls: readonly ProviderCall[]): Response {
    return new Response(
        JSON.stringify({
            choices: [
                {
                    finish_reason: 'tool_calls',
                    message: {
                        tool_calls: calls.map((call) => ({
                            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                        })),
                    },
                },
            ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}

function setProviderPlan(plan: readonly ProviderCall[]): void {
    const names = [...new Set(plan.map((call) => call.name))];
    let webLlmTurn = 0;
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) => {
        webLlmTurn += 1;
        if (webLlmTurn > 2) {
            throw new Error('Expected exactly two WebLLM provider turns');
        }
        if (webLlmTurn === 1) {
            return Promise.resolve(
                JSON.stringify([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }])
            );
        }
        assertDiscoveredCommandSchemas(userMessage, names);
        return Promise.resolve(JSON.stringify(asCommandBatchProposal(plan)));
    });
    let hostedTurn = 0;
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        hostedTurn += 1;
        if (hostedTurn > 2) {
            throw new Error('Expected exactly two hosted provider turns');
        }
        if (hostedTurn === 1) {
            return Promise.resolve(
                toolCallsResponse([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }])
            );
        }
        const request: unknown = JSON.parse(init.body);
        const userMessage =
            isRecord(request) && Array.isArray(request.messages)
                ? request.messages.find(
                      (message) => isRecord(message) && message.role === 'user' && typeof message.content === 'string'
                  )
                : undefined;
        if (!isRecord(userMessage) || typeof userMessage.content !== 'string') {
            throw new TypeError('Expected hosted provider user message');
        }
        assertDiscoveredCommandSchemas(userMessage.content, names);
        return Promise.resolve(toolCallsResponse(asCommandBatchProposal(plan)));
    });
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
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        setProviderPlan(providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } })));
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
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
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
        notificationEventBus.emit.mockClear();

        await undo();

        expect(getTrack('track-room-mic').muted).toBe(collaboratorMuted);
        expect(runtimeMocks.mutes.get('track-room-mic')).toBe(collaboratorMuted);
        expect(undoStore.value?.past).toEqual(pastBeforeConflict);
        expect(undoStore.value?.future).toEqual([]);
        expect(notificationEventBus.emit).toHaveBeenCalledWith(
            'ui.notify',
            expect.objectContaining({ level: 'warning' })
        );

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
