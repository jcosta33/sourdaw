import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    projectTrackToLiveStrip,
    runtimeGraphTopology,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import * as audioEngineUseCases from '#/modules/AudioEngine/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
    matchesRuntimeDeviceChainTopology,
    removeTrackStrip,
} from '#/modules/AudioEngine/useCases';
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
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage as sendChatMessageUseCase } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const PROMPT = 'Insert a compressor after EQ on every bass track, excluding frozen tracks.';
const BASS_DI_DEVICE_IDS = ['device-bass-di-eq', 'device-bass-di-saturator'];
const BASS_AMP_DEVICE_IDS = ['device-bass-amp-preamp', 'device-bass-amp-eq', 'device-bass-amp-chorus'];
const BASS_DI_INSERTED_DEVICE_IDS = [
    'device-bass-di-eq',
    'device-ai-track-bass-di-builtin-compressor',
    'device-bass-di-saturator',
];
const BASS_AMP_INSERTED_DEVICE_IDS = [
    'device-bass-amp-preamp',
    'device-bass-amp-eq',
    'device-ai-track-bass-amp-builtin-compressor',
    'device-bass-amp-chorus',
];
const BASS_RUNTIME_TRACK_IDS = ['track-bass-di', 'track-bass-amp'] as const;

type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };

const providerPlan: readonly [ProviderPlanCall, ProviderPlanCall] = [
    {
        name: 'addDevice',
        arguments: { trackId: 'track-bass-di', deviceType: 'Compressor', afterDeviceId: 'device-bass-di-eq' },
    },
    {
        name: 'addDevice',
        arguments: { trackId: 'track-bass-amp', deviceType: 'Compressor', afterDeviceId: 'device-bass-amp-eq' },
    },
];

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        resolveToasterPadBinding: vi.fn(() => null),
        transformPlan: {
            value: (plan: ProviderPlanCall[]): ProviderPlanCall[] => plan,
        },
        updateDeviceParam: vi.fn(),
    };
});

const fixtureStorageOwners = vi.hoisted(() => new Map<string, { flushPendingUnscopedWrite(): void }>());

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>();
    return {
        ...original,
        createAutomergeStorage: (...args: Parameters<typeof original.createAutomergeStorage>) => {
            const storage = original.createAutomergeStorage(...args);
            fixtureStorageOwners.set(`${args[0]}:${args[1]}`, storage);
            return storage;
        },
    };
});

