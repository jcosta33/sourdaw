import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    getPluginById,
    projectTrackToLiveStrip,
    runtimeGraphTopology,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
    ensureBusStrip,
    getDeviceChainTailSeconds,
    removeBusStrip,
    removeTrackStrip,
} from '#/modules/AudioEngine/useCases';
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
    commandTrackDefaultsPort,
    executeAppAction,
    getExecutableAppActionToolSchemas,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    captureUnownedProjectMutations,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
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
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';
import { sendChatMessage as sendChatMessageUseCase } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const PROMPT =
    'Remove reverbs from all backing vocals, create one shared plate bus with EQ before plate reverb and a 250 Hz high-pass, create post-fader sends at -18 dB, automate them to -10 dB over the final four bars of every chorus, protect the lead vocal, render each chorus, and receipt every created, removed, routed, automated, and rendered object.';
const PARAPHRASE =
    'Consolidate the backing-vocal reverbs onto a filtered shared plate, automate the chorus sends and render each chorus, without changing the lead vocal.';

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

function flushFixtureStorageOwner(key: string): void {
    const storage = fixtureStorageOwners.get(`root:${key}`);
    if (!storage) {
        throw new Error(`Expected fixture-owned ${key} storage adapter`);
    }
    storage.flushPendingUnscopedWrite();
}

function settleFixtureProjectWrites(): void {
    for (const key of ['tracks', 'markers', 'automation', 'transport']) {
        flushFixtureStorageOwner(key);
    }
}

function sendChatMessage(prompt: string) {
    settleFixtureProjectWrites();
    return sendChatMessageUseCase(prompt);
}

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
        connect: (dest: unknown) => dest,
        disconnect: () => undefined,
    });
    function AudioContextWithStereoPanner(this: unknown, options?: AudioContextOptions) {
        const base = new OriginalAudioContext(options);
        return Object.assign(base, {
            currentTime: 0,
            createStereoPanner: () => ({
                ...createNode(),
                pan: createAudioParam(0),
            }),
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
            createDelay: () => ({ ...createNode(), delayTime: createAudioParam(0) }),
            createConvolver: () => ({ ...createNode(), buffer: null, normalize: true }),
            createBuffer: (channels: number, length: number, sampleRate: number) => {
                const data = Array.from({ length: channels }, () => new Float32Array(length));
                return {
                    numberOfChannels: channels,
                    length,
                    sampleRate,
                    duration: length / sampleRate,
                    getChannelData: (channel: number) => data[channel]!,
                };
            },
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: AudioContextWithStereoPanner,
        writable: true,
    });
});

vi.hoisted(() => {
    class AudioWorkletNodeWithClosablePort {
        readonly parameters = new Map<string, AudioParam>();
        readonly port = {
            postMessage: (_message: unknown) => undefined,
            onmessage: null,
            close: () => undefined,
        };

        connect(destination: unknown): unknown {
            return destination;
        }

        disconnect(): void {}
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: AudioWorkletNodeWithClosablePort,
        writable: true,
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

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    runtimeMocks.addDeviceToStrip.mockImplementation(original.addDeviceToStrip);
    runtimeMocks.clearReportedLatency.mockImplementation(original.clearReportedLatency);
    runtimeMocks.ensureTrackStrip.mockImplementation(original.ensureTrackStrip);
    runtimeMocks.removeDeviceFromStrip.mockImplementation(original.removeDeviceFromStrip);
    runtimeMocks.setTrackGain.mockImplementation(original.setTrackGain);
    runtimeMocks.setTrackMute.mockImplementation(original.setTrackMute);
    runtimeMocks.setTrackOutput.mockImplementation(original.setTrackOutput);
    runtimeMocks.setTrackPan.mockImplementation(original.setTrackPan);
    runtimeMocks.setTrackSoloGate.mockImplementation(original.setTrackSoloGate);
    runtimeMocks.updateDeviceBypass.mockImplementation(original.updateDeviceBypass);
    runtimeMocks.updateDeviceParam.mockImplementation(original.updateDeviceParam);
    runtimeMocks.resolveToasterPadBinding.mockImplementation(original.resolveToasterPadBinding);
    return {
        ...original,
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
    };
});

vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    runtimeMocks.getAllSidechainRoutes.mockImplementation(original.getAllSidechainRoutes);
    runtimeMocks.removeSend.mockImplementation(original.removeSend);
    runtimeMocks.setSend.mockImplementation(original.setSend);
    runtimeMocks.wireSidechainRoutes.mockImplementation(original.wireSidechainRoutes);
    return {
        ...original,
        getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
        removeSend: runtimeMocks.removeSend,
        setSend: runtimeMocks.setSend,
        wireSidechainRoutes: runtimeMocks.wireSidechainRoutes,
    };
});

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

