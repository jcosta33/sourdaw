import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, getPluginById, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { getDeviceChainTailSeconds } from '#/modules/AudioEngine/useCases';
import {
    clearAgentSectionRenderArtifacts,
    getAgentSectionRenderArtifacts,
    getAudioRenderingHandlers,
} from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    getExecutableAppActionToolSchemas,
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
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';
import { sendChatMessage } from '../sendChatMessage';

const PROMPT =
    'Remove reverbs from all backing vocals, create one shared plate bus with EQ before plate reverb and a 250 Hz high-pass, create post-fader sends at -18 dB, automate them to -10 dB over the final four bars of every chorus, protect the lead vocal, render each chorus, and receipt every created, removed, routed, automated, and rendered object.';
const SHARED_VOCAL_FX_PROMPT = 'Move vocal delays and reverbs to shared buses while preserving balance.';

type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };
type RenderOfflineMock = (options: {
    durationBeats: number;
    onWarning?: (message: string) => void;
    sampleRate?: number;
    startBeat?: number;
    tailSeconds?: number;
}) => Promise<AudioBuffer>;

const providerPlan = [
    { name: 'removeDevice', arguments: { deviceId: 'device-bgv-high-reverb' } },
    { name: 'removeDevice', arguments: { deviceId: 'device-bgv-low-reverb' } },
    { name: 'createBus', arguments: { name: 'Backing Vocal Plate', binding: 'backing-vocal-plate' } },
    {
        name: 'addDevice',
        arguments: {
            trackId: '$backing-vocal-plate',
            deviceType: 'builtin-filter',
        },
    },
    {
        name: 'addDevice',
        arguments: {
            trackId: '$backing-vocal-plate',
            deviceType: 'dutch-oven',
        },
    },
    {
        name: 'addSend',
        arguments: {
            trackId: 'track-bgv-high',
            busId: '$backing-vocal-plate',
            level: 10 ** (-18 / 20),
            preFader: false,
        },
    },
    {
        name: 'addSend',
        arguments: {
            trackId: 'track-bgv-low',
            busId: '$backing-vocal-plate',
            level: 10 ** (-18 / 20),
            preFader: false,
        },
    },
    {
        name: 'automateSendRanges',
        arguments: {
            trackIds: ['track-bgv-high', 'track-bgv-low'],
            busId: '$backing-vocal-plate',
            sectionIds: ['section-chorus-one', 'section-chorus-two'],
            tailBars: 4,
            targetLevelDb: -10,
        },
    },
    {
        name: 'renderProjectSections',
        arguments: { sectionIds: ['section-chorus-one', 'section-chorus-two'] },
    },
] as const satisfies readonly ProviderPlanCall[];

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

function createProviderPlanFromUserMessage(userMessage: string): ProviderPlanCall[] {
    const match = /<project_context>\n(?<contextJson>.+)\n<\/project_context>/u.exec(userMessage);
    const contextJson = match?.groups?.contextJson;
    if (!contextJson) {
        throw new TypeError('Expected serialized project context in provider request');
    }
    const context: unknown = JSON.parse(contextJson);
    if (!isRecord(context) || typeof context.projectRevision !== 'string') {
        throw new TypeError('Expected revision-bound project context');
    }
    const capability = context.backingVocalPlateCapability;
    if (
        !isRecord(capability) ||
        capability.baseRevision !== context.projectRevision ||
        !isUnknownArray(capability.orderedToolPlan)
    ) {
        throw new TypeError('Expected revision-bound EX-01 capability');
    }
    const plan: ProviderPlanCall[] = [];
    for (const call of capability.orderedToolPlan) {
        if (!isRecord(call) || typeof call.name !== 'string' || !isRecord(call.arguments)) {
            throw new TypeError('Expected complete EX-01 ordered provider plan');
        }
        plan.push({ name: call.name, arguments: call.arguments });
    }
    if (plan.length === 0) {
        throw new TypeError('Expected non-empty EX-01 ordered provider plan');
    }
    return plan;
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

function useHostedFixture(): void {
    useHostedProviderFixture(createProviderPlanFromUserMessage);
}

function useHostedSharedVocalFxFixture(): void {
    useHostedProviderFixture(createSharedVocalFxProviderPlanFromUserMessage);
}

function useWebSharedVocalFxFixture(
    transform: (plan: ProviderPlanCall[]) => ProviderPlanCall[] = (plan) => plan
): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) =>
        Promise.resolve(JSON.stringify(transform(createSharedVocalFxProviderPlanFromUserMessage(userMessage))))
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

