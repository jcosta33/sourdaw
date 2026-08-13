import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    executeAppAction,
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

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

const SHARED_VOCAL_FX_PROMPT = 'Move vocal delays and reverbs to shared buses while preserving balance.';
const SHARED_VOCAL_FX_PARAPHRASE =
    'Put the vocal delay and reverb effects on shared buses, keeping the current wet and dry balance intact.';

type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };
type RenderOfflineMock = (options: {
    durationBeats: number;
    onWarning?: (message: string) => void;
    sampleRate?: number;
    startBeat?: number;
    tailSeconds?: number;
}) => Promise<AudioBuffer>;

const sharedVocalFxProviderPlan = [
    { name: 'removeDevice', arguments: { deviceId: 'device-lead-delay' } },
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.656 } },
    { name: 'removeDevice', arguments: { deviceId: 'device-lead-double-delay' } },
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-double', gain: 0.518 } },
    { name: 'removeDevice', arguments: { deviceId: 'device-bgv-reverb' } },
    { name: 'setTrackGain', arguments: { trackId: 'track-bgv-high', gain: 0.402 } },
    { name: 'removeDevice', arguments: { deviceId: 'device-bgv-low-reverb' } },
    { name: 'setTrackGain', arguments: { trackId: 'track-bgv-low', gain: 0.427 } },
    { name: 'createBus', arguments: { name: 'Vocal Delay', binding: 'vocal-delay' } },
    { name: 'addDevice', arguments: { trackId: '$vocal-delay', deviceType: 'builtin-delay' } },
    { name: 'createBus', arguments: { name: 'Vocal Reverb', binding: 'vocal-reverb' } },
    { name: 'addDevice', arguments: { trackId: '$vocal-reverb', deviceType: 'builtin-reverb' } },
    {
        name: 'addSend',
        arguments: { trackId: 'track-lead-vocal', busId: '$vocal-delay', level: 0.25, preFader: false },
    },
    {
        name: 'addSend',
        arguments: {
            trackId: 'track-lead-double',
            busId: '$vocal-delay',
            level: 0.4285714285714286,
            preFader: false,
        },
    },
    {
        name: 'addSend',
        arguments: {
            trackId: 'track-bgv-high',
            busId: '$vocal-reverb',
            level: 0.6666666666666667,
            preFader: false,
        },
    },
    {
        name: 'addSend',
        arguments: {
            trackId: 'track-bgv-low',
            busId: '$vocal-reverb',
            level: 0.4285714285714286,
            preFader: false,
        },
    },
] as const satisfies readonly ProviderPlanCall[];

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        addDeviceToStrip: vi.fn(),
        backend,
        clearReportedLatency: vi.fn(),
        ensureTrackStrip: vi.fn(),
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        getAllSidechainRoutes: vi.fn(() => []),
        removeDeviceFromStrip: vi.fn(),
        removeSend: vi.fn(),
        renderOffline: vi.fn<RenderOfflineMock>(),
        resolveToasterPadBinding: vi.fn(() => null),
        setSend: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackMute: vi.fn(),
        setTrackOutput: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackSoloGate: vi.fn(),
        updateDeviceBypass: vi.fn(),
        updateDeviceParam: vi.fn(),
        wireSidechainRoutes: vi.fn(),
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
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    clearReportedLatency: runtimeMocks.clearReportedLatency,
    ensureTrackStrip: runtimeMocks.ensureTrackStrip,
    removeDeviceFromStrip: runtimeMocks.removeDeviceFromStrip,
    renderOffline: runtimeMocks.renderOffline,
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackOutput: runtimeMocks.setTrackOutput,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
    updateDeviceBypass: runtimeMocks.updateDeviceBypass,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
    removeSend: runtimeMocks.removeSend,
    setSend: runtimeMocks.setSend,
    wireSidechainRoutes: runtimeMocks.wireSidechainRoutes,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function createSharedVocalFxProviderPlanFromUserMessage(userMessage: string): ProviderPlanCall[] {
    const match = /<project_context>\n(?<contextJson>.+)\n<\/project_context>/u.exec(userMessage);
    const contextJson = match?.groups?.contextJson;
    if (!contextJson) {
        throw new TypeError('Expected serialized project context in provider request');
    }
    const context: unknown = JSON.parse(contextJson);
    if (!isRecord(context) || typeof context.projectRevision !== 'string') {
        throw new TypeError('Expected revision-bound project context');
    }
    const capability = context.sharedVocalFxBusesCapability;
    if (
        !isRecord(capability) ||
        capability.baseRevision !== context.projectRevision ||
        !isUnknownArray(capability.orderedToolPlan)
    ) {
        throw new TypeError('Expected revision-bound EX-08 capability');
    }
    return capability.orderedToolPlan.map((call) => {
        if (!isRecord(call) || typeof call.name !== 'string' || !isRecord(call.arguments)) {
            throw new TypeError('Expected complete EX-08 ordered provider plan');
        }
        return { name: call.name, arguments: call.arguments };
    });
}