/**
 * `buildAgentContext` composes the planning message as labelled sections, each
 * one line of JSON under a `section_name:` line. This reads one of them.
 */
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

/**
 * The application-owned capability data and the revision it is bound to, as the
 * provider actually receives them: capabilities ride in `capability_schemas`
 * under `availableCapabilities`, itself a serialized string, and the revision
 * in `revision_and_selection`.
 */
function getProviderContext(userMessage: string): Record<string, unknown> {
    const schemas = getProviderSection(userMessage, 'capability_schemas');
    const available = schemas.availableCapabilities;
    if (typeof available !== 'string') {
        throw new TypeError('Expected serialized available capabilities in provider request');
    }
    const capabilities: unknown = JSON.parse(available);
    if (!isRecord(capabilities)) {
        throw new TypeError('Expected object-shaped available capabilities');
    }
    return { ...capabilities, projectRevision: getProviderSection(userMessage, 'revision_and_selection').revision };
}

function createProviderPlanFromUserMessage(userMessage: string): ProviderPlanCall[] {
    const context = getProviderContext(userMessage);
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

/**
 * Reverb device types EX-01 is allowed to remove from a backing-vocal track.
 * Mirrors `getBackingVocalPlatePromptScope`'s own list without importing it,
 * so this fixture proves the round trip rather than sharing an implementation
 * with the code it exercises.
 */
const REVERB_DEVICE_TYPES = new Set([
    'builtin-reverb',
    'builtin-convolution-reverb',
    'dutch-oven',
    'proof-chamber',
    'faust-zita-rev1-reverb',
    'faust-spring-reverb',
]);

/**
 * The batch's two section-bearing calls (`automateSendRanges` and
 * `renderProjectSections`) each get their sections' own beat bounds
 * materialized onto their payload before compilation (ranges and render jobs
 * respectively), so each contributes one application-computed target range
 * spanning every section it names — not the per-section automation tail, the
 * section's full extent. One range per such call, duplicates included.
 */
function getCallSectionIds(call: ProviderPlanCall): string[] {
    if (call.name !== 'automateSendRanges' && call.name !== 'renderProjectSections') {
        return [];
    }
    const sectionIds = call.arguments.sectionIds;
    return isUnknownArray(sectionIds) ? sectionIds.filter((id): id is string => typeof id === 'string') : [];
}

function getPlanTargetRanges(plan: readonly ProviderPlanCall[]): Array<{ startBeat: number; endBeat: number }> {
    const sectionsById = new Map((markerStore.value?.sections ?? []).map((section) => [section.id, section]));
    return plan.flatMap((call) => {
        const sectionIds = getCallSectionIds(call);
        const sections = sectionIds.flatMap((id) => {
            const section = sectionsById.get(id);
            return section ? [section] : [];
        });
        if (sections.length === 0) {
            return [];
        }
        return [
            {
                startBeat: Math.min(...sections.map((section) => section.startBeat)),
                endBeat: Math.max(...sections.map((section) => section.endBeat)),
            },
        ];
    });
}

/**
 * `planAgentRun` checks the provider's declared `plan.scope` against the
 * application's own computed scope (application-assigned bus/device ids
 * excluded from both sides). A conforming provider must declare the
 * pre-existing tracks and devices this batch actually touches: the backing-
 * vocal tracks it sends from and the reverb devices it removes, plus the
 * section span each section-bearing call resolves. Everything else
 * pre-existing is protected — every other track, and every device on a track
 * that isn't one of this batch's removed backing-vocal reverbs.
 */
function getExpectedCommandBatchScope(plan: readonly ProviderPlanCall[]): {
    targetIds: string[];
    targetRanges: Array<{ startBeat: number; endBeat: number }>;
    protectedTargetIds: string[];
    protectedRanges: [];
} {
    const backingVocalTrackIds = new Set(
        plan.filter((call) => call.name === 'addSend').map((call) => String(call.arguments.trackId))
    );
    const removedDeviceIds = new Set(
        plan.filter((call) => call.name === 'removeDevice').map((call) => String(call.arguments.deviceId))
    );
    const protectedTargetIds: string[] = [];
    for (const track of trackStore.value?.tracks ?? []) {
        if (!backingVocalTrackIds.has(track.id)) {
            protectedTargetIds.push(track.id);
        }
        for (const device of track.devices) {
            if (!backingVocalTrackIds.has(track.id) || !REVERB_DEVICE_TYPES.has(device.type)) {
                protectedTargetIds.push(device.id);
            }
        }
    }
    return {
        targetIds: [...backingVocalTrackIds, ...removedDeviceIds],
        targetRanges: getPlanTargetRanges(plan),
        protectedTargetIds,
        protectedRanges: [],
    };
}

/**
 * The provider may no longer call domain actions directly: an ordered action
 * batch is proposed through one `command.batch.propose` call whose `commands`
 * carries the ordered domain calls. This wraps a fixture's plan the way a
 * conforming provider response must.
 */
function asCommandBatchProposal(plan: readonly ProviderPlanCall[]): ProviderPlanCall[] {
    const capabilityIds = [...new Set(plan.map((call) => call.name))];
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                commands: plan.map((call) => ({ name: call.name, arguments: call.arguments })),
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Execute the grounded command batch.',
                    constraints: [],
                    scope: getExpectedCommandBatchScope(plan),
                    capabilityIds,
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate the grounded command batch.'],
                    stoppingConditions: ['Stop if application validation fails.'],
                },
            },
        },
    ];
}