vi.hoisted(() => {
    const OriginalAudioContext = globalThis.AudioContext;
    const createAudioParam = (value: number) => ({
        value,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
    });
    const createNode = () => ({
        connect: (destination: unknown) => destination,
        disconnect: () => undefined,
    });
    function AudioContextWithDeviceNodes(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return Object.assign(context, {
            currentTime: 0,
            createStereoPanner: () => ({ ...createNode(), pan: createAudioParam(0) }),
            createBiquadFilter: () => ({
                ...createNode(),
                type: 'lowpass',
                frequency: createAudioParam(350),
                Q: createAudioParam(1),
                gain: createAudioParam(0),
                detune: createAudioParam(0),
            }),
            createDynamicsCompressor: () => ({
                ...createNode(),
                threshold: createAudioParam(-24),
                knee: createAudioParam(30),
                ratio: createAudioParam(12),
                attack: createAudioParam(0.003),
                release: createAudioParam(0.25),
                reduction: 0,
            }),
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        writable: true,
        value: AudioContextWithDeviceNodes,
    });
});

vi.hoisted(() => {
    const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;
    class AudioWorkletNodeWithClosablePort extends OriginalAudioWorkletNode {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
            super(context, name, options);
            if (typeof this.port.close !== 'function') {
                Object.defineProperty(this.port, 'close', { configurable: true, value: () => undefined });
            }
        }
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        writable: true,
        value: AudioWorkletNodeWithClosablePort,
    });
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
    // Device-chain mutations stay on the real runtime-delta path. The fixture
    // projects its stored tracks into live strips before execution so topology,
    // project-revision validation, compensation, and grouped replay are real.
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const applyRuntimeGraphDelta = audioEngineUseCases.applyRuntimeGraphDelta;
type RuntimeGraphDeltaSpy = MockInstance<typeof audioEngineUseCases.applyRuntimeGraphDelta>;

function flushFixtureTrackStore(): void {
    const storage = fixtureStorageOwners.get('root:tracks');
    if (!storage) {
        throw new Error('Expected fixture-owned tracks storage adapter');
    }
    storage.flushPendingUnscopedWrite();
}

function sendChatMessage(prompt: string) {
    flushFixtureTrackStore();
    return sendChatMessageUseCase(prompt);
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

function getProviderProjectTargets(userMessage: string): unknown[] {
    const projectSection = getProviderSection(userMessage, 'untrusted_project_data');
    if (!isRecord(projectSection.data) || !Array.isArray(projectSection.data.selectableTargets)) {
        throw new TypeError('Expected full selectable project targets in provider request');
    }
    return projectSection.data.selectableTargets;
}

function assertBassCompressorProviderContext(userMessage: string): void {
    const revision = getProviderSection(userMessage, 'revision_and_selection').revision;
    const targets = getProviderProjectTargets(userMessage);
    const targetById = new Map<string, Record<string, unknown>>();
    for (const target of targets) {
        if (isRecord(target) && typeof target.id === 'string') {
            targetById.set(target.id, target);
        }
    }
    if (
        typeof revision !== 'string' ||
        targetById.get('track-bass-di')?.frozen !== false ||
        targetById.get('track-bass-amp')?.frozen !== false ||
        targetById.get('track-bass-frozen')?.frozen !== true
    ) {
        throw new TypeError('Expected revision-bound bass compressor project targets');
    }
}

function getApplicationToolReceipts(userMessage: string): unknown[] {
    const evidence = getProviderSection(userMessage, 'relevant_evidence');
    if (!Array.isArray(evidence.receipts)) {
        throw new TypeError('Expected serialized application tool receipts in provider request');
    }
    const receiptSummary = evidence.receipts.find((receipt) => {
        if (!isRecord(receipt) || receipt.id !== 'application-tool-loop' || !isRecord(receipt.summary)) {
            return false;
        }
        return receipt.summary.truncated === false && typeof receipt.summary.value === 'string';
    });
    if (!isRecord(receiptSummary) || !isRecord(receiptSummary.summary)) {
        throw new TypeError('Expected application tool receipt context in provider request');
    }
    const summary = receiptSummary.summary;
    if (summary.truncated !== false || typeof summary.value !== 'string') {
        throw new TypeError('Expected complete application tool receipt context in provider request');
    }
    const lines = summary.value.split('\n');
    const payload = lines[lines.length - 1];
    if (!payload) {
        throw new TypeError('Expected serialized application tool receipt payload');
    }
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed) || !Array.isArray(parsed.receipts)) {
        throw new TypeError('Expected serialized application tool receipt list');
    }
    return parsed.receipts;
}

function getExpectedCatalogCommandNames(finalCalls: readonly ProviderPlanCall[]): string[] {
    const names = finalCalls.flatMap((call) => {
        if (call.name !== 'command.batch.propose') {
            return [];
        }
        const commands = call.arguments.commands;
        return Array.isArray(commands)
            ? commands.flatMap((command) =>
                  isRecord(command) && typeof command.name === 'string' ? [command.name] : []
              )
            : [];
    });
    return [...new Set(names)];
}

