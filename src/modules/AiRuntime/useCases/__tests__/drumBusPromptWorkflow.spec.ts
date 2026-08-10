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
import { sidechainStore } from '#/modules/Routing/stores';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { generateWebLlmCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

const PROMPT = 'Create a Drum Bus and route Kick, Snare, and Hats into it, leaving Parallel Compression unchanged.';
const MF01_PROMPT = 'Route every drum track except the parallel-compression return into the Drum Bus.';
const MF06_PROMPT = 'Create a sidechain from the kick to every bass compressor that supports sidechain input.';

const providerPlan = [
    { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-kick', outputId: '$drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-snare', outputId: '$drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-hats', outputId: '$drum-bus' } },
] as const;

const mf01ProviderPlan = [
    { name: 'setTrackOutput', arguments: { trackId: 'track-kick', outputId: 'bus-drums' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-snare', outputId: 'bus-drums' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-hats', outputId: 'bus-drums' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-room', outputId: 'bus-drums' } },
] as const;

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn<(systemPrompt: string, userMessage: string) => Promise<string>>(),
        getAllSidechainRoutes: vi.fn(() => []),
        resolveToasterPadBinding: vi.fn(() => null),
        setTrackOutput: vi.fn(),
        unwireSidechainRoute: vi.fn(),
        wireSidechainRoute: vi.fn(),
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
    setTrackOutput: runtimeMocks.setTrackOutput,
    unwireSidechainRoute: runtimeMocks.unwireSidechainRoute,
    wireSidechainRoute: runtimeMocks.wireSidechainRoute,
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

function createTrack(id: string, name: string, kind: Track['kind'] = 'audio'): Track {
    return {
        id,
        name,
        kind,
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

function setMf01Project(overrides: Partial<Record<string, (track: Track) => Track>> = {}): void {
    const tracks = [
        createTrack('track-kick', 'Kick'),
        createTrack('track-snare', 'Snare'),
        createTrack('track-hats', 'Hats'),
        createTrack('track-room', 'Drum Room'),
        createTrack('track-parallel', 'Parallel Compression Return'),
        createTrack('track-bass', 'Bass DI'),
        createTrack('bus-drums', 'Drum Bus', 'bus'),
    ].map((track) => overrides[track.id]?.(track) ?? track);
    trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
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

function getHostedUserMessage(requestBody: string): string {
    const request: unknown = JSON.parse(requestBody);
    if (!isRecord(request) || !Array.isArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    for (const message of request.messages) {
        if (isRecord(message) && message.role === 'user' && typeof message.content === 'string') {
            return message.content;
        }
    }
    throw new TypeError('Expected one hosted provider user message');
}

function createMf01ProviderPlanFromUserMessage(userMessage: string) {
    const match = /<project_context>\n(?<contextJson>.+)\n<\/project_context>/u.exec(userMessage);
    const contextJson = match?.groups?.contextJson;
    if (!contextJson) {
        throw new TypeError('Expected serialized project context in provider request');
    }
    const context: unknown = JSON.parse(contextJson);
    if (!isRecord(context)) {
        throw new TypeError('Expected object-shaped project context');
    }
    const capability = context.drumRoutingCapability;
    if (!isRecord(capability) || capability.actionType !== 'setTrackOutput') {
        throw new TypeError('Expected app-owned MF-01 capability');
    }
    if (typeof context.projectRevision !== 'string' || capability.baseRevision !== context.projectRevision) {
        throw new TypeError('Expected revision-bound MF-01 capability');
    }
    const allowedAction = capability.allowedAction;
    const bus = capability.bus;
    const candidateDrums = capability.candidateDrums;
    if (
        !isRecord(allowedAction) ||
        allowedAction.type !== 'setTrackOutput' ||
        !isRecord(bus) ||
        typeof bus.id !== 'string' ||
        !Array.isArray(candidateDrums) ||
        !Array.isArray(allowedAction.exactTargetIds) ||
        !allowedAction.exactTargetIds.every((trackId) => typeof trackId === 'string') ||
        typeof allowedAction.outputId !== 'string'
    ) {
        throw new TypeError('Expected exact MF-01 target and output capability');
    }
    const derivedTargetIds = candidateDrums.flatMap((candidate) => {
        if (
            !isRecord(candidate) ||
            typeof candidate.id !== 'string' ||
            typeof candidate.role !== 'string' ||
            typeof candidate.currentOutputId !== 'string' ||
            typeof candidate.locked !== 'boolean' ||
            typeof candidate.frozen !== 'boolean'
        ) {
            throw new TypeError('Expected role-evidenced MF-01 drum candidates');
        }
        return candidate.currentOutputId === bus.id ? [] : [candidate.id];
    });
    if (
        allowedAction.outputId !== bus.id ||
        JSON.stringify(allowedAction.exactTargetIds) !== JSON.stringify(derivedTargetIds)
    ) {
        throw new TypeError('Expected MF-01 allowed action to match projected drum candidates');
    }
    return derivedTargetIds.map((trackId) => ({
        name: allowedAction.type,
        arguments: { trackId, outputId: allowedAction.outputId },
    }));
}

function useMf01WebLlmFixture(): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
        Promise.resolve(JSON.stringify(createMf01ProviderPlanFromUserMessage(userMessage)))
    );
}

function useMf01HostedFixture({ reverse = false }: { reverse?: boolean } = {}): void {
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const plan = createMf01ProviderPlanFromUserMessage(getHostedUserMessage(init.body));
        if (reverse) {
            plan.reverse();
        }
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

function setMf06Project(): void {
    const kick = createTrack('track-kick', 'Kick');
    const bassSynth = createTrack('track-bass-synth', 'Bass Synth');
    bassSynth.devices = [
        {
            id: 'device-bass-comp-a',
            name: 'Bass Compressor A',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
            parameterValues: {},
        },
        {
            id: 'device-bass-comp-b',
            name: 'Bass Compressor B',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
            parameterValues: {},
        },
        {
            id: 'device-bass-eq',
            name: 'Bass EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: {},
        },
    ];
    const bassDi = createTrack('track-bass-di', 'Bass DI');
    bassDi.devices = [
        {
            id: 'device-bass-di-comp',
            name: 'Bass DI Compressor',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
            parameterValues: {},
        },
    ];
    const guitar = createTrack('track-guitar', 'Guitar');
    guitar.devices = [
        {
            id: 'device-guitar-comp',
            name: 'Guitar Compressor',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
            parameterValues: {},
        },
    ];
    trackStore.set({ tracks: [kick, bassSynth, bassDi, guitar], selectedTrackId: null, ghostClips: [] });
}

function createMf06ProviderPlanFromUserMessage(userMessage: string) {
    const match = /<project_context>\n(?<contextJson>.+)\n<\/project_context>/u.exec(userMessage);
    const contextJson = match?.groups?.contextJson;
    if (!contextJson) {
        throw new TypeError('Expected serialized project context in provider request');
    }
    const context: unknown = JSON.parse(contextJson);
    if (!isRecord(context)) {
        throw new TypeError('Expected object-shaped project context');
    }
    const capability = context.sidechainRoutingCapability;
    if (!isRecord(capability) || capability.actionType !== 'addSidechainRoute') {
        throw new TypeError('Expected app-owned MF-06 capability');
    }
    if (typeof context.projectRevision !== 'string' || capability.baseRevision !== context.projectRevision) {
        throw new TypeError('Expected revision-bound MF-06 capability');
    }
    const allowedAction = capability.allowedAction;
    const targets = capability.targets;
    if (!isRecord(allowedAction) || !Array.isArray(allowedAction.exactRoutes) || !Array.isArray(targets)) {
        throw new TypeError('Expected exact MF-06 route capability');
    }
    const targetDeviceIds = new Set(
        targets.flatMap((target) => (isRecord(target) && typeof target.deviceId === 'string' ? [target.deviceId] : []))
    );
    return allowedAction.exactRoutes.map((route) => {
        if (
            !isRecord(route) ||
            typeof route.sourceTrackId !== 'string' ||
            typeof route.targetTrackId !== 'string' ||
            typeof route.targetDeviceId !== 'string' ||
            !targetDeviceIds.has(route.targetDeviceId)
        ) {
            throw new TypeError('Expected MF-06 routes to match capability-filtered target devices');
        }
        return { name: 'addSidechainRoute', arguments: { ...route } };
    });
}

function useMf06WebLlmFixture(
    transform: (plan: ReturnType<typeof createMf06ProviderPlanFromUserMessage>) => void = () => undefined
): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) => {
        const plan = createMf06ProviderPlanFromUserMessage(userMessage);
        transform(plan);
        return Promise.resolve(JSON.stringify(plan));
    });
}

function useMf06HostedFixture({ reverse = false }: { reverse?: boolean } = {}): void {
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const plan = createMf06ProviderPlanFromUserMessage(getHostedUserMessage(init.body));
        if (reverse) {
            plan.reverse();
        }
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

describe('drum bus prompt workflow', () => {
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
        resetCrdtProjectAuthority('drum bus prompt workflow test');
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
        sidechainStore.set({ routes: [] });
        const tracks = [
            createTrack('track-kick', 'Kick'),
            createTrack('track-snare', 'Snare'),
            createTrack('track-hats', 'Hats'),
            createTrack('track-parallel', 'Parallel Compression'),
            createTrack('track-room', 'Drum Room'),
        ];
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
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
        sidechainStore.set({ routes: [] });
        configureAutomergeStoragePort(null);
        cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds, confirms, commits, receipts, undoes, and redoes the exact protected routing request', async () => {
        const unchangedBefore = structuredClone([getTrack('track-parallel'), getTrack('track-room')]);

        await sendChatMessage(PROMPT);

        const providerRequest = vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[1];
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('track-kick');
        expect(providerRequest).toContain('track-snare');
        expect(providerRequest).toContain('track-hats');
        expect(providerRequest).toContain('Parallel Compression');

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(confirmation?.actions).toHaveLength(4);
        const busAction = confirmation?.actions[0];
        if (busAction?.type !== 'createBus' || !busAction.payload.busId) {
            throw new Error('Expected one app-owned Drum Bus identity');
        }
        const busId = busAction.payload.busId;
        expect(busId).toMatch(/^bus-ai-/u);
        expect(confirmation?.actions).toEqual([
            { type: 'createBus', payload: { name: 'Drum Bus', busId } },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-kick', outputId: busId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-snare', outputId: busId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-hats', outputId: busId, expectedOutputId: 'master' },
            },
        ]);
        expect(confirmation).toMatchObject({
            risk: { level: 'authority-sensitive' },
            protectedUnchanged: [{ id: 'track-parallel', name: 'Parallel Compression' }],
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(`Create bus "Drum Bus" (${busId})`);
        expect(proposal?.content).toContain(`Route "Kick" (track-kick) from master to "Drum Bus" (${busId})`);
        expect(proposal?.content).toContain('Risk: authority-sensitive');
        expect(proposal?.content).toContain('Protected unchanged: "Parallel Compression" (track-parallel)');

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain(`Route "Kick" (track-kick) from master to "Drum Bus" (${busId})`);
        expect(receipt?.content).toContain(`Route "Snare" (track-snare) from master to "Drum Bus" (${busId})`);
        expect(receipt?.content).toContain(`Route "Hats" (track-hats) from master to "Drum Bus" (${busId})`);
        expect(receipt?.content).toContain(`Affected IDs: ${busId}, track-kick`);
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Protected unchanged: "Parallel Compression" (track-parallel)');

        expect(getTrack('track-kick').outputId).toBe(busId);
        expect(getTrack('track-snare').outputId).toBe(busId);
        expect(getTrack('track-hats').outputId).toBe(busId);
        expect([getTrack('track-parallel'), getTrack('track-room')]).toEqual(unchangedBefore);
        expect(getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions).toEqual([
            expect.objectContaining({ actionType: 'createBus', affectedIds: [busId], outcome: 'committed' }),
            expect.objectContaining({
                actionType: 'setTrackOutput',
                affectedIds: [busId, 'track-kick'],
                outcome: 'committed',
            }),
            expect.objectContaining({
                actionType: 'setTrackOutput',
                affectedIds: [busId, 'track-snare'],
                outcome: 'committed',
            }),
            expect.objectContaining({
                actionType: 'setTrackOutput',
                affectedIds: [busId, 'track-hats'],
                outcome: 'committed',
            }),
        ]);
        expect(undoStore.value?.past).toHaveLength(4);

        await undo();

        expect(trackStore.value?.tracks.some((track) => track.id === busId)).toBe(false);
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
        ]);
        expect([getTrack('track-parallel'), getTrack('track-room')]).toEqual(unchangedBefore);

        await redo();

        expect(trackStore.value?.tracks.filter((track) => track.id === busId)).toHaveLength(1);
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            busId,
            busId,
            busId,
        ]);
        expect([getTrack('track-parallel'), getTrack('track-room')]).toEqual(unchangedBefore);
    });

    it('grounds the hosted-provider fixture to the same actions and terminal receipt', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        const providerRequest = getHostedRequestBody();
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('track-kick');
        expect(providerRequest).toContain('track-snare');
        expect(providerRequest).toContain('track-hats');
        expect(providerRequest).toContain('Parallel Compression');
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        const busAction = confirmation?.actions[0];
        if (busAction?.type !== 'createBus' || !busAction.payload.busId) {
            throw new Error('Expected one app-owned hosted-provider Drum Bus identity');
        }
        const busId = busAction.payload.busId;
        expect(confirmation?.actions).toEqual([
            { type: 'createBus', payload: { name: 'Drum Bus', busId } },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-kick', outputId: busId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-snare', outputId: busId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-hats', outputId: busId, expectedOutputId: 'master' },
            },
        ]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain(`Route "Kick" (track-kick) from master to "Drum Bus" (${busId})`);
        expect(receipt?.content).toContain(`Affected IDs: ${busId}, track-kick`);
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Protected unchanged: "Parallel Compression" (track-parallel)');
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            busId,
            busId,
            busId,
        ]);
    });

    it('grounds the complete dynamic drum scope into an existing Drum Bus for MF-01', async () => {
        setMf01Project();
        useMf01WebLlmFixture();
        const unchangedBefore = structuredClone([getTrack('track-parallel'), getTrack('track-bass')]);

        await sendChatMessage(MF01_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(confirmation?.actions).toEqual([
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-kick', outputId: 'bus-drums', expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-snare', outputId: 'bus-drums', expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-hats', outputId: 'bus-drums', expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-room', outputId: 'bus-drums', expectedOutputId: 'master' },
            },
        ]);
        expect(confirmation?.protectedUnchanged).toEqual([
            { id: 'track-parallel', name: 'Parallel Compression Return' },
        ]);
        expect(confirmation?.risk).toMatchObject({ level: 'authority-sensitive' });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain('Route "Kick" (track-kick) from master to "Drum Bus" (bus-drums)');
        expect(proposal?.content).toContain('Route "Drum Room" (track-room) from master to "Drum Bus" (bus-drums)');
        expect(proposal?.content).toContain('Protected unchanged: "Parallel Compression Return" (track-parallel)');

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(['track-kick', 'track-snare', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'bus-drums',
            'bus-drums',
            'bus-drums',
            'bus-drums',
        ]);
        expect([getTrack('track-parallel'), getTrack('track-bass')]).toEqual(unchangedBefore);
        expect(runtimeMocks.setTrackOutput).toHaveBeenCalledTimes(4);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Route "Snare" (track-snare) from master to "Drum Bus" (bus-drums)');
        expect(receipt?.content).toContain('Route "Hats" (track-hats) from master to "Drum Bus" (bus-drums)');
        expect(receipt?.content).toContain('Affected IDs: bus-drums, track-kick');
        expect(receipt?.content).toContain('Affected IDs: bus-drums, track-snare');
        expect(receipt?.content).toContain('Affected IDs: bus-drums, track-hats');
        expect(receipt?.content).toContain('Affected IDs: bus-drums, track-room');
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Protected unchanged: "Parallel Compression Return" (track-parallel)');
        expect(getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions).toHaveLength(4);
        expect(undoStore.value?.past).toHaveLength(4);

        await undo();
        expect(['track-kick', 'track-snare', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
            'master',
        ]);
        expect([getTrack('track-parallel'), getTrack('track-bass')]).toEqual(unchangedBefore);

        await redo();
        expect(['track-kick', 'track-snare', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'bus-drums',
            'bus-drums',
            'bus-drums',
            'bus-drums',
        ]);
        expect([getTrack('track-parallel'), getTrack('track-bass')]).toEqual(unchangedBefore);
    });

    it('projects standard Bass Drum, BD, and OH roles without routing bass instruments or arbitrary name matches', async () => {
        trackStore.set({
            tracks: [
                createTrack('track-bass-drum', 'Bass Drum'),
                createTrack('track-bd', 'BD'),
                createTrack('track-oh', 'OH'),
                createTrack('track-bass', 'Bass DI'),
                createTrack('track-hat-trick', 'Hat Trick'),
                createTrack('track-parallel', 'Parallel Compression Return'),
                createTrack('bus-drums', 'Drum Bus', 'bus'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        useMf01WebLlmFixture();

        await sendChatMessage(MF01_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(
            confirmation?.actions.flatMap((action) =>
                action.type === 'setTrackOutput' ? [action.payload.trackId] : []
            )
        ).toEqual(['track-bass-drum', 'track-bd', 'track-oh']);
        expect(confirmation?.affectedIds).not.toContain('track-bass');
        expect(confirmation?.affectedIds).not.toContain('track-hat-trick');
    });

    it('fails closed when an editable audio track has no application-owned role evidence', async () => {
        setMf01Project({ 'track-room': (track) => ({ ...track, name: 'Audio 1' }) });
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(mf01ProviderPlan.slice(0, 3)));

        await sendChatMessage(MF01_PROMPT);

        expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId)).toBe(false);
        expect(chatStore.value?.messages.at(-1)?.content).toContain('MF-01 track role is ambiguous: track-room');
    });

    it.each(['webllm', 'cloud'] as const)(
        'sends %s the revision-bound app-owned MF-01 capability scope',
        async (backend) => {
            setMf01Project();
            runtimeMocks.backend.value = backend;
            if (backend === 'webllm') {
                useMf01WebLlmFixture();
            } else {
                useMf01HostedFixture();
            }

            await sendChatMessage(MF01_PROMPT);

            const providerMessage =
                backend === 'webllm'
                    ? runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1]
                    : getHostedUserMessage(getHostedRequestBody());
            expect(providerMessage).toContain('"drumRoutingCapability"');
            expect(providerMessage).toContain('"projectRevision"');
            expect(providerMessage).toContain('"baseRevision"');
            expect(providerMessage).toContain('"bus":{"id":"bus-drums","name":"Drum Bus"');
            expect(providerMessage).toContain(
                '"candidateDrums":[{"id":"track-kick","name":"Kick","kind":"audio","role":"kick","roleEvidence":"canonical-name:kick","currentOutputId":"master","frozen":false,"locked":false}'
            );
            expect(providerMessage).toContain('"protectedReturn":{"id":"track-parallel"');
            expect(providerMessage).toContain(
                '"protectedNonDrums":[{"id":"track-bass","name":"Bass DI","kind":"audio","role":"bass-instrument"'
            );
            expect(providerMessage).toContain('"actionType":"setTrackOutput"');
            expect(providerMessage).toContain(
                '"exactTargetIds":["track-kick","track-snare","track-hats","track-room"]'
            );
        }
    );

    it('normalizes a reordered hosted MF-01 plan to the same exact action order and receipt', async () => {
        setMf01Project();
        runtimeMocks.backend.value = 'cloud';
        useMf01HostedFixture({ reverse: true });

        await sendChatMessage(MF01_PROMPT);

        expect(getHostedRequestBody()).toContain(MF01_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(
            confirmation?.actions.map((action) => action.type === 'setTrackOutput' && action.payload.trackId)
        ).toEqual(['track-kick', 'track-snare', 'track-hats', 'track-room']);
        expect(confirmation?.protectedUnchanged).toEqual([
            { id: 'track-parallel', name: 'Parallel Compression Return' },
        ]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });
        expect(['track-kick', 'track-snare', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'bus-drums',
            'bus-drums',
            'bus-drums',
            'bus-drums',
        ]);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Protected unchanged: "Parallel Compression Return" (track-parallel)');
    });

    it.each([
        ['omission', mf01ProviderPlan.slice(0, 3)],
        [
            'enlargement',
            [
                ...mf01ProviderPlan,
                { name: 'setTrackOutput', arguments: { trackId: 'track-parallel', outputId: 'bus-drums' } },
            ],
        ],
        ['duplicate', [...mf01ProviderPlan.slice(0, 3), mf01ProviderPlan[0]]],
    ])('rejects MF-01 provider %s without project, runtime, receipt, or history residue', async (_label, plan) => {
        setMf01Project();
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(plan));
        const before = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(MF01_PROMPT);

        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(trackStore.value?.tracks).toEqual(before);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each(['missing-bus', 'duplicate-bus', 'ambiguous-role', 'frozen-target', 'locked-target'] as const)(
        'rejects an MF-01 %s scope before confirmation or mutation',
        async (scenario) => {
            setMf01Project({
                ...(scenario === 'ambiguous-role'
                    ? { 'track-room': (track) => ({ ...track, name: 'Drum Bass Room' }) }
                    : {}),
                ...(scenario === 'frozen-target' ? { 'track-snare': (track) => ({ ...track, frozen: true }) } : {}),
                ...(scenario === 'locked-target'
                    ? {
                          'track-hats': (track) => ({
                              ...track,
                              clips: [
                                  {
                                      id: 'clip-hats',
                                      trackId: track.id,
                                      name: 'Hats clip',
                                      startBeat: 0,
                                      endBeat: 4,
                                      type: 'audio',
                                      fadeInBeats: 0,
                                      fadeOutBeats: 0,
                                      gain: 1,
                                      color: '#ffffff',
                                      locked: true,
                                      muted: false,
                                  },
                              ],
                          }),
                      }
                    : {}),
            });
            if (scenario === 'missing-bus') {
                trackStore.set({
                    ...trackStore.value!,
                    tracks: trackStore.value!.tracks.filter((track) => track.id !== 'bus-drums'),
                });
            }
            if (scenario === 'duplicate-bus') {
                trackStore.set({
                    ...trackStore.value!,
                    tracks: [...trackStore.value!.tracks, createTrack('bus-drums-2', 'Drum Bus', 'bus')],
                });
            }
            runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(mf01ProviderPlan));
            const before = structuredClone(trackStore.value?.tracks);

            await sendChatMessage(MF01_PROMPT);

            expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
            expect(trackStore.value?.tracks).toEqual(before);
            expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
            expect(undoStore.value?.past).toEqual([]);
        }
    );

    it('rejects MF-01 post-proposal enlargement against the immutable protected return snapshot', async () => {
        setMf01Project();
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(mf01ProviderPlan));
        await sendChatMessage(MF01_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        const state = pendingActionConfirmationStore.value;
        if (!confirmation || !state) {
            throw new Error('Expected MF-01 confirmation');
        }
        const replacement = confirmation.actions.map((action, index) =>
            index === 0 && action.type === 'setTrackOutput'
                ? { ...action, payload: { ...action.payload, trackId: 'track-parallel' } }
                : action
        );
        pendingActionConfirmationStore.set({
            confirmations: state.confirmations.map((candidate) =>
                candidate.id === confirmation.id ? { ...candidate, actions: replacement } : candidate
            ),
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result).toEqual({
            status: 'failed',
            reason: 'The executable action batch targets protected IDs: track-parallel.',
        });
        expect(
            ['track-kick', 'track-snare', 'track-hats', 'track-room', 'track-parallel'].map(
                (id) => getTrack(id).outputId
            )
        ).toEqual(['master', 'master', 'master', 'master', 'master']);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('aborts the whole MF-01 group before runtime when a later route guard conflicts', async () => {
        setMf01Project();
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(mf01ProviderPlan));
        await sendChatMessage(MF01_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error('Expected MF-01 confirmation');
        }
        const conflictingActions = confirmation.actions.map((action) =>
            action.type === 'setTrackOutput' && action.payload.trackId === 'track-room'
                ? { ...action, payload: { ...action.payload, expectedOutputId: 'other-output' } }
                : action
        );
        clearPendingActionConfirmations();
        proposePendingActionConfirmation({
            id: confirmation.id,
            prompt: confirmation.prompt,
            assistantMessageId: confirmation.assistantMessageId,
            actions: conflictingActions,
            actionLabels: confirmation.actionLabels,
            affectedIds: confirmation.affectedIds,
            protectedUnchanged: confirmation.protectedUnchanged,
            risk: confirmation.risk ?? undefined,
            executionMode: confirmation.executionMode,
            projectRevision: confirmation.projectRevision,
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).toBe('failed');
        expect(['track-kick', 'track-snare', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
            'master',
        ]);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reconciles a transient MF-01 runtime failure to the committed whole-group route', async () => {
        setMf01Project();
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(mf01ProviderPlan));
        runtimeMocks.setTrackOutput
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('injected Snare route runtime failure');
            })
            .mockImplementation(() => undefined);
        await sendChatMessage(MF01_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'executed' });
        expect(['track-kick', 'track-snare', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'bus-drums',
            'bus-drums',
            'bus-drums',
            'bus-drums',
        ]);
        expect(
            runtimeMocks.setTrackOutput.mock.calls.filter(
                ([trackId, outputId]) => trackId === 'track-snare' && outputId === 'bus-drums'
            )
        ).toHaveLength(2);
        expect(getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions).toHaveLength(4);
        expect(undoStore.value?.past).toHaveLength(4);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(terminalMessage?.content).toContain('Outcome: committed');
    });

    it('preserves a collaborator route and keeps the whole MF-01 group retryable on undo conflict', async () => {
        setMf01Project();
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(mf01ProviderPlan));
        await sendChatMessage(MF01_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-snare' ? { ...track, outputId: 'collaborator-bus' } : track
            ),
        });
        runtimeMocks.setTrackOutput.mockClear();

        await undo();

        expect(getTrack('track-snare').outputId).toBe('collaborator-bus');
        expect(['track-kick', 'track-hats', 'track-room'].map((id) => getTrack(id).outputId)).toEqual([
            'bus-drums',
            'bus-drums',
            'bus-drums',
        ]);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(4);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('rejects provider enlargement that would route the protected Parallel Compression track', async () => {
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(
            JSON.stringify([
                ...providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } })),
                {
                    name: 'setTrackOutput',
                    arguments: { trackId: 'track-parallel', outputId: '$drum-bus' },
                },
            ])
        );
        const before = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(PROMPT);

        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(trackStore.value?.tracks).toEqual(before);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects a post-proposal batch replacement that targets the protected track', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        const busAction = confirmation?.actions[0];
        const state = pendingActionConfirmationStore.value;
        if (!confirmation || busAction?.type !== 'createBus' || !busAction.payload.busId || !state) {
            throw new Error('Expected the proposed Drum Bus batch');
        }
        const revision = captureProjectRevision();
        const replacedActions = confirmation.actions.map((action) => {
            if (action.type !== 'setTrackOutput' || action.payload.trackId !== 'track-kick') {
                return action;
            }
            return { ...action, payload: { ...action.payload, trackId: 'track-parallel' } };
        });
        pendingActionConfirmationStore.set({
            confirmations: state.confirmations.map((candidate) =>
                candidate.id === confirmation.id ? { ...candidate, actions: replacedActions } : candidate
            ),
        });
        expect(captureProjectRevision()).toBe(revision);

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result).toEqual({
            status: 'failed',
            reason: 'The executable action batch targets protected IDs: track-parallel.',
        });
        expect(trackStore.value?.tracks.some((track) => track.id === busAction.payload.busId)).toBe(false);
        expect(
            ['track-kick', 'track-snare', 'track-hats', 'track-parallel'].map((id) => getTrack(id).outputId)
        ).toEqual(['master', 'master', 'master', 'master']);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(terminalMessage?.content).not.toContain('Affected IDs:');
        expect(terminalMessage?.content).not.toContain('Protected unchanged:');
    });

    it('aborts the whole batch before runtime, receipt, or undo publication when a later route conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        const busAction = confirmation?.actions[0];
        if (!confirmation || busAction?.type !== 'createBus' || !busAction.payload.busId) {
            throw new Error('Expected the proposed Drum Bus batch');
        }
        const conflictingActions = confirmation.actions.map((action) => {
            if (action.type !== 'setTrackOutput' || action.payload.trackId !== 'track-hats') {
                return action;
            }
            return { ...action, payload: { ...action.payload, expectedOutputId: 'other-output' } };
        });
        clearPendingActionConfirmations();
        proposePendingActionConfirmation({
            id: confirmation.id,
            prompt: confirmation.prompt,
            assistantMessageId: confirmation.assistantMessageId,
            actions: conflictingActions,
            actionLabels: confirmation.actionLabels,
            affectedIds: confirmation.affectedIds,
            protectedUnchanged: confirmation.protectedUnchanged,
            risk: confirmation.risk ?? undefined,
            executionMode: confirmation.executionMode,
            projectRevision: confirmation.projectRevision,
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).toBe('failed');
        expect(trackStore.value?.tracks.some((track) => track.id === busAction.payload.busId)).toBe(false);
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
        ]);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('grounds the exact complete per-device MF-06 sidechain plan before confirmation', async () => {
        setMf06Project();
        useMf06WebLlmFixture();

        await sendChatMessage(MF06_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(confirmation?.actions).toEqual([
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass-synth',
                    targetDeviceId: 'device-bass-comp-a',
                },
            },
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass-synth',
                    targetDeviceId: 'device-bass-comp-b',
                },
            },
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass-di',
                    targetDeviceId: 'device-bass-di-comp',
                },
            },
        ]);
        expect(confirmation?.affectedIds).not.toContain('device-guitar-comp');
        expect(confirmation?.affectedIds).not.toContain('device-bass-eq');
        expect(confirmation?.affectedIds).toEqual([
            'track-bass-synth',
            'track-kick',
            'device-bass-comp-a',
            'device-bass-comp-b',
            'track-bass-di',
            'device-bass-di-comp',
        ]);
        expect(confirmation?.protectedUnchanged).toEqual([
            { id: 'device-bass-eq', name: 'Bass Synth Bass EQ' },
            { id: 'track-guitar', name: 'Guitar' },
        ]);
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(
            '"Kick" (track-kick) → "Bass Synth" (track-bass-synth) device "Bass Compressor A" (device-bass-comp-a, builtin-sidechain-compressor)'
        );
        expect(proposal?.content).toContain('Risk: authority-sensitive');

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });
        expect(sidechainStore.value?.routes).toEqual([
            expect.objectContaining({
                sourceTrackId: 'track-kick',
                targetTrackId: 'track-bass-synth',
                targetDeviceId: 'device-bass-comp-a',
                targetParameterId: 'threshold',
                gain: 1,
            }),
            expect.objectContaining({
                sourceTrackId: 'track-kick',
                targetTrackId: 'track-bass-synth',
                targetDeviceId: 'device-bass-comp-b',
                targetParameterId: 'threshold',
                gain: 1,
            }),
            expect.objectContaining({
                sourceTrackId: 'track-kick',
                targetTrackId: 'track-bass-di',
                targetDeviceId: 'device-bass-di-comp',
                targetParameterId: 'threshold',
                gain: 1,
            }),
        ]);
        expect(runtimeMocks.wireSidechainRoute.mock.calls).toEqual([
            ['track-kick', 'track-bass-synth', 'device-bass-comp-a'],
            ['track-kick', 'track-bass-synth', 'device-bass-comp-b'],
            ['track-kick', 'track-bass-di', 'device-bass-di-comp'],
        ]);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Affected IDs: track-bass-synth, track-kick, device-bass-comp-a');
        expect(undoStore.value?.past).toHaveLength(3);

        await undo();
        expect(sidechainStore.value?.routes).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(3);

        await redo();
        expect(sidechainStore.value?.routes).toHaveLength(3);
        expect(undoStore.value?.past).toHaveLength(3);
    });

    it('normalizes a reversed hosted MF-06 plan to the app-owned WebLLM action order', async () => {
        setMf06Project();
        runtimeMocks.backend.value = 'cloud';
        useMf06HostedFixture({ reverse: true });

        await sendChatMessage(MF06_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(getHostedUserMessage(getHostedRequestBody())).toContain('"sidechainRoutingCapability"');
        expect(
            confirmation?.actions.flatMap((action) =>
                action.type === 'addSidechainRoute' ? [action.payload.targetDeviceId] : []
            )
        ).toEqual(['device-bass-comp-a', 'device-bass-comp-b', 'device-bass-di-comp']);
    });

    it.each(['omission', 'duplicate', 'enlargement'] as const)(
        'rejects MF-06 provider %s without project, runtime, receipt, or history residue',
        async (scenario) => {
            setMf06Project();
            useMf06WebLlmFixture((plan) => {
                if (scenario === 'omission') {
                    plan.pop();
                } else if (scenario === 'duplicate') {
                    plan[2] = plan[0]!;
                } else {
                    plan.push({
                        name: 'addSidechainRoute',
                        arguments: {
                            sourceTrackId: 'track-kick',
                            targetTrackId: 'track-guitar',
                            targetDeviceId: 'device-guitar-comp',
                        },
                    });
                }
            });

            await sendChatMessage(MF06_PROMPT);

            expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
            expect(sidechainStore.value?.routes).toEqual([]);
            expect(runtimeMocks.wireSidechainRoute).not.toHaveBeenCalled();
            expect(undoStore.value?.past).toEqual([]);
        }
    );

    it.each(['ambiguous-kick', 'ambiguous-bass'] as const)(
        'fails closed for an MF-06 %s role before confirmation',
        async (scenario) => {
            setMf06Project();
            const extra =
                scenario === 'ambiguous-kick'
                    ? createTrack('track-kick-two', 'BD')
                    : createTrack('track-bass-room', 'Bass Room');
            trackStore.set({ ...trackStore.value!, tracks: [...trackStore.value!.tracks, extra] });
            runtimeMocks.generateWebLlmCompletion.mockResolvedValue('[]');

            await sendChatMessage(MF06_PROMPT);

            expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
            expect(sidechainStore.value?.routes).toEqual([]);
        }
    );

    it('excludes frozen and locked bass tracks and exposes them as protected', async () => {
        setMf06Project();
        const bassDi = getTrack('track-bass-di');
        const bassSynth = getTrack('track-bass-synth');
        const bassGuitar = createTrack('track-bass-guitar', 'Bass Guitar');
        bassGuitar.devices = [
            {
                id: 'device-bass-guitar-comp',
                name: 'Bass Guitar Compressor',
                type: 'builtin-sidechain-compressor',
                bypassed: false,
                parameterValues: {},
            },
        ];
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                ...trackStore.value!.tracks.map((track) => {
                    if (track.id === bassDi.id) {
                        return { ...track, frozen: true };
                    }
                    if (track.id === bassSynth.id) {
                        return {
                            ...track,
                            clips: [
                                {
                                    id: 'clip-bass',
                                    trackId: track.id,
                                    name: 'Bass clip',
                                    startBeat: 0,
                                    endBeat: 4,
                                    type: 'audio' as const,
                                    fadeInBeats: 0,
                                    fadeOutBeats: 0,
                                    gain: 1,
                                    color: '#ffffff',
                                    locked: true,
                                    muted: false,
                                },
                            ],
                        };
                    }
                    return track;
                }),
                bassGuitar,
            ],
        });
        useMf06WebLlmFixture();

        await sendChatMessage(MF06_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(confirmation?.actions).toEqual([
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass-guitar',
                    targetDeviceId: 'device-bass-guitar-comp',
                },
            },
        ]);
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'track-bass-synth', name: 'Bass Synth' },
                { id: 'track-bass-di', name: 'Bass DI' },
            ])
        );
    });

    it('excludes an already-satisfied exact device route while planning every remaining target', async () => {
        setMf06Project();
        sidechainStore.set({
            routes: [
                {
                    id: 'route-existing',
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass-synth',
                    targetDeviceId: 'device-bass-comp-a',
                    targetParameterId: 'threshold',
                    gain: 1,
                },
            ],
        });
        useMf06WebLlmFixture();

        await sendChatMessage(MF06_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(
            confirmation?.actions.flatMap((action) =>
                action.type === 'addSidechainRoute' ? [action.payload.targetDeviceId] : []
            )
        ).toEqual(['device-bass-comp-b', 'device-bass-di-comp']);
        expect(confirmation?.protectedUnchanged).toContainEqual({
            id: 'device-bass-comp-a',
            name: 'Bass Synth Bass Compressor A',
        });
    });

    it('aborts the whole MF-06 batch before runtime when one device route becomes stale', async () => {
        setMf06Project();
        useMf06WebLlmFixture();
        await sendChatMessage(MF06_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        const collaboratorRoute = {
            id: 'route-collaborator',
            sourceTrackId: 'track-kick',
            targetTrackId: 'track-bass-synth',
            targetDeviceId: 'device-bass-comp-b',
            targetParameterId: 'threshold',
            gain: 0.5,
        };
        sidechainStore.set({ routes: [collaboratorRoute] });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(sidechainStore.value?.routes).toEqual([collaboratorRoute]);
        expect(runtimeMocks.wireSidechainRoute).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reconciles a transient MF-06 runtime failure from committed durable routes', async () => {
        setMf06Project();
        useMf06WebLlmFixture();
        runtimeMocks.wireSidechainRoute
            .mockImplementationOnce(() => {
                throw new Error('injected sidechain wire failure');
            })
            .mockImplementation(() => undefined);
        await sendChatMessage(MF06_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'executed' });
        expect(sidechainStore.value?.routes).toHaveLength(3);
        expect(
            runtimeMocks.wireSidechainRoute.mock.calls.filter(
                ([sourceTrackId, _targetTrackId, targetDeviceId]) =>
                    sourceTrackId === 'track-kick' && targetDeviceId === 'device-bass-comp-a'
            )
        ).toHaveLength(2);
        expect(undoStore.value?.past).toHaveLength(3);
    });

    it('preserves collaborator-modified sidechain truth and keeps grouped undo retryable', async () => {
        setMf06Project();
        useMf06WebLlmFixture();
        await sendChatMessage(MF06_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        const routes = sidechainStore.value?.routes ?? [];
        const collaboratorRoutes = routes.map((route, index) => (index === 1 ? { ...route, gain: 0.5 } : route));
        sidechainStore.set({ routes: collaboratorRoutes });
        runtimeMocks.unwireSidechainRoute.mockClear();

        await undo();

        expect(sidechainStore.value?.routes).toEqual(collaboratorRoutes);
        expect(runtimeMocks.unwireSidechainRoute).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(3);
        expect(undoStore.value?.future).toEqual([]);
    });
});