function getWebLlmUserMessage(): string {
    const userMessage: unknown = runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1];
    if (typeof userMessage !== 'string') {
        throw new TypeError('Expected one WebLLM user message');
    }
    return userMessage;
}

function getHostedUserMessage(requestBody: string): string {
    const request: unknown = JSON.parse(requestBody);
    if (!isRecord(request) || !isUnknownArray(request.messages)) {
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

function useHostedProviderFixture(createPlan: (userMessage: string) => ProviderPlanCall[]): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const plan = createPlan(getHostedUserMessage(init.body));
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

const sharedVocalFxWorkflowSelection = {
    name: 'selectWorkflowCapability',
    arguments: { capabilityId: 'shared-vocal-fx-buses' },
};

function useHostedSharedVocalFxFixture(): void {
    useHostedProviderFixture((userMessage) => [
        sharedVocalFxWorkflowSelection,
        ...createSharedVocalFxProviderPlanFromUserMessage(userMessage),
    ]);
}

function useWebSharedVocalFxFixture(
    transform: (plan: ProviderPlanCall[]) => ProviderPlanCall[] = (plan) => plan
): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) =>
        Promise.resolve(
            JSON.stringify([
                sharedVocalFxWorkflowSelection,
                ...transform(createSharedVocalFxProviderPlanFromUserMessage(userMessage)),
            ])
        )
    );
}

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

function addDevice(track: Track, id: string, type: string, name: string): void {
    track.devices.push({ id, type, name, bypassed: false, parameterValues: {} });
}

function addConfiguredDevice({
    track,
    id,
    type,
    name,
    parameterValues,
}: {
    track: Track;
    id: string;
    type: string;
    name: string;
    parameterValues: Record<string, number>;
}): void {
    track.devices.push({ id, type, name, bypassed: false, parameterValues });
}