function assertDiscoveredCommandSchemas(userMessage: string, finalCalls: readonly ProviderPlanCall[]): void {
    const discoveryReceipt = getApplicationToolReceipts(userMessage).find(
        (receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover'
    );
    if (
        !isRecord(discoveryReceipt) ||
        discoveryReceipt.status !== 'success' ||
        discoveryReceipt.turn !== 1 ||
        !isRecord(discoveryReceipt.data) ||
        discoveryReceipt.data.schema !== 'sourdaw.agent-tool-catalog' ||
        discoveryReceipt.data.schemaVersion !== 1 ||
        discoveryReceipt.data.category !== 'command' ||
        discoveryReceipt.data.truncated !== false ||
        !Array.isArray(discoveryReceipt.data.items)
    ) {
        throw new TypeError('Expected a successful complete command catalog discovery receipt');
    }
    const disclosedNames = new Set<string>();
    for (const item of discoveryReceipt.data.items) {
        if (
            isRecord(item) &&
            isRecord(item.function) &&
            typeof item.function.name === 'string' &&
            isRecord(item.function.parameters)
        ) {
            disclosedNames.add(item.function.name);
        }
    }
    for (const name of getExpectedCatalogCommandNames(finalCalls)) {
        if (!disclosedNames.has(name)) {
            throw new TypeError(`Expected disclosed command schema for ${name}`);
        }
    }
}

function getBassCompressorPlanScope(plan: readonly ProviderPlanCall[]) {
    const protectedTargetIds = ['track-bass-frozen'];
    const protectedSet = new Set(protectedTargetIds);
    const targetIds = new Set<string>();
    for (const call of plan) {
        if (call.name !== 'addDevice') {
            continue;
        }
        for (const argumentName of ['trackId', 'afterDeviceId']) {
            const value = call.arguments[argumentName];
            if (typeof value === 'string' && !protectedSet.has(value)) {
                targetIds.add(value);
            }
        }
    }
    return {
        targetIds: [...targetIds],
        targetRanges: [],
        protectedTargetIds,
        protectedRanges: [],
    };
}

function asCommandBatchProposal(plan: readonly ProviderPlanCall[]): ProviderPlanCall[] {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                commands: plan.map((call) => ({ name: call.name, arguments: call.arguments })),
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Insert one compressor after each canonical EQ on the unfrozen bass targets.',
                    constraints: ['Preserve frozen bass tracks and every existing device order and state.'],
                    scope: getBassCompressorPlanScope(plan),
                    capabilityIds: [...new Set(plan.map((call) => call.name))],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate both exact target chains against the current project revision.'],
                    stoppingConditions: ['Stop before mutation if any target, anchor, or protection guard conflicts.'],
                },
            },
        },
    ];
}

function catalogDiscoveryPlan(finalCalls: readonly ProviderPlanCall[]): ProviderPlanCall[] {
    return [
        {
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: getExpectedCatalogCommandNames(finalCalls) },
        },
    ];
}

function createFinalProviderCalls(userMessage: string): ProviderPlanCall[] {
    assertBassCompressorProviderContext(userMessage);
    return asCommandBatchProposal(runtimeMocks.transformPlan.value([...providerPlan]));
}

function createTurnTrackedWebLlmResponder(): (systemPrompt: string, userMessage: string) => Promise<string> {
    let turn = 0;
    return (_systemPrompt, userMessage) => {
        turn += 1;
        if (turn > 2) {
            throw new Error('Expected exactly two WebLLM provider turns');
        }
        if (turn === 1) {
            return Promise.resolve(JSON.stringify(catalogDiscoveryPlan(asCommandBatchProposal(providerPlan))));
        }
        const finalCalls = createFinalProviderCalls(userMessage);
        assertDiscoveredCommandSchemas(userMessage, finalCalls);
        return Promise.resolve(JSON.stringify(finalCalls));
    };
}