function getExpectedPlateTailSeconds(): number {
    const descriptor = getPluginById('dutch-oven');
    if (!descriptor?.tail) {
        throw new Error('Expected Dutch Oven tail declaration');
    }
    const parameterValues = Object.fromEntries(
        descriptor.parameters.map((parameter) => [parameter.id, parameter.defaultValue])
    );
    return getDeviceChainTailSeconds({
        devices: [
            {
                id: 'expected-dutch-oven',
                type: descriptor.id,
                parameterValues,
                bypassed: false,
            },
        ],
        tailForDeviceType: (deviceType) => getPluginById(deviceType)?.tail,
    }).seconds;
}

describe('backing-vocal plate workflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) =>
            Promise.resolve(JSON.stringify(createProviderPlanFromUserMessage(userMessage)))
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
        resetCrdtProjectAuthority('backing-vocal plate workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        registerHandlerMap(getAudioRenderingHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        clearAgentSectionRenderArtifacts();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        const leadVocal = createTrack('track-lead-vocal', 'Lead Vocal');
        addDevice(leadVocal, 'device-lead-vocal-reverb', 'builtin-reverb', 'Lead Plate');
        const backingHigh = createTrack('track-bgv-high', 'Backing Vocal High');
        addDevice(backingHigh, 'device-bgv-high-eq', 'builtin-eq', 'Backing High EQ');
        addDevice(backingHigh, 'device-bgv-high-reverb', 'builtin-reverb', 'Backing High Room');
        const backingLow = createTrack('track-bgv-low', 'Backing Vocal Low');
        addDevice(backingLow, 'device-bgv-low-reverb', 'proof-chamber', 'Backing Low Chamber');
        addDevice(backingLow, 'device-bgv-low-delay', 'builtin-delay', 'Backing Low Delay');
        const spokenWord = createTrack('track-spoken-word', 'Spoken Word');
        addDevice(spokenWord, 'device-spoken-reverb', 'builtin-reverb', 'Spoken Room');

        trackStore.set({
            tracks: [leadVocal, backingHigh, backingLow, spokenWord],
            selectedTrackId: null,
            ghostClips: [],
        });
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-verse-one', name: 'Verse One', startBeat: 0, endBeat: 16, color: '#ffffff' },
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 16, endBeat: 48, color: '#ffffff' },
                { id: 'section-verse-two', name: 'Verse Two', startBeat: 48, endBeat: 64, color: '#ffffff' },
                { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 64, endBeat: 96, color: '#ffffff' },
            ],
        });
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
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        clearAgentSectionRenderArtifacts();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('compiles EX-01 into one exact protected, dependency-ordered confirmation', async () => {
        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(createProviderPlanFromUserMessage(getWebLlmUserMessage())).toEqual(providerPlan);
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'removeDevice',
            'removeDevice',
            'createBus',
            'addDevice',
            'setDeviceParameter',
            'setDeviceParameter',
            'addDevice',
            'addSend',
            'addSend',
            'automateSendRanges',
            'renderProjectSections',
        ]);
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'track-lead-vocal', name: 'Lead Vocal' },
                { id: 'device-lead-vocal-reverb', name: 'Lead Vocal Lead Plate' },
                { id: 'track-spoken-word', name: 'Spoken Word' },
                { id: 'device-spoken-reverb', name: 'Spoken Word Spoken Room' },
                { id: 'device-bgv-low-delay', name: 'Backing Vocal Low Backing Low Delay' },
            ])
        );
    });

    it('publishes a schema-valid provider plan while keeping device identities application-owned', async () => {
        await sendChatMessage(PROMPT);

        const plan = createProviderPlanFromUserMessage(getWebLlmUserMessage());
        const schemas = new Map<string, { properties: Readonly<Record<string, unknown>> }>();
        for (const schema of getExecutableAppActionToolSchemas()) {
            schemas.set(schema.function.name, schema.function.parameters);
        }
        for (const call of plan) {
            const schema = schemas.get(call.name);
            expect(schema, `Missing provider schema for ${call.name}`).toBeDefined();
            expect(Object.keys(call.arguments).filter((key) => !(key in (schema?.properties ?? {})))).toEqual([]);
        }
        expect(plan.filter((call) => 'binding' in call.arguments).map((call) => call.name)).toEqual(['createBus']);
        expect(JSON.stringify(plan)).not.toContain('$backing-vocal-plate-filter');
    });

    it('includes every qualifier-named chorus while excluding the pre-chorus', async () => {
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-pre', name: 'Pre-Chorus', startBeat: 0, endBeat: 16, color: '#ffffff' },
                { id: 'section-one', name: 'Chorus One', startBeat: 16, endBeat: 48, color: '#ffffff' },
                { id: 'section-big', name: 'Big Chorus', startBeat: 48, endBeat: 80, color: '#ffffff' },
                { id: 'section-final', name: 'Final Chorus', startBeat: 80, endBeat: 112, color: '#ffffff' },
                { id: 'section-a', name: 'Chorus A', startBeat: 112, endBeat: 144, color: '#ffffff' },
            ],
        });

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        const renderAction = confirmation?.actions.find((action) => action.type === 'renderProjectSections');
        expect(renderAction?.type === 'renderProjectSections' ? renderAction.payload.sectionIds : []).toEqual([
            'section-one',
            'section-big',
            'section-final',
            'section-a',
        ]);
    });

    it('fails closed when a chorus-like section name cannot be classified', async () => {
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-one', name: 'Chorus One', startBeat: 16, endBeat: 48, color: '#ffffff' },
                { id: 'section-ambiguous', name: 'ChorusA', startBeat: 48, endBeat: 80, color: '#ffffff' },
            ],
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('resolves standard BV and BG Vox role labels into the complete backing-vocal set', async () => {
        const tracks = structuredClone(trackStore.value?.tracks ?? []);
        const high = tracks.find((track) => track.id === 'track-bgv-high');
        const low = tracks.find((track) => track.id === 'track-bgv-low');
        if (!high || !low) {
            throw new Error('Expected backing-vocal fixtures');
        }
        high.name = 'BV 1';
        low.name = 'BG Vox Low';
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(
            confirmation?.actions.filter((action) => action.type === 'addSend').map((action) => action.payload.trackId)
        ).toEqual(['track-bgv-high', 'track-bgv-low']);
    });

    it('fails closed when another vocal track has no unambiguous lead or backing role', async () => {
        const ambiguous = createTrack('track-vocal-double', 'Vocal Double');
        addDevice(ambiguous, 'device-vocal-double-reverb', 'builtin-reverb', 'Double Room');
        trackStore.set({
            tracks: [...(trackStore.value?.tracks ?? []), ambiguous],
            selectedTrackId: null,
            ghostClips: [],
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each([
        {
            name: 'omitted action',
            transform: (plan: Array<{ name: string; arguments: Record<string, unknown> }>) => plan.slice(0, -1),
        },
        {
            name: 'reordered actions',
            transform: (plan: Array<{ name: string; arguments: Record<string, unknown> }>) => [
                plan[1]!,
                plan[0]!,
                ...plan.slice(2),
            ],
        },
        {
            name: 'enlarged protected target',
            transform: (plan: Array<{ name: string; arguments: Record<string, unknown> }>) => [
                ...plan,
                { name: 'removeDevice', arguments: { deviceId: 'device-lead-vocal-reverb' } },
            ],
        },
        {
            name: 'changed bounded value',
            transform: (plan: Array<{ name: string; arguments: Record<string, unknown> }>) =>
                plan.map((call) =>
                    call.name === 'addSend' ? { ...call, arguments: { ...call.arguments, level: 0.5 } } : call
                ),
        },
    ])('rejects a provider plan with $name before confirmation or write', async ({ transform }) => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) => {
            const plan = createProviderPlanFromUserMessage(userMessage).map((call) => ({
                name: String(call.name),
                arguments: { ...call.arguments },
            }));
            return Promise.resolve(JSON.stringify(transform(plan)));
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
    });

    it('rejects more than sixteen chorus render jobs before confirmation', async () => {
        markerStore.set({
            markers: [],
            sections: Array.from({ length: 17 }, (_, index) => ({
                id: `section-chorus-${String(index + 1)}`,
                name: `Chorus ${String(index + 1)}`,
                startBeat: index * 32,
                endBeat: index * 32 + 32,
                color: '#ffffff',
            })),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('keeps the EX-01 render primitive unavailable outside the exact admitted workflow', async () => {
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(
            JSON.stringify([
                {
                    name: 'renderProjectSections',
                    arguments: { sectionIds: ['section-chorus-one'] },
                },
            ])
        );

        await sendChatMessage('Render Chorus One');

        expect(getConfirmationId()).toBe('');
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('normalizes the hosted provider plan from the same revision-bound capability', async () => {
        useHostedFixture();

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        const requestBody = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
        if (typeof requestBody !== 'string') {
            throw new TypeError('Expected one hosted provider request body');
        }
        expect(createProviderPlanFromUserMessage(getHostedUserMessage(requestBody))).toEqual(providerPlan);
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'removeDevice',
            'removeDevice',
            'createBus',
            'addDevice',
            'setDeviceParameter',
            'setDeviceParameter',
            'addDevice',
            'addSend',
            'addSend',
            'automateSendRanges',
            'renderProjectSections',
        ]);
    });

    it('invalidates a stale confirmation without project, render, receipt, or history effects', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-01 confirmation');
        }
        await executeAppAction({
            type: 'setTrackGain',
            payload: { trackId: 'track-bgv-high', gain: 0.75, expectedGain: 1 },
        });
        clearUndoHistory();

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toMatchObject({
            status: 'invalidated',
        });

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-bgv-high')?.gain).toBe(0.75);
        expect(trackStore.value?.tracks.some((track) => track.name === 'Backing Vocal Plate')).toBe(false);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
    });

    it('rolls back the complete batch when a later device runtime write fails', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-01 confirmation');
        }
        runtimeMocks.updateDeviceParam
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('filter cutoff runtime unavailable');
            });

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result).toMatchObject({ status: 'failed' });
        if (result.status !== 'failed') {
            throw new Error(`Expected failed confirmation, received ${result.status}`);
        }
        expect(result.reason).toContain('filter cutoff runtime unavailable');

        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(getPendingActionConfirmation(confirmation.id)).toMatchObject({
            status: 'failed',
            executedActions: [],
        });
    });

    it('reports a persistent partial render as committed with warning and keeps the group undoable', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-01 confirmation');
        }
        const renderAction = confirmation.actions.find((action) => action.type === 'renderProjectSections');
        if (renderAction?.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
            throw new Error('Expected materialized render jobs');
        }
        const successfulJob = renderAction.payload.jobs[0];
        const failedJob = renderAction.payload.jobs[1];
        if (!successfulJob || !failedJob) {
            throw new Error('Expected two materialized render jobs');
        }
        runtimeMocks.renderOffline.mockImplementation((options: { startBeat?: number }) => {
            if (options.startBeat === 64) {
                return Promise.reject(new Error('chorus two renderer unavailable'));
            }
            return Promise.resolve(createTestAudioBuffer());
        });

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(3);
        expect(getAgentSectionRenderArtifacts()).toEqual([
            expect.objectContaining({
                jobId: successfulJob.jobId,
                sectionId: 'section-chorus-one',
            }),
        ]);
        expect(getPendingActionConfirmation(confirmation.id)?.status).toBe('executed');
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(receipt?.content).toContain('The project change committed with a follow-up warning');
        expect(receipt?.content).toContain('chorus two renderer unavailable');
        expect(receipt?.content).toContain('Do not replay the confirmed project actions');
        expect(receipt?.content).toContain('Retry missing renders below');
        const receiptLines = receipt?.content.split('\n') ?? [];
        const renderReceiptIndex = receiptLines.findIndex((line) => line.startsWith('- **renderProjectSections**:'));
        const renderAffectedIds = receiptLines[renderReceiptIndex + 1];
        expect(renderAffectedIds).toContain(successfulJob.sectionId);
        expect(renderAffectedIds).toContain(successfulJob.jobId);
        expect(renderAffectedIds).not.toContain(failedJob.sectionId);
        expect(renderAffectedIds).not.toContain(failedJob.jobId);
        const partialRenderExecution = getPendingActionConfirmation(confirmation.id)?.executedActions.find(
            (execution) => execution.actionType === 'renderProjectSections'
        );
        expect(partialRenderExecution?.affectedIds).toContain(successfulJob.sectionId);
        expect(partialRenderExecution?.affectedIds).toContain(successfulJob.jobId);
        expect(partialRenderExecution?.affectedIds).not.toContain(failedJob.sectionId);
        expect(partialRenderExecution?.affectedIds).not.toContain(failedJob.jobId);
        expect(undoStore.value?.past).toHaveLength(11);

        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        const committedLanes = structuredClone(automationStore.value?.lanes ?? []);

        const failedRetry = await confirmPendingChatActions({ confirmationId: confirmation.id });
        expect(failedRetry.status).toBe('failed');
        if (failedRetry.status !== 'failed') {
            throw new Error(`Expected failed render retry, received ${failedRetry.status}`);
        }
        expect(failedRetry.reason).toContain('chorus two renderer unavailable');
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(4);
        expect(trackStore.value?.tracks).toEqual(committedTracks);
        expect(automationStore.value?.lanes).toEqual(committedLanes);
        expect(undoStore.value?.past).toHaveLength(11);
        expect(getPendingActionConfirmation(confirmation.id)).toMatchObject({
            status: 'executed',
            followUpStatus: 'retryable',
        });

        runtimeMocks.renderOffline.mockResolvedValue(createTestAudioBuffer());

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(5);
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual(
            renderAction.payload.jobs.map((job) => job.jobId)
        );
        expect(trackStore.value?.tracks).toEqual(committedTracks);
        expect(automationStore.value?.lanes).toEqual(committedLanes);
        expect(undoStore.value?.past).toHaveLength(11);
        expect(getPendingActionConfirmation(confirmation.id)).toMatchObject({
            status: 'executed',
            error: null,
        });
        const completedReceipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(completedReceipt?.content).toContain(
            'Missing section render artifacts completed without replaying project actions'
        );
        const completedReceiptLines = completedReceipt?.content.split('\n') ?? [];
        const completedRenderReceiptIndex = completedReceiptLines.findIndex((line) =>
            line.startsWith('- **renderProjectSections**:')
        );
        const completedRenderAffectedIds = completedReceiptLines[completedRenderReceiptIndex + 1];
        expect(completedRenderAffectedIds).toContain(failedJob.sectionId);
        expect(completedRenderAffectedIds).toContain(failedJob.jobId);
        const completedRenderExecution = getPendingActionConfirmation(confirmation.id)?.executedActions.find(
            (execution) => execution.actionType === 'renderProjectSections'
        );
        expect(completedRenderExecution?.affectedIds).toContain(failedJob.sectionId);
        expect(completedRenderExecution?.affectedIds).toContain(failedJob.jobId);
        expect(completedReceipt?.content).not.toContain('Do not replay the confirmed project actions');

        await undo();
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(11);
    });

    it('keeps the whole undo and redo group retryable across collaborator lane and freeze conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-01 confirmation');
        }
        const createBusAction = confirmation.actions.find((action) => action.type === 'createBus');
        const renderAction = confirmation.actions.find((action) => action.type === 'renderProjectSections');
        if (
            createBusAction?.type !== 'createBus' ||
            !createBusAction.payload.busId ||
            renderAction?.type !== 'renderProjectSections' ||
            !renderAction.payload.jobs
        ) {
            throw new Error('Expected materialized bus and render jobs');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        const busId = createBusAction.payload.busId;
        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        const committedLanes = structuredClone(automationStore.value?.lanes ?? []);
        const editedLanes = structuredClone(committedLanes);
        const firstLane = editedLanes[0];
        if (!firstLane || !firstLane.points[1]) {
            throw new Error('Expected first send lane');
        }
        firstLane.points[1].value += 0.01;
        automationStore.set({ lanes: editedLanes });

        await undo();

        expect(trackStore.value?.tracks).toEqual(committedTracks);
        expect(automationStore.value?.lanes).toEqual(editedLanes);
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual(
            renderAction.payload.jobs.map((job) => job.jobId)
        );
        expect(undoStore.value?.past).toHaveLength(11);
        expect(undoStore.value?.future).toEqual([]);

        automationStore.set({ lanes: committedLanes });
        await undo();
        expect(trackStore.value?.tracks.some((track) => track.id === busId)).toBe(false);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(11);

        const frozenTracks = structuredClone(trackStore.value?.tracks ?? []).map((track) =>
            track.id === 'track-bgv-high' ? { ...track, frozen: true } : track
        );
        trackStore.set({ tracks: frozenTracks, selectedTrackId: null, ghostClips: [] });
        const renderCallCountBeforeConflict = runtimeMocks.renderOffline.mock.calls.length;

        await redo();

        expect(trackStore.value?.tracks).toEqual(frozenTracks);
        expect(trackStore.value?.tracks.some((track) => track.id === busId)).toBe(false);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(renderCallCountBeforeConflict);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(11);

        trackStore.set({
            tracks: frozenTracks.map((track) => (track.id === 'track-bgv-high' ? { ...track, frozen: false } : track)),
            selectedTrackId: null,
            ghostClips: [],
        });
        await redo();
        expect(trackStore.value?.tracks.filter((track) => track.id === busId)).toHaveLength(1);
        expect(automationStore.value?.lanes).toHaveLength(2);
        expect(getAgentSectionRenderArtifacts()).toHaveLength(2);
        expect(undoStore.value?.past).toHaveLength(11);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('atomically commits the workflow, renders both choruses, and groups undo and redo', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected EX-01 confirmation');
        }
        const createBusAction = confirmation.actions.find((action) => action.type === 'createBus');
        const filterAction = confirmation.actions.find(
            (action) => action.type === 'addDevice' && action.payload.deviceType === 'builtin-filter'
        );
        const plateAction = confirmation.actions.find(
            (action) => action.type === 'addDevice' && action.payload.deviceType === 'dutch-oven'
        );
        const automationAction = confirmation.actions.find((action) => action.type === 'automateSendRanges');
        const renderAction = confirmation.actions.find((action) => action.type === 'renderProjectSections');
        if (
            createBusAction?.type !== 'createBus' ||
            !createBusAction.payload.busId ||
            filterAction?.type !== 'addDevice' ||
            !filterAction.payload.deviceId ||
            plateAction?.type !== 'addDevice' ||
            !plateAction.payload.deviceId ||
            automationAction?.type !== 'automateSendRanges' ||
            !automationAction.payload.expectedTracks ||
            !automationAction.payload.ranges ||
            renderAction?.type !== 'renderProjectSections' ||
            !renderAction.payload.jobs
        ) {
            throw new Error('Expected fully materialized EX-01 action batch');
        }
        const busId = createBusAction.payload.busId;
        const filterDeviceId = filterAction.payload.deviceId;
        const plateDeviceId = plateAction.payload.deviceId;
        const firstRenderJob = renderAction.payload.jobs[0];
        const secondRenderJob = renderAction.payload.jobs[1];
        if (!firstRenderJob || !secondRenderJob) {
            throw new Error('Expected two materialized render jobs');
        }
        const renderJobs = [firstRenderJob, secondRenderJob] as const;
        const expectedRenderTailSeconds = getExpectedPlateTailSeconds();
        const laneIds = [
            `auto-send-track-bgv-high-${encodeURIComponent(busId)}`,
            `auto-send-track-bgv-low-${encodeURIComponent(busId)}`,
        ];

        expect(confirmation.risk).toEqual({
            level: 'external-effect',
            reason: 'This action affects resources or sessions outside the current project.',
        });
        expect(confirmation.protectedUnchanged).toEqual([
            { id: 'track-lead-vocal', name: 'Lead Vocal' },
            { id: 'device-lead-vocal-reverb', name: 'Lead Vocal Lead Plate' },
            { id: 'device-bgv-high-eq', name: 'Backing Vocal High Backing High EQ' },
            { id: 'device-bgv-low-delay', name: 'Backing Vocal Low Backing Low Delay' },
            { id: 'track-spoken-word', name: 'Spoken Word' },
            { id: 'device-spoken-reverb', name: 'Spoken Word Spoken Room' },
        ]);
        expect(confirmation.affectedIds).toEqual(
            expect.arrayContaining([
                'device-bgv-high-reverb',
                'device-bgv-low-reverb',
                busId,
                filterDeviceId,
                plateDeviceId,
                'track-bgv-high',
                'track-bgv-low',
                ...laneIds,
                'section-chorus-one',
                'section-chorus-two',
                ...renderJobs.map((job) => job.jobId),
            ])
        );
        expect(confirmation.actionLabels).toEqual([
            'Remove device "Backing High Room" (device-bgv-high-reverb, builtin-reverb) from "Backing Vocal High" (track-bgv-high)',
            'Remove device "Backing Low Chamber" (device-bgv-low-reverb, proof-chamber) from "Backing Vocal Low" (track-bgv-low)',
            `Create bus "Backing Vocal Plate" (${busId})`,
            `Insert "Filter" (${filterDeviceId}, builtin-filter) on "Backing Vocal Plate" (${busId}) at the end of the chain`,
            `Set "Backing Vocal Plate" (${busId}) device "Filter" (${filterDeviceId}, builtin-filter) parameter "Type" (filter-type) from "Lowpass" (0) to "Highpass" (1)`,
            `Set "Backing Vocal Plate" (${busId}) device "Filter" (${filterDeviceId}, builtin-filter) parameter "Cutoff" (filter-cutoff) from 1000 Hz to 250 Hz`,
            `Insert "Dutch Oven" (${plateDeviceId}, dutch-oven) on "Backing Vocal Plate" (${busId}) after "Filter" (${filterDeviceId})`,
            `Create post-fader send from "Backing Vocal High" (track-bgv-high) to "Backing Vocal Plate" (${busId}) at -18 dB`,
            `Create post-fader send from "Backing Vocal Low" (track-bgv-low) to "Backing Vocal Plate" (${busId}) at -18 dB`,
            `Automate sends to "Backing Vocal Plate" (${busId}) over the final 4 bars: "Backing Vocal High" (track-bgv-high) -18 dB→-10 dB, "Backing Vocal Low" (track-bgv-low) -18 dB→-10 dB; "Chorus One" (section-chorus-one) ramp beats 32–48, "Chorus Two" (section-chorus-two) ramp beats 80–96; restore base levels at each section end`,
            `Render "Chorus One" (section-chorus-one) beats 16–48 as ${renderJobs[0].jobId} at 44100 Hz with ${String(expectedRenderTailSeconds)} s tail, "Chorus Two" (section-chorus-two) beats 64–96 as ${renderJobs[1].jobId} at 44100 Hz with ${String(expectedRenderTailSeconds)} s tail into session-owned artifacts; undo removes them and redo renders fresh artifacts`,
        ]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        const committedTracks = trackStore.value?.tracks ?? [];
        const committedBus = committedTracks.find((track) => track.id === busId);
        expect(committedTracks.find((track) => track.id === 'track-lead-vocal')).toEqual(originalTracks[0]);
        expect(committedTracks.find((track) => track.id === 'track-spoken-word')).toEqual(originalTracks[3]);
        expect(committedTracks.find((track) => track.id === 'track-bgv-high')?.devices).toEqual([
            originalTracks[1]?.devices[0],
        ]);
        expect(committedTracks.find((track) => track.id === 'track-bgv-low')?.devices).toEqual([
            originalTracks[2]?.devices[1],
        ]);
        expect(committedBus?.devices.map((device) => [device.id, device.type])).toEqual([
            [filterDeviceId, 'builtin-filter'],
            [plateDeviceId, 'dutch-oven'],
        ]);
        expect(committedBus?.devices[0]?.parameterValues).toMatchObject({
            'filter-type': 1,
            'filter-cutoff': 250,
        });
        const baseSendLevel = 10 ** (-18 / 20);
        expect(committedTracks.find((track) => track.id === 'track-bgv-high')?.sends).toContainEqual({
            busId,
            level: baseSendLevel,
            preFader: false,
        });
        expect(committedTracks.find((track) => track.id === 'track-bgv-low')?.sends).toContainEqual({
            busId,
            level: baseSendLevel,
            preFader: false,
        });
        expect(automationStore.value?.lanes).toEqual([
            expect.objectContaining({
                id: laneIds[0],
                trackId: 'track-bgv-high',
                parameterId: `send:${busId}`,
                points: [
                    { beat: 0, value: baseSendLevel, curve: 'step', tension: 0 },
                    { beat: 32, value: baseSendLevel, curve: 'linear', tension: 0 },
                    { beat: 48, value: 10 ** (-10 / 20), curve: 'step', tension: 0 },
                    { beat: 48, value: baseSendLevel, curve: 'step', tension: 0 },
                    { beat: 80, value: baseSendLevel, curve: 'linear', tension: 0 },
                    { beat: 96, value: 10 ** (-10 / 20), curve: 'step', tension: 0 },
                    { beat: 96, value: baseSendLevel, curve: 'step', tension: 0 },
                ],
            }),
            expect.objectContaining({
                id: laneIds[1],
                trackId: 'track-bgv-low',
                parameterId: `send:${busId}`,
            }),
        ]);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(2);
        const firstRenderInput = runtimeMocks.renderOffline.mock.calls[0]?.[0];
        const secondRenderInput = runtimeMocks.renderOffline.mock.calls[1]?.[0];
        expect(typeof firstRenderInput?.onWarning).toBe('function');
        expect(typeof secondRenderInput?.onWarning).toBe('function');
        expect(firstRenderInput).toMatchObject({
            durationBeats: 32,
            startBeat: 16,
            sampleRate: 44_100,
            tailSeconds: expectedRenderTailSeconds,
        });
        expect(secondRenderInput).toMatchObject({
            durationBeats: 32,
            startBeat: 64,
            sampleRate: 44_100,
            tailSeconds: expectedRenderTailSeconds,
        });
        expect(getAgentSectionRenderArtifacts()).toEqual([
            expect.objectContaining({
                owner: 'agent-section-render',
                retention: 'session',
                jobId: renderJobs[0].jobId,
                sectionId: 'section-chorus-one',
                startBeat: 16,
                endBeat: 48,
                sampleRate: 44_100,
                tailSeconds: expectedRenderTailSeconds,
                warnings: [],
            }),
            expect.objectContaining({
                owner: 'agent-section-render',
                retention: 'session',
                jobId: renderJobs[1].jobId,
                sectionId: 'section-chorus-two',
                startBeat: 64,
                endBeat: 96,
                sampleRate: 44_100,
                tailSeconds: expectedRenderTailSeconds,
                warnings: [],
            }),
        ]);
        const executed = getPendingActionConfirmation(confirmation.id);
        expect(executed?.executedActions).toHaveLength(11);
        for (const [index, action] of confirmation.actions.entries()) {
            expect(executed?.executedActions[index]).toEqual({
                actionType: action.type,
                label: confirmation.actionLabels[index],
                executionKind: 'project',
                affectedIds: getPlannedActionAffectedIds(action),
                outcome: 'committed',
            });
        }
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        for (const label of confirmation.actionLabels) {
            expect(receipt?.content).toContain(label);
        }
        for (const protectedObject of confirmation.protectedUnchanged) {
            expect(receipt?.content).toContain(`"${protectedObject.name}" (${protectedObject.id})`);
        }
        for (const job of renderJobs) {
            expect(receipt?.content).toContain(job.jobId);
        }
        expect(undoStore.value?.past).toHaveLength(11);

        await undo();
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(11);

        await redo();
        const redoneTracks = trackStore.value?.tracks ?? [];
        expect(redoneTracks).toHaveLength(5);
        expect(redoneTracks.filter((track) => track.id === busId)).toHaveLength(1);
        expect(redoneTracks.find((track) => track.id === busId)?.devices.map((device) => device.id)).toEqual([
            filterDeviceId,
            plateDeviceId,
        ]);
        expect(automationStore.value?.lanes.map((lane) => lane.id)).toEqual(laneIds);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(4);
        expect(getAgentSectionRenderArtifacts()).toHaveLength(2);
        expect(undoStore.value?.past).toHaveLength(11);
        expect(undoStore.value?.future).toEqual([]);
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

    it.each(['mismatched delay settings', 'frozen vocal', 'ambiguous vocal role', 'unsupported vocal reverb'])(
        'fails closed for $0',
        async (condition) => {
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
            trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
            useWebSharedVocalFxFixture();

            await sendChatMessage(SHARED_VOCAL_FX_PROMPT);

            expect(getConfirmationId()).toBe('');
            expect(undoStore.value?.past).toEqual([]);
        }
    );

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
                `Create bus "Vocal Delay" (${delayBusId})`,
                `Create bus "Vocal Reverb" (${reverbBusId})`,
                `Create post-fader send from "Lead Vocal" (track-lead-vocal) to "Vocal Delay" (${delayBusId}) at -12.04 dB`,
                `Create post-fader send from "Backing Vocal High" (track-bgv-high) to "Vocal Reverb" (${reverbBusId}) at -3.52 dB`,
            ])
        );

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

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
        await confirmPendingChatActions({ confirmationId: confirmation.id });
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