function installSharedVocalFxFixture(): {
    lead: Track;
    leadDouble: Track;
    backing: Track;
    backingLow: Track;
    drums: Track;
    parallel: Track;
} {
    const lead = createTrack('track-lead-vocal', 'Lead Vocal');
    lead.gain = 0.82;
    lead.pan = 0;
    addDevice(lead, 'device-lead-eq', 'builtin-eq', 'Lead EQ');
    addConfiguredDevice({
        track: lead,
        id: 'device-lead-delay',
        type: 'builtin-delay',
        name: 'Lead Delay',
        parameterValues: {
            'delay-time': 375,
            'delay-feedback': 0.35,
            'delay-lowcut': 120,
            'delay-highcut': 8_000,
            'delay-mix': 0.2,
        },
    });
    const leadDouble = createTrack('track-lead-double', 'Lead Vocal Double');
    leadDouble.gain = 0.74;
    addConfiguredDevice({
        track: leadDouble,
        id: 'device-lead-double-delay',
        type: 'builtin-delay',
        name: 'Double Delay',
        parameterValues: {
            'delay-time': 375,
            'delay-feedback': 0.35,
            'delay-lowcut': 120,
            'delay-highcut': 8_000,
            'delay-mix': 0.3,
        },
    });
    const backing = createTrack('track-bgv-high', 'Backing Vocal High');
    backing.gain = 0.67;
    backing.pan = 0;
    addConfiguredDevice({
        track: backing,
        id: 'device-bgv-reverb',
        type: 'builtin-reverb',
        name: 'Backing Reverb',
        parameterValues: {
            'rev-size': 0.65,
            'rev-decay': 2.5,
            'rev-damping': 0.4,
            'rev-predelay': 20,
            'rev-lowcut': 180,
            'rev-mix': 0.4,
        },
    });
    const backingLow = createTrack('track-bgv-low', 'BGV Low');
    backingLow.gain = 0.61;
    addConfiguredDevice({
        track: backingLow,
        id: 'device-bgv-low-reverb',
        type: 'builtin-reverb',
        name: 'Low Reverb',
        parameterValues: {
            'rev-size': 0.65,
            'rev-decay': 2.5,
            'rev-damping': 0.4,
            'rev-predelay': 20,
            'rev-lowcut': 180,
            'rev-mix': 0.3,
        },
    });
    const drums = createTrack('track-drums', 'Drums');
    const parallel = createTrack('bus-vocal-parallel', 'Vocal Parallel', 'bus');
    trackStore.set({
        tracks: [lead, leadDouble, backing, backingLow, drums, parallel],
        selectedTrackId: null,
        ghostClips: [],
    });
    return { lead, leadDouble, backing, backingLow, drums, parallel };
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

function createTestAudioBuffer(sampleRate = 44_100): AudioBuffer {
    const channelData = new Float32Array(sampleRate);
    return {
        copyFromChannel(destination: Float32Array, _channelNumber: number, bufferOffset = 0) {
            destination.set(channelData.subarray(bufferOffset, bufferOffset + destination.length));
        },
        copyToChannel(source: Float32Array, _channelNumber: number, bufferOffset = 0) {
            channelData.set(source, bufferOffset);
        },
        duration: 1,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 2,
        sampleRate,
    };
}

describe('shared vocal FX buses workflow', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) =>
            Promise.resolve(
                JSON.stringify([
                    sharedVocalFxWorkflowSelection,
                    ...createSharedVocalFxProviderPlanFromUserMessage(userMessage),
                ])
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
        runtimeMocks.renderOffline.mockImplementation(() => Promise.resolve(createTestAudioBuffer()));
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('shared vocal FX buses workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('compiles EX-08 into one exact shared-delay/shared-reverb confirmation that preserves vocal balance', async () => {
        installSharedVocalFxFixture();
        useWebSharedVocalFxFixture();

        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(createSharedVocalFxProviderPlanFromUserMessage(getWebLlmUserMessage())).toEqual(
            sharedVocalFxProviderPlan
        );
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'removeDevice',
            'setTrackGain',
            'removeDevice',
            'setTrackGain',
            'removeDevice',
            'setTrackGain',
            'removeDevice',
            'setTrackGain',
            'createBus',
            'addDevice',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'createBus',
            'addDevice',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'addSend',
            'addSend',
            'addSend',
            'addSend',
        ]);
        expect(confirmation?.actions.slice(0, 8)).toEqual([
            {
                type: 'removeDevice',
                payload: {
                    deviceId: 'device-lead-delay',
                    expectedTrackId: 'track-lead-vocal',
                    expectedDeviceIds: ['device-lead-eq', 'device-lead-delay'],
                },
            },
            {
                type: 'setTrackGain',
                payload: { trackId: 'track-lead-vocal', gain: 0.656, expectedGain: 0.82 },
            },
            {
                type: 'removeDevice',
                payload: {
                    deviceId: 'device-lead-double-delay',
                    expectedTrackId: 'track-lead-double',
                    expectedDeviceIds: ['device-lead-double-delay'],
                },
            },
            {
                type: 'setTrackGain',
                payload: { trackId: 'track-lead-double', gain: 0.518, expectedGain: 0.74 },
            },
            {
                type: 'removeDevice',
                payload: {
                    deviceId: 'device-bgv-reverb',
                    expectedTrackId: 'track-bgv-high',
                    expectedDeviceIds: ['device-bgv-reverb'],
                },
            },
            {
                type: 'setTrackGain',
                payload: { trackId: 'track-bgv-high', gain: 0.402, expectedGain: 0.67 },
            },
            {
                type: 'removeDevice',
                payload: {
                    deviceId: 'device-bgv-low-reverb',
                    expectedTrackId: 'track-bgv-low',
                    expectedDeviceIds: ['device-bgv-low-reverb'],
                },
            },
            {
                type: 'setTrackGain',
                payload: { trackId: 'track-bgv-low', gain: 0.427, expectedGain: 0.61 },
            },
        ]);
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'track-lead-vocal:pan', name: 'Lead Vocal pan 0' },
                { id: 'track-bgv-high:pan', name: 'Backing Vocal High pan 0' },
                { id: 'track-drums', name: 'Drums' },
                { id: 'bus-vocal-parallel', name: 'Vocal Parallel' },
                { id: 'device-lead-eq', name: 'Lead Vocal Lead EQ' },
            ])
        );
        expect(confirmation?.risk?.level).toBe('authority-sensitive');
    });

    it('routes a semantic paraphrase through the same bounded shared-vocal-effects capability', async () => {
        installSharedVocalFxFixture();
        useWebSharedVocalFxFixture();

        await sendChatMessage(SHARED_VOCAL_FX_PARAPHRASE);

        const confirmationId = getConfirmationId();
        expect(confirmationId).not.toBe('');
        expect(getPendingActionConfirmation(confirmationId)?.actions).toHaveLength(27);
    });

    it('rejects specialized actions when the provider omits or delays semantic capability selection', async () => {
        installSharedVocalFxFixture();
        runtimeMocks.generateWebLlmCompletion
            .mockResolvedValueOnce(JSON.stringify(sharedVocalFxProviderPlan))
            .mockResolvedValueOnce(JSON.stringify([...sharedVocalFxProviderPlan, sharedVocalFxWorkflowSelection]));

        await sendChatMessage(SHARED_VOCAL_FX_PARAPHRASE);
        expect(getConfirmationId()).toBe('');

        await sendChatMessage(SHARED_VOCAL_FX_PARAPHRASE);
        expect(getConfirmationId()).toBe('');
    });

    it('normalizes the hosted EX-08 plan from the same revision-bound capability', async () => {
        installSharedVocalFxFixture();
        useHostedSharedVocalFxFixture();

        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);

        const requestBody = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
        if (typeof requestBody !== 'string') {
            throw new TypeError('Expected one hosted provider request body');
        }
        expect(createSharedVocalFxProviderPlanFromUserMessage(getHostedUserMessage(requestBody))).toEqual(
            sharedVocalFxProviderPlan
        );
        expect(getPendingActionConfirmation(getConfirmationId())?.actions).toHaveLength(27);
    });

    it.each([
        {
            name: 'omitted target send',
            transform: (plan: ProviderPlanCall[]) => plan.slice(0, -1),
        },
        {
            name: 'enlarged non-vocal target',
            transform: (plan: ProviderPlanCall[]) => [
                ...plan,
                {
                    name: 'addSend',
                    arguments: { trackId: 'track-drums', busId: '$vocal-reverb', level: 0.5, preFader: false },
                },
            ],
        },
        {
            name: 'changed balance value',
            transform: (plan: ProviderPlanCall[]) =>
                plan.map((call) =>
                    call.name === 'addSend' && call.arguments.trackId === 'track-bgv-high'
                        ? { ...call, arguments: { ...call.arguments, level: 0.9 } }
                        : call
                ),
        },
    ])('rejects provider $name before confirmation or write', async ({ transform }) => {
        installSharedVocalFxFixture();
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        useWebSharedVocalFxFixture(transform);

        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each([
        'mismatched delay settings',
        'frozen vocal',
        'ambiguous vocal role',
        'unsupported vocal reverb',
        'legacy gain above unity',
        'VCA-controlled vocal',
    ])('fails closed for $0', async (condition) => {
        installSharedVocalFxFixture();
        const tracks = structuredClone(trackStore.value?.tracks ?? []);
        const backing = tracks.find((track) => track.id === 'track-bgv-high');
        const leadDouble = tracks.find((track) => track.id === 'track-lead-double');
        const lead = tracks.find((track) => track.id === 'track-lead-vocal');
        if (!backing || !lead || !leadDouble) {
            throw new Error('Expected EX-08 fixture tracks');
        }
        if (condition === 'mismatched delay settings') {
            const delay = leadDouble.devices.find((device) => device.id === 'device-lead-double-delay');
            if (delay) {
                delay.parameterValues['delay-time'] = 500;
            }
        }
        if (condition === 'frozen vocal') {
            lead.frozen = true;
        }
        if (condition === 'ambiguous vocal role') {
            backing.name = 'Vocal Mystery';
        }
        if (condition === 'unsupported vocal reverb') {
            const reverb = backing.devices.find((device) => device.id === 'device-bgv-reverb');
            if (reverb) {
                reverb.type = 'proof-chamber';
            }
        }
        if (condition === 'legacy gain above unity') {
            lead.gain = 1.25;
        }
        if (condition === 'VCA-controlled vocal') {
            lead.vcaGroupId = 'vca-vocals';
        }
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
        useWebSharedVocalFxFixture();

        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects serial inline delay into reverb because parallel shared buses cannot preserve that balance', async () => {
        const { lead } = installSharedVocalFxFixture();
        addConfiguredDevice({
            track: lead,
            id: 'device-lead-reverb',
            type: 'builtin-reverb',
            name: 'Lead Reverb',
            parameterValues: {
                'rev-size': 0.65,
                'rev-decay': 2.5,
                'rev-damping': 0.4,
                'rev-predelay': 20,
                'rev-lowcut': 180,
                'rev-mix': 0.25,
            },
        });
        trackStore.set({
            tracks: structuredClone(trackStore.value?.tracks ?? []),
            selectedTrackId: null,
            ghostClips: [],
        });
        useWebSharedVocalFxFixture();

        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(undoStore.value?.past).toEqual([]);
    });

    it('atomically moves both effects, receipts exact balance, and groups undo and redo', async () => {
        installSharedVocalFxFixture();
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        useWebSharedVocalFxFixture();
        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-08 confirmation');
        }
        const delayBusAction = confirmation.actions.find(
            (action) => action.type === 'createBus' && action.payload.name === 'Vocal Delay'
        );
        const reverbBusAction = confirmation.actions.find(
            (action) => action.type === 'createBus' && action.payload.name === 'Vocal Reverb'
        );
        const delayDeviceAction = confirmation.actions.find(
            (action) => action.type === 'addDevice' && action.payload.deviceType === 'builtin-delay'
        );
        const reverbDeviceAction = confirmation.actions.find(
            (action) => action.type === 'addDevice' && action.payload.deviceType === 'builtin-reverb'
        );
        if (
            delayBusAction?.type !== 'createBus' ||
            !delayBusAction.payload.busId ||
            reverbBusAction?.type !== 'createBus' ||
            !reverbBusAction.payload.busId ||
            delayDeviceAction?.type !== 'addDevice' ||
            !delayDeviceAction.payload.deviceId ||
            reverbDeviceAction?.type !== 'addDevice' ||
            !reverbDeviceAction.payload.deviceId
        ) {
            throw new Error('Expected app-owned EX-08 bus and device identities');
        }
        const delayBusId = delayBusAction.payload.busId;
        const reverbBusId = reverbBusAction.payload.busId;
        expect(confirmation.affectedIds).toEqual(
            expect.arrayContaining([
                'device-lead-delay',
                'device-lead-double-delay',
                'device-bgv-reverb',
                'device-bgv-low-reverb',
                delayBusId,
                reverbBusId,
                delayDeviceAction.payload.deviceId,
                reverbDeviceAction.payload.deviceId,
                'track-lead-vocal',
                'track-lead-double',
                'track-bgv-high',
                'track-bgv-low',
            ])
        );
        expect(confirmation.actionLabels).toEqual(
            expect.arrayContaining([
                'Remove device "Lead Delay" (device-lead-delay, builtin-delay) from "Lead Vocal" (track-lead-vocal)',
                'Set track "Lead Vocal" (track-lead-vocal) gain to 0.656',
                `Create bus "Vocal Delay" (${delayBusId}) at unity gain`,
                `Create bus "Vocal Reverb" (${reverbBusId}) at unity gain`,
                `Create post-fader send from "Lead Vocal" (track-lead-vocal) to "Vocal Delay" (${delayBusId}) at -12.04 dB`,
                `Create post-fader send from "Backing Vocal High" (track-bgv-high) to "Vocal Reverb" (${reverbBusId}) at -3.52 dB`,
            ])
        );

        const execution = await confirmPendingChatActions({ confirmationId: confirmation.id });
        if (execution.status !== 'executed') {
            throw new Error(`Expected executed confirmation: ${JSON.stringify(execution)}`);
        }

        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        const committedLead = committedTracks.find((track) => track.id === 'track-lead-vocal');
        const committedLeadDouble = committedTracks.find((track) => track.id === 'track-lead-double');
        const committedBacking = committedTracks.find((track) => track.id === 'track-bgv-high');
        const committedBackingLow = committedTracks.find((track) => track.id === 'track-bgv-low');
        const delayBus = committedTracks.find((track) => track.id === delayBusId);
        const reverbBus = committedTracks.find((track) => track.id === reverbBusId);
        expect(committedLead).toMatchObject({ gain: 0.656, pan: 0, outputId: 'master' });
        expect(committedLead?.devices.map((device) => device.id)).toEqual(['device-lead-eq']);
        expect(committedLead?.sends).toEqual([{ busId: delayBusId, level: 0.25, preFader: false }]);
        expect(committedLeadDouble).toMatchObject({ gain: 0.518, pan: 0, outputId: 'master', devices: [] });
        expect(committedLeadDouble?.sends).toEqual([{ busId: delayBusId, level: 0.4285714285714286, preFader: false }]);
        expect(committedBacking).toMatchObject({ gain: 0.402, pan: 0, outputId: 'master' });
        expect(committedBacking?.devices).toEqual([]);
        expect(committedBacking?.sends).toEqual([{ busId: reverbBusId, level: 0.6666666666666667, preFader: false }]);
        expect(committedBackingLow).toMatchObject({ gain: 0.427, pan: 0, outputId: 'master', devices: [] });
        expect(committedBackingLow?.sends).toEqual([
            { busId: reverbBusId, level: 0.4285714285714286, preFader: false },
        ]);
        for (const balance of [
            { originalGain: 0.82, mix: 0.2, track: committedLead, busId: delayBusId },
            { originalGain: 0.74, mix: 0.3, track: committedLeadDouble, busId: delayBusId },
            { originalGain: 0.67, mix: 0.4, track: committedBacking, busId: reverbBusId },
            { originalGain: 0.61, mix: 0.3, track: committedBackingLow, busId: reverbBusId },
        ]) {
            const send = balance.track?.sends.find((candidate) => candidate.busId === balance.busId);
            const bus = committedTracks.find((track) => track.id === balance.busId);
            expect(balance.track?.gain).toBeCloseTo(balance.originalGain * (1 - balance.mix), 12);
            expect((balance.track?.gain ?? 0) * (send?.level ?? 0) * (bus?.gain ?? 0)).toBeCloseTo(
                balance.originalGain * balance.mix,
                12
            );
        }
        expect(delayBus?.devices[0]).toMatchObject({
            id: delayDeviceAction.payload.deviceId,
            type: 'builtin-delay',
            parameterValues: {
                'delay-time': 375,
                'delay-feedback': 0.35,
                'delay-lowcut': 120,
                'delay-highcut': 8_000,
                'delay-mix': 1,
            },
        });
        expect(delayBus?.gain).toBe(1);
        expect(reverbBus?.devices[0]).toMatchObject({
            id: reverbDeviceAction.payload.deviceId,
            type: 'builtin-reverb',
            parameterValues: {
                'rev-size': 0.65,
                'rev-decay': 2.5,
                'rev-damping': 0.4,
                'rev-predelay': 20,
                'rev-lowcut': 180,
                'rev-mix': 1,
            },
        });
        expect(reverbBus?.gain).toBe(1);
        expect(committedTracks.find((track) => track.id === 'track-drums')).toEqual(originalTracks[4]);
        expect(committedTracks.find((track) => track.id === 'bus-vocal-parallel')).toEqual(originalTracks[5]);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        for (const label of confirmation.actionLabels) {
            expect(receipt?.content).toContain(label);
        }
        expect(undoStore.value?.past).toHaveLength(27);

        await undo();
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(undoStore.value?.future).toHaveLength(27);

        await redo();
        expect(trackStore.value?.tracks).toEqual(committedTracks);
        expect(undoStore.value?.past).toHaveLength(27);
        expect(undoStore.value?.future).toEqual([]);
    });

    it.each([
        {
            name: 'zero mix',
            mutate: (tracks: Track[]) => {
                const delay = tracks
                    .find((track) => track.id === 'track-lead-vocal')
                    ?.devices.find((device) => device.id === 'device-lead-delay');
                if (!delay) {
                    throw new Error('Expected Lead Delay');
                }
                delay.parameterValues['delay-mix'] = 0;
            },
        },
        {
            name: 'zero source gain',
            mutate: (tracks: Track[]) => {
                const lead = tracks.find((track) => track.id === 'track-lead-vocal');
                if (!lead) {
                    throw new Error('Expected Lead Vocal');
                }
                lead.gain = 0;
            },
        },
    ])('keeps receipt labels aligned when $name makes one approved gain a no-op', async ({ mutate }) => {
        installSharedVocalFxFixture();
        const tracks = structuredClone(trackStore.value?.tracks ?? []);
        mutate(tracks);
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
        useWebSharedVocalFxFixture();
        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-08 confirmation');
        }

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        const executed = getPendingActionConfirmation(confirmation.id);
        const doubleDelayRemoval = executed?.executedActions.find(
            (execution) =>
                execution.actionType === 'removeDevice' && execution.affectedIds.includes('device-lead-double-delay')
        );
        const expectedLabel =
            'Remove device "Double Delay" (device-lead-double-delay, builtin-delay) from "Lead Vocal Double" (track-lead-double)';
        expect(doubleDelayRemoval?.label).toBe(expectedLabel);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(receipt?.content).toContain(`- **removeDevice**: ${expectedLabel}`);
    });

    it('keeps grouped undo retryable when a collaborator edits a generated bus', async () => {
        installSharedVocalFxFixture();
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        useWebSharedVocalFxFixture();
        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-08 confirmation');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        const delayBus = trackStore.value?.tracks.find((track) => track.name === 'Vocal Delay');
        if (!delayBus) {
            throw new Error('Expected committed Vocal Delay bus');
        }
        await executeAppAction(
            {
                type: 'setTrackGain',
                payload: { trackId: delayBus.id, gain: 0.9, expectedGain: 1 },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        const collaboratedTracks = structuredClone(trackStore.value?.tracks ?? []);

        await undo();

        expect(trackStore.value?.tracks).toEqual(collaboratedTracks);
        expect(undoStore.value?.past).toHaveLength(27);
        expect(undoStore.value?.future).toEqual([]);

        await executeAppAction(
            {
                type: 'setTrackGain',
                payload: { trackId: delayBus.id, gain: 1, expectedGain: 0.9 },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        await undo();
        expect(trackStore.value?.tracks).toEqual(originalTracks);
    });

    it('rolls back the complete EX-08 batch and runtime when one parameter write fails', async () => {
        installSharedVocalFxFixture();
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        useWebSharedVocalFxFixture();
        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-08 confirmation');
        }
        runtimeMocks.updateDeviceParam.mockImplementationOnce(() => {
            throw new Error('shared delay parameter runtime unavailable');
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result).toMatchObject({ status: 'failed' });
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(undoStore.value?.past).toEqual([]);
        expect(getPendingActionConfirmation(confirmation.id)).toMatchObject({ status: 'failed', executedActions: [] });
        expect(runtimeMocks.setSend).not.toHaveBeenCalled();
    });

    it('keeps EX-08 grouped history atomic across collaborator send and device-chain conflicts', async () => {
        installSharedVocalFxFixture();
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        useWebSharedVocalFxFixture();
        await sendChatMessage(SHARED_VOCAL_FX_PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-08 confirmation');
        }
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });
        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        const delayBus = committedTracks.find((track) => track.name === 'Vocal Delay');
        if (!delayBus) {
            throw new Error('Expected committed Vocal Delay bus');
        }
        await executeAppAction(
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-lead-vocal',
                    busId: delayBus.id,
                    level: 0.5,
                    expectedLevel: 0.25,
                    expectedPreFader: false,
                },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        const collaboratedTracks = structuredClone(trackStore.value?.tracks ?? []);
        const runtimeRemoveSendCount = runtimeMocks.removeSend.mock.calls.length;

        await undo();

        expect(trackStore.value?.tracks).toEqual(collaboratedTracks);
        expect(runtimeMocks.removeSend).toHaveBeenCalledTimes(runtimeRemoveSendCount);
        expect(undoStore.value?.past).toHaveLength(27);
        expect(undoStore.value?.future).toEqual([]);

        await executeAppAction(
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-lead-vocal',
                    busId: delayBus.id,
                    level: 0.25,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        await undo();
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        await executeAppAction(
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-lead-vocal',
                    deviceType: 'builtin-compressor',
                    deviceId: 'device-collaborator-compressor',
                },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        const collaboratedOriginal = structuredClone(trackStore.value?.tracks ?? []);
        const runtimeRemoveDeviceCount = runtimeMocks.removeDeviceFromStrip.mock.calls.length;

        await redo();

        expect(trackStore.value?.tracks).toEqual(collaboratedOriginal);
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledTimes(runtimeRemoveDeviceCount);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(27);

        await executeAppAction(
            { type: 'removeDevice', payload: { deviceId: 'device-collaborator-compressor' } },
            { skipUndo: true, skipMacroRecording: true }
        );
        await redo();
        expect(trackStore.value?.tracks).toEqual(committedTracks);
        expect(undoStore.value?.past).toHaveLength(27);
        expect(undoStore.value?.future).toEqual([]);
    });
});