/**
 * A `command.batch.propose` call is only accepted once its command names were
 * disclosed by a prior `agent.catalog.discover` turn (`runApplicationOwnedToolLoop`
 * mixes reads and terminal calls in separate turns). This derives the discovery
 * request's `names` from a fixture's eventual final calls.
 */
function catalogDiscoveryPlan(finalCalls: readonly ProviderPlanCall[]): ProviderPlanCall[] {
    const domainNames = finalCalls.flatMap((call) => {
        if (call.name === 'selectWorkflowCapability') {
            return [];
        }
        if (call.name === 'command.batch.propose') {
            const commands = call.arguments.commands;
            return Array.isArray(commands)
                ? commands.flatMap((command) =>
                      isRecord(command) && typeof command.name === 'string' ? [command.name] : []
                  )
                : [];
        }
        return [call.name];
    });
    const names = [...new Set(domainNames)];
    return [{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }];
}

/**
 * Wraps a WebLLM fixture so the first provider turn discovers the command
 * catalog it needs and only the second turn returns the actual plan, matching
 * the two-turn contract `runApplicationOwnedToolLoop` enforces.
 */
function createTurnTrackedWebLlmResponder(
    buildFinalCalls: (userMessage: string) => ProviderPlanCall[]
): (systemPrompt: string, userMessage: string) => Promise<string> {
    let turn = 0;
    return (_systemPrompt, userMessage) => {
        turn += 1;
        const finalCalls = buildFinalCalls(userMessage);
        const response = turn === 1 ? catalogDiscoveryPlan(finalCalls) : finalCalls;
        return Promise.resolve(JSON.stringify(response));
    };
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

/** The hosted-provider equivalent of {@link createTurnTrackedWebLlmResponder}. */
function createTurnTrackedHostedResponder(
    buildFinalCalls: (userMessage: string) => ProviderPlanCall[]
): (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> {
    let turn = 0;
    return (_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        turn += 1;
        const finalCalls = buildFinalCalls(getHostedUserMessage(init.body));
        return Promise.resolve(toolCallsResponse(turn === 1 ? catalogDiscoveryPlan(finalCalls) : finalCalls));
    };
}

function useHostedProviderFixture(createPlan: (userMessage: string) => ProviderPlanCall[]): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation(
        createTurnTrackedHostedResponder((userMessage) =>
            withWorkflowCapabilitySelection('backing-vocal-plate', asCommandBatchProposal(createPlan(userMessage)))
        )
    );
}

function useHostedFixture(): void {
    useHostedProviderFixture(createProviderPlanFromUserMessage);
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

function projectFixtureTracksToLiveStrips(trackIds: readonly string[]): void {
    for (const trackId of trackIds) {
        const initialization = projectTrackToLiveStrip({ trackId });
        if (!initialization || initialization.acceptance !== 'accepted' || initialization.application !== 'applied') {
            throw new Error(
                `Expected live strip initialization for ${trackId}: ${initialization?.reason ?? 'no runtime outcome'}`
            );
        }
    }
}

function removeFixtureRuntimeStrips(tracks: readonly Track[]): void {
    for (const track of tracks) {
        if (track.kind === 'bus') {
            removeBusStrip(track.id);
        } else {
            removeTrackStrip(track.id);
        }
    }
}

function rebuildFixtureRuntimeFromProject(): void {
    const tracks = trackStore.value?.tracks ?? [];
    removeFixtureRuntimeStrips(tracks);
    projectFixtureTracksToLiveStrips(tracks.map((track) => track.id));
}

describe('backing-vocal plate workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.generateWebLlmCompletion.mockImplementation(
            createTurnTrackedWebLlmResponder((userMessage) =>
                withWorkflowCapabilitySelection(
                    'backing-vocal-plate',
                    asCommandBatchProposal(createProviderPlanFromUserMessage(userMessage))
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
        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        clearAgentSectionRenderArtifacts();
        setArrangementEventBus({
            emit: (event, payload) => {
                if (event === 'track.added' && 'trackId' in payload) {
                    if (payload.kind === 'bus') {
                        ensureBusStrip(payload.trackId);
                    } else {
                        runtimeMocks.ensureTrackStrip(payload.trackId);
                    }
                }
                return Promise.resolve();
            },
        });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
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
        flushFixtureStorageOwner('tracks');
        projectFixtureTracksToLiveStrips([leadVocal, backingHigh, backingLow, spokenWord].map((track) => track.id));
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

    afterEach(async () => {
        removeFixtureRuntimeStrips(trackStore.value?.tracks ?? []);
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        clearAiHistory();
        clearPendingActionConfirmations();
        clearAgentSectionRenderArtifacts();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('settles the fixture-owned marker, automation, and transport writes before proposal capture', () => {
        const unownedMutationBaseline = captureUnownedProjectMutations();
        const documentBeforeFlush = getCrdtDoc<Record<string, unknown>>('root') ?? {};

        expect(documentBeforeFlush).toHaveProperty('tracks');
        expect(documentBeforeFlush).not.toHaveProperty('markers');
        expect(documentBeforeFlush).not.toHaveProperty('automation');
        expect(documentBeforeFlush).not.toHaveProperty('transport');

        settleFixtureProjectWrites();

        const documentAfterFlush = getCrdtDoc<Record<string, unknown>>('root') ?? {};
        expect(documentAfterFlush).toHaveProperty('markers');
        expect(documentAfterFlush).toHaveProperty('automation');
        expect(documentAfterFlush).toHaveProperty('transport');
        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline + 3);
    });

    it('routes a semantic paraphrase to the backing-vocal plate capability', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(getConfirmationId()).not.toBe('');
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
        runtimeMocks.generateWebLlmCompletion.mockImplementation(
            createTurnTrackedWebLlmResponder((userMessage) => {
                const plan = createProviderPlanFromUserMessage(userMessage).map((call) => ({
                    name: String(call.name),
                    arguments: { ...call.arguments },
                }));
                return withWorkflowCapabilitySelection('backing-vocal-plate', asCommandBatchProposal(transform(plan)));
            })
        );

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
        const renderAffectedIds = receiptLines
            .slice(renderReceiptIndex + 1)
            .find((line) => line.startsWith('  - Affected IDs:'));
        expect(renderAffectedIds).toBeDefined();
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
        const completedRenderAffectedIds = completedReceiptLines
            .slice(completedRenderReceiptIndex + 1)
            .find((line) => line.startsWith('  - Affected IDs:'));
        expect(completedRenderAffectedIds).toBeDefined();
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
        rebuildFixtureRuntimeFromProject();

        const frozenTracks = structuredClone(trackStore.value?.tracks ?? []).map((track) =>
            track.id === 'track-bgv-high' ? { ...track, frozen: true } : track
        );
        trackStore.set({ tracks: frozenTracks, selectedTrackId: null, ghostClips: [] });
        rebuildFixtureRuntimeFromProject();
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
        rebuildFixtureRuntimeFromProject();
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
            // The risk policy accumulates the authority reasons of every
            // operation in the batch, not just the highest-risk one.
            reason:
                'This action removes or replaces project content. ' +
                'This action changes project-wide timing, gain, recording, or signal routing. ' +
                'This action affects resources or sessions outside the current project.',
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
            const execution = executed?.executedActions[index];
            expect(execution).toMatchObject({
                actionType: action.type,
                label: confirmation.actionLabels[index],
                executionKind: 'project',
                affectedIds: getPlannedActionAffectedIds(action),
                outcome: 'committed',
                commandSchemaVersion: 1,
            });
            expect(typeof execution?.commandId).toBe('string');
            expect(execution?.applicationAssigned?.ids).toContainEqual({
                field: 'commandId',
                value: execution?.commandId,
            });
            const issuedAt = execution?.applicationAssigned?.timestamps.find(({ field }) => field === 'issuedAt');
            expect(typeof issuedAt?.value).toBe('number');
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
        rebuildFixtureRuntimeFromProject();

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
});