function getHostedUserMessage(requestBody: string): string {
    const request: unknown = JSON.parse(requestBody);
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

function toolCallsResponse(calls: readonly ProviderPlanCall[]): Response {
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

function createTurnTrackedHostedResponder(): (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> {
    let turn = 0;
    return (_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        turn += 1;
        if (turn > 2) {
            throw new Error('Expected exactly two hosted provider turns');
        }
        const userMessage = getHostedUserMessage(init.body);
        if (turn === 1) {
            return Promise.resolve(toolCallsResponse(catalogDiscoveryPlan(asCommandBatchProposal(providerPlan))));
        }
        const finalCalls = createFinalProviderCalls(userMessage);
        assertDiscoveredCommandSchemas(userMessage, finalCalls);
        return Promise.resolve(toolCallsResponse(finalCalls));
    };
}

function createDevice(id: string, name: string, type: string): Track['devices'][number] {
    return { id, name, type, bypassed: false, parameterValues: {} };
}

function createTrack({ id, name, frozen = false }: { id: string; name: string; frozen?: boolean }): Track {
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
        devices: [createDevice(`device-${id.replace('track-', '')}-eq`, 'EQ', 'builtin-eq')],
        sends: [],
        midiFx: [],
        frozen,
        freezeState: frozen ? { status: 'frozen' } : { status: 'unfrozen' },
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

function getTrack(trackId: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected track ${trackId}`);
    }
    return track;
}

function ensureRealBassTrackStrips(): void {
    for (const trackId of BASS_RUNTIME_TRACK_IDS) {
        const initialization = projectTrackToLiveStrip({ trackId });
        if (!initialization || initialization.acceptance !== 'accepted' || initialization.application !== 'applied') {
            throw new Error(
                `Expected live strip initialization for ${trackId}: ${initialization?.reason ?? 'no runtime outcome'}`
            );
        }
    }
}

function removeRealBassTrackStrips(): void {
    for (const trackId of BASS_RUNTIME_TRACK_IDS) {
        removeTrackStrip(trackId);
    }
}

function expectRuntimeDeviceChain(trackId: string, expectedDeviceIds: readonly string[]): void {
    const projectTopology = runtimeGraphTopology.createNode(getTrack(trackId));
    expect(projectTopology.devices.map((device) => device.id)).toEqual(expectedDeviceIds);
    expect(matchesRuntimeDeviceChainTopology(projectTopology)).toBe(true);
}

type RuntimeDeviceChainCall = {
    operation: string;
    trackId: string;
    beforeDeviceIds: string[];
    afterDeviceIds: string[];
    result: unknown;
};

function getRuntimeNodeDeviceIds(value: unknown): string[] {
    if (!isRecord(value) || !Array.isArray(value.devices)) {
        throw new TypeError('Expected runtime device-chain node');
    }
    return value.devices.map((device) => {
        if (!isRecord(device) || typeof device.id !== 'string') {
            throw new TypeError('Expected runtime device-chain device id');
        }
        return device.id;
    });
}

function getRuntimeDeviceChainCalls(spy: RuntimeGraphDeltaSpy): RuntimeDeviceChainCall[] {
    return spy.mock.calls.flatMap(([delta], index) => {
        if (
            !isRecord(delta) ||
            delta.command !== 'replace-track-device-chain' ||
            typeof delta.operation !== 'string' ||
            !isRecord(delta.before) ||
            typeof delta.before.id !== 'string'
        ) {
            return [];
        }
        return [
            {
                operation: delta.operation,
                trackId: delta.before.id,
                beforeDeviceIds: getRuntimeNodeDeviceIds(delta.before),
                afterDeviceIds: getRuntimeNodeDeviceIds(delta.after),
                result: spy.mock.results[index]?.value,
            },
        ];
    });
}

function getConfirmation() {
    return getPendingActionConfirmation(
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
            ''
    );
}

function getWebLlmUserMessage(): string {
    const userMessage: unknown = runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1];
    if (typeof userMessage !== 'string') {
        throw new TypeError('Expected one WebLLM user message');
    }
    return userMessage;
}

function getHostedRequestBody(): string {
    const body = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

describe('bass compressor prompt workflow', () => {
    let runtimeGraphDeltaSpy: RuntimeGraphDeltaSpy;

    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.transformPlan.value = (plan) => plan;
        runtimeMocks.generateWebLlmCompletion.mockImplementation(createTurnTrackedWebLlmResponder());
        runtimeMocks.fetch.mockImplementation(createTurnTrackedHostedResponder());
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('bass compressor prompt workflow test');
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
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const bassDi = createTrack({ id: 'track-bass-di', name: 'Bass DI' });
        bassDi.devices.push({
            ...createDevice('device-bass-di-saturator', 'Saturator', 'builtin-gain'),
            bypassed: true,
            parameterValues: { drive: 0.42 },
        });
        const bassAmp = createTrack({ id: 'track-bass-amp', name: 'Bass Amp' });
        bassAmp.devices.unshift(createDevice('device-bass-amp-preamp', 'Preamp', 'builtin-gain'));
        bassAmp.devices.push(createDevice('device-bass-amp-chorus', 'Chorus', 'builtin-gain'));
        trackStore.set({
            tracks: [
                bassDi,
                bassAmp,
                createTrack({ id: 'track-bass-frozen', name: 'Bass Frozen', frozen: true }),
                createTrack({ id: 'track-guitar', name: 'Guitar' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushFixtureTrackStore();
        ensureRealBassTrackStrips();
        runtimeGraphDeltaSpy = vi.spyOn(audioEngineUseCases, 'applyRuntimeGraphDelta');
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        runtimeGraphDeltaSpy.mockRestore();
        removeRealBassTrackStrips();
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds, confirms, commits, receipts, undoes, and redoes the exact non-frozen bass insertions', async () => {
        const frozenBefore = structuredClone(getTrack('track-bass-frozen'));
        const guitarBefore = structuredClone(getTrack('track-guitar'));
        const bassDiDevicesBefore = structuredClone(getTrack('track-bass-di').devices);
        const bassAmpDevicesBefore = structuredClone(getTrack('track-bass-amp').devices);
        await sendChatMessage(PROMPT);

        expect(runtimeMocks.generateWebLlmCompletion).toHaveBeenCalledTimes(2);
        const providerRequest = getWebLlmUserMessage();
        expect(providerRequest).toContain(PROMPT);
        expect(getProviderProjectTargets(providerRequest)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'track-bass-di', kind: 'audio', frozen: false }),
                expect.objectContaining({ id: 'track-bass-amp', kind: 'audio', frozen: false }),
                expect.objectContaining({ id: 'track-bass-frozen', kind: 'audio', frozen: true }),
            ])
        );

        const confirmation = getConfirmation();
        expect(confirmation?.actions).toEqual([
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-di',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-di-eq',
                    expectedDeviceIds: BASS_DI_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-di-builtin-compressor',
                },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-amp',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-amp-eq',
                    expectedDeviceIds: BASS_AMP_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-amp-builtin-compressor',
                },
            },
        ]);
        expect(confirmation?.risk).toMatchObject({ level: 'broad-reversible' });
        expect(confirmation?.protectedUnchanged).toEqual([{ id: 'track-bass-frozen', name: 'Bass Frozen' }]);
        expect(confirmation?.affectedIds).toEqual([
            'track-bass-di',
            'device-bass-di-eq',
            'device-ai-track-bass-di-builtin-compressor',
            'track-bass-amp',
            'device-bass-amp-eq',
            'device-ai-track-bass-amp-builtin-compressor',
        ]);
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(
            'Insert "Compressor" (device-ai-track-bass-di-builtin-compressor, builtin-compressor) on "Bass DI" (track-bass-di) after "EQ" (device-bass-di-eq)'
        );
        expect(proposal?.content).toContain('Protected unchanged: "Bass Frozen" (track-bass-frozen)');
        expect(undoStore.value?.past).toEqual([]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expectRuntimeDeviceChain('track-bass-di', BASS_DI_INSERTED_DEVICE_IDS);
        expectRuntimeDeviceChain('track-bass-amp', BASS_AMP_INSERTED_DEVICE_IDS);
        expect(
            getTrack('track-bass-di').devices.filter(
                (device) => device.id !== 'device-ai-track-bass-di-builtin-compressor'
            )
        ).toEqual(bassDiDevicesBefore);
        expect(
            getTrack('track-bass-amp').devices.filter(
                (device) => device.id !== 'device-ai-track-bass-amp-builtin-compressor'
            )
        ).toEqual(bassAmpDevicesBefore);
        expect(getTrack('track-bass-frozen')).toEqual(frozenBefore);
        expect(getTrack('track-guitar')).toEqual(guitarBefore);
        expect(getRuntimeDeviceChainCalls(runtimeGraphDeltaSpy)).toEqual([
            {
                operation: 'add-device',
                trackId: 'track-bass-di',
                beforeDeviceIds: BASS_DI_DEVICE_IDS,
                afterDeviceIds: BASS_DI_INSERTED_DEVICE_IDS,
                result: expect.objectContaining({ acceptance: 'accepted', application: 'applied' }),
            },
            {
                operation: 'add-device',
                trackId: 'track-bass-amp',
                beforeDeviceIds: BASS_AMP_DEVICE_IDS,
                afterDeviceIds: BASS_AMP_INSERTED_DEVICE_IDS,
                result: expect.objectContaining({ acceptance: 'accepted', application: 'applied' }),
            },
        ]);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain(
            'Affected IDs: track-bass-di, device-bass-di-eq, device-ai-track-bass-di-builtin-compressor'
        );
        expect(receipt?.content).toContain(
            'Affected IDs: track-bass-amp, device-bass-amp-eq, device-ai-track-bass-amp-builtin-compressor'
        );
        expect(receipt?.content).toContain('Protected unchanged: "Bass Frozen" (track-bass-frozen)');
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();

        expectRuntimeDeviceChain('track-bass-di', BASS_DI_DEVICE_IDS);
        expectRuntimeDeviceChain('track-bass-amp', BASS_AMP_DEVICE_IDS);
        expect(getTrack('track-bass-frozen')).toEqual(frozenBefore);
        expect(
            getRuntimeDeviceChainCalls(runtimeGraphDeltaSpy).map(({ operation, trackId }) => [operation, trackId])
        ).toEqual([
            ['add-device', 'track-bass-di'],
            ['add-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-di'],
        ]);

        await redo();

        expectRuntimeDeviceChain('track-bass-di', BASS_DI_INSERTED_DEVICE_IDS);
        expectRuntimeDeviceChain('track-bass-amp', BASS_AMP_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-frozen')).toEqual(frozenBefore);
        expect(
            getRuntimeDeviceChainCalls(runtimeGraphDeltaSpy).map(({ operation, trackId }) => [operation, trackId])
        ).toEqual([
            ['add-device', 'track-bass-di'],
            ['add-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-di'],
            ['add-device', 'track-bass-di'],
            ['add-device', 'track-bass-amp'],
        ]);
    });

    it('normalizes the hosted provider to the same guarded insertion plan and receipt', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        expect(runtimeMocks.fetch).toHaveBeenCalledTimes(2);
        expect(getProviderProjectTargets(getHostedUserMessage(getHostedRequestBody()))).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'track-bass-frozen', frozen: true })])
        );
        const confirmation = getConfirmation();
        expect(confirmation?.actions).toEqual([
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-di',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-di-eq',
                    expectedDeviceIds: BASS_DI_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-di-builtin-compressor',
                },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-amp',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-amp-eq',
                    expectedDeviceIds: BASS_AMP_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-amp-builtin-compressor',
                },
            },
        ]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain(
            'Insert "Compressor" (device-ai-track-bass-amp-builtin-compressor, builtin-compressor) on "Bass Amp" (track-bass-amp) after "EQ" (device-bass-amp-eq)'
        );
        expect(receipt?.content).toContain('Protected unchanged: "Bass Frozen" (track-bass-frozen)');
    });

    it('rejects provider enlargement to a frozen bass track without a proposal or write', async () => {
        runtimeMocks.transformPlan.value = (_plan) => [
            ...providerPlan,
            {
                name: 'addDevice',
                arguments: {
                    trackId: 'track-bass-frozen',
                    deviceType: 'Compressor',
                    afterDeviceId: 'device-bass-frozen-eq',
                },
            },
        ];
        const before = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(trackStore.value?.tracks).toEqual(before);
        expect(runtimeGraphDeltaSpy).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects an ambiguous repeated EQ anchor on a target track', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? { ...track, devices: [...track.devices, createDevice('device-bass-di-eq-2', 'EQ', 'builtin-eq')] }
                    : track
            ),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeGraphDeltaSpy).not.toHaveBeenCalled();
    });

    it('rejects a target track with no matching EQ anchor', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-bass-di') {
                    return track;
                }
                return { ...track, devices: [] };
            }),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeGraphDeltaSpy).not.toHaveBeenCalled();
    });

    it('grounds a renamed device from its canonical EQ descriptor', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-bass-di') {
                    return track;
                }
                return {
                    ...track,
                    devices: track.devices.map((device) =>
                        device.id === 'device-bass-di-eq' ? { ...device, name: 'Low Cut' } : device
                    ),
                };
            }),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()?.actions[0]).toMatchObject({
            type: 'addDevice',
            payload: { afterDeviceId: 'device-bass-di-eq' },
        });
    });

    it('rejects a non-EQ device whose display name is EQ', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-bass-di') {
                    return track;
                }
                return {
                    ...track,
                    devices: track.devices.map((device) => {
                        if (device.id === 'device-bass-di-eq') {
                            return { ...device, name: 'Low Cut' };
                        }
                        if (device.id === 'device-bass-di-saturator') {
                            return { ...device, name: 'EQ' };
                        }
                        return device;
                    }),
                };
            }),
        });
        runtimeMocks.transformPlan.value = () => [
            {
                name: 'addDevice',
                arguments: {
                    trackId: 'track-bass-di',
                    deviceType: 'Compressor',
                    afterDeviceId: 'device-bass-di-saturator',
                },
            },
            providerPlan[1],
        ];

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeGraphDeltaSpy).not.toHaveBeenCalled();
    });

    it('protects only frozen tracks in the semantic bass target set', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-guitar') {
                    return track;
                }
                return { ...track, frozen: true, freezeState: { status: 'frozen' } };
            }),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()?.protectedUnchanged).toEqual([{ id: 'track-bass-frozen', name: 'Bass Frozen' }]);
    });

    it('keeps committed project truth and exposes runtime divergence when the later target chain conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeGraphDeltaSpy.mockImplementationOnce((delta) => {
            const runtimeResult = applyRuntimeGraphDelta(delta);
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state during runtime insertion');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => {
                    if (track.id !== 'track-bass-amp') {
                        return track;
                    }
                    return {
                        ...track,
                        devices: [...track.devices, createDevice('device-remote-change', 'Gain', 'builtin-gain')],
                    };
                }),
            });
            return runtimeResult;
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'executed' });
        expectRuntimeDeviceChain('track-bass-di', BASS_DI_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual([
            ...BASS_AMP_INSERTED_DEVICE_IDS,
            'device-remote-change',
        ]);
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-amp')))).toBe(
            false
        );
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('project change committed with a follow-up warning');
        expect(receipt?.error).toContain('requires retry');
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('retains the committed batch and reports the exact later runtime insertion failure', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        let runtimeInsertion = 0;
        runtimeGraphDeltaSpy.mockImplementation((delta) => {
            runtimeInsertion += 1;
            if (runtimeInsertion > 1) {
                throw new Error('runtime graph refused compressor');
            }
            return applyRuntimeGraphDelta(delta);
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'executed' });
        expectRuntimeDeviceChain('track-bass-di', BASS_DI_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-amp')))).toBe(
            false
        );
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('project change committed with a follow-up warning');
        expect(receipt?.error).toContain('runtime graph refused compressor');
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('preserves the committed project and identifies both divergent live chains after a later conflict', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeGraphDeltaSpy.mockImplementationOnce((delta) => {
            const runtimeResult = applyRuntimeGraphDelta(delta);
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state during runtime insertion');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => {
                    if (track.id === 'track-bass-di') {
                        return {
                            ...track,
                            devices: [...track.devices, createDevice('device-remote-di', 'Gain', 'builtin-gain')],
                        };
                    }
                    if (track.id === 'track-bass-amp') {
                        return {
                            ...track,
                            devices: [...track.devices, createDevice('device-remote-amp', 'Gain', 'builtin-gain')],
                        };
                    }
                    return track;
                }),
            });
            return runtimeResult;
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'executed' });
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual([
            ...BASS_DI_INSERTED_DEVICE_IDS,
            'device-remote-di',
        ]);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual([
            ...BASS_AMP_INSERTED_DEVICE_IDS,
            'device-remote-amp',
        ]);
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-di')))).toBe(
            false
        );
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-amp')))).toBe(
            false
        );
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('reports a manual-repair warning when a committed runtime delta cannot compensate itself', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        let runtimeInsertion = 0;
        runtimeGraphDeltaSpy.mockImplementation((delta) => {
            runtimeInsertion += 1;
            if (runtimeInsertion === 1) {
                return applyRuntimeGraphDelta(delta);
            }
            return {
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                correlation: {
                    appRevision: audioEngineUseCases.getRuntimeGraphRevision(),
                    projectRevision: captureProjectRevision(),
                },
                reason: 'runtime graph removal failed; manual repair is required',
                runtimeRevision: audioEngineUseCases.getRuntimeGraphRevision(),
            };
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'executed' });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('project change committed with a follow-up warning');
        expect(receipt?.error).toContain('runtime graph removal failed');
        expect(receipt?.error?.toLowerCase()).toContain('manual repair');
        expectRuntimeDeviceChain('track-bass-di', BASS_DI_INSERTED_DEVICE_IDS);
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-amp')))).toBe(
            false
        );
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('uses one strict runtime cleanup owner and keeps its repaired first failure observable', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        runtimeGraphDeltaSpy.mockClear();
        let failedRemoval = false;
        runtimeGraphDeltaSpy.mockImplementation((delta) => {
            if (
                !failedRemoval &&
                isRecord(delta) &&
                delta.command === 'replace-track-device-chain' &&
                delta.operation === 'remove-device' &&
                isRecord(delta.before) &&
                delta.before.id === 'track-bass-amp'
            ) {
                failedRemoval = true;
                throw new Error('partial TrackNode removal failed');
            }
            return applyRuntimeGraphDelta(delta);
        });

        let undoError: unknown;
        try {
            await undo();
        } catch (error) {
            undoError = error;
        }

        expect(undoError).toBeInstanceOf(Error);
        if (!(undoError instanceof Error) || !(undoError.cause instanceof Error)) {
            throw new Error('Expected grouped undo to retain the repaired runtime warning');
        }
        expect(undoError.name).toBe('AppActionCommittedError');
        expect(undoError.cause.message).toContain('partial TrackNode removal failed');
        expect(undoError.cause.message.toLowerCase()).toContain('manual repair');
        expectRuntimeDeviceChain('track-bass-di', BASS_DI_DEVICE_IDS);
        expectRuntimeDeviceChain('track-bass-amp', BASS_AMP_DEVICE_IDS);
        expect(
            getRuntimeDeviceChainCalls(runtimeGraphDeltaSpy).map(({ operation, trackId }) => [operation, trackId])
        ).toEqual([
            ['remove-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-di'],
        ]);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });

    it('keeps grouped redo retryable when a collaborator freezes an eligible bass track after undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        await undo();
        runtimeGraphDeltaSpy.mockClear();
        const futureBefore = structuredClone(undoStore.value?.future);
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected undone track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? { ...track, frozen: true, freezeState: { status: 'frozen' as const } }
                    : track
            ),
        });

        await redo();

        expectRuntimeDeviceChain('track-bass-di', BASS_DI_DEVICE_IDS);
        expectRuntimeDeviceChain('track-bass-amp', BASS_AMP_DEVICE_IDS);
        expect(runtimeGraphDeltaSpy).not.toHaveBeenCalled();
        expect(undoStore.value?.future).toEqual(futureBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reports persistent post-commit runtime teardown failures as manual repair after grouped undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        runtimeGraphDeltaSpy.mockClear();
        runtimeGraphDeltaSpy.mockImplementation((delta) => {
            if (
                isRecord(delta) &&
                delta.command === 'replace-track-device-chain' &&
                delta.operation === 'remove-device'
            ) {
                throw new Error('persistent runtime teardown failure');
            }
            return applyRuntimeGraphDelta(delta);
        });

        let undoError: unknown;
        try {
            await undo();
        } catch (error) {
            undoError = error;
        }

        expect(undoError).toBeInstanceOf(Error);
        if (!(undoError instanceof Error)) {
            throw new Error('Expected grouped undo to report committed runtime divergence');
        }
        expect(undoError.name).toBe('AppActionCommittedError');
        expect(undoError.cause).toBeInstanceOf(Error);
        if (!(undoError.cause instanceof Error)) {
            throw new Error('Expected committed error to retain the runtime warning');
        }
        expect(undoError.cause.message).toContain('persistent runtime teardown failure');
        expect(undoError.cause.message.toLowerCase()).toContain('manual repair');
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-di')))).toBe(
            false
        );
        expect(matchesRuntimeDeviceChainTopology(runtimeGraphTopology.createNode(getTrack('track-bass-amp')))).toBe(
            false
        );
        expect(getRuntimeDeviceChainCalls(runtimeGraphDeltaSpy)).toHaveLength(4);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });

    it('refuses grouped undo after a collaborator changes one inserted chain', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected committed track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? {
                          ...track,
                          devices: [...track.devices, createDevice('device-collaborator-gain', 'Gain', 'builtin-gain')],
                      }
                    : track
            ),
        });
        const beforeUndo = structuredClone(trackStore.value?.tracks);
        const historyBeforeUndo = structuredClone(undoStore.value);
        runtimeGraphDeltaSpy.mockClear();

        await undo();

        expect(trackStore.value?.tracks).toEqual(beforeUndo);
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual([
            ...BASS_DI_INSERTED_DEVICE_IDS,
            'device-collaborator-gain',
        ]);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(runtimeGraphDeltaSpy).not.toHaveBeenCalled();
        expect(undoStore.value).toEqual(historyBeforeUndo);
        runtimeGraphDeltaSpy.mockClear();

        const retryState = trackStore.value;
        if (!retryState) {
            throw new Error('Expected retryable track state');
        }
        trackStore.set({
            ...retryState,
            tracks: retryState.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? { ...track, devices: track.devices.filter((device) => device.id !== 'device-collaborator-gain') }
                    : track
            ),
        });

        await undo();

        expectRuntimeDeviceChain('track-bass-di', BASS_DI_DEVICE_IDS);
        expectRuntimeDeviceChain('track-bass-amp', BASS_AMP_DEVICE_IDS);
        expect(
            getRuntimeDeviceChainCalls(runtimeGraphDeltaSpy).map(({ operation, trackId }) => [operation, trackId])
        ).toEqual([
            ['remove-device', 'track-bass-amp'],
            ['remove-device', 'track-bass-di'],
        ]);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });
});
