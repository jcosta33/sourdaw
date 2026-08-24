import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    clearAgentSectionRenderArtifacts,
    getAgentSectionRenderArtifacts,
    getAudioRenderingHandlers,
} from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    getExecutableAppActionGroundingRules,
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
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

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

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    createHostedSemanticListPlanningResponder,
    createProviderSemanticListPlanningResponder,
    decodeHostedProviderUserMessage,
    decodeProviderPlanningFixtureContext,
    type ProviderScope,
    type SemanticCommandListItem,
} from './providerToolPlanningFixture';

const PROMPT = 'Create a Drum Bus and route Kick, Snare, and Hats into it, leaving Parallel Compression unchanged.';
const MF01_PROMPT = 'Route every drum track except the parallel-compression return into the Drum Bus.';
const MF01_PARAPHRASE =
    'Send the complete drum kit to the existing Drum Bus, but leave its parallel compression return routed as it is.';
const MF06_PROMPT = 'Create a sidechain from the kick to every bass compressor that supports sidechain input.';
const EX06_PROMPT = 'Reduce kick/bass masking without replacing either basic sound.';
const EX11_PROMPT =
    'Create a Drum Bus for Kick, Snare, and Hats, create a parallel-compression bus fed post-fader from the Drum Bus at -12 dB, keep Drum Room routed directly to Master, lower the parallel-compression bus by 1.5 dB, and render Verse One and Chorus One for comparison.';

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
        applyRuntimeGraphDelta: vi.fn<
            (delta: { edges: Array<{ sourceId: string; targetId: string }> }) => {
                acceptance: 'accepted';
                application: 'applied';
            }
        >(() => ({ acceptance: 'accepted', application: 'applied' })),
        backend,
        addDeviceToStrip: vi.fn(),
        clearReportedLatency: vi.fn(),
        ensureTrackStrip: vi.fn(),
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn<(systemPrompt: string, userMessage: string) => Promise<string>>(),
        getAllSidechainRoutes: vi.fn(() => []),
        removeDeviceFromStrip: vi.fn(),
        removeSend: vi.fn(),
        renderOffline: vi.fn(),
        resolveToasterPadBinding: vi.fn(() => null),
        setSend: vi.fn(),
        setTrackGain: vi.fn(),
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
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    applyRuntimeGraphDelta: runtimeMocks.applyRuntimeGraphDelta,
    clearReportedLatency: runtimeMocks.clearReportedLatency,
    ensureTrackStrip: runtimeMocks.ensureTrackStrip,
    removeDeviceFromStrip: runtimeMocks.removeDeviceFromStrip,
    renderOffline: runtimeMocks.renderOffline,
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackOutput: runtimeMocks.setTrackOutput,
    unwireSidechainRoute: runtimeMocks.unwireSidechainRoute,
    wireSidechainRoute: runtimeMocks.wireSidechainRoute,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
    removeSend: runtimeMocks.removeSend,
    setSend: runtimeMocks.setSend,
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
    const body = runtimeMocks.fetch.mock.calls.at(-1)?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };

function getProviderPlanScope(
    plan: readonly ProviderPlanCall[],
    protectedTargetIds: string[] = [],
    targetRanges: ProviderScope['targetRanges'] = []
): ProviderScope {
    const targetIds = [
        ...new Set(
            plan.flatMap((call) => {
                const trackId = call.arguments.trackId;
                return typeof trackId === 'string' && !trackId.startsWith('$') ? [trackId] : [];
            })
        ),
    ];
    return { targetIds, targetRanges, protectedTargetIds, protectedRanges: [] };
}

function getSemanticProviderPlanScope(
    plan: readonly ProviderPlanCall[],
    protectedTargetIds: string[] = []
): ProviderScope {
    const targetIds = [
        ...new Set(
            plan.flatMap((call) =>
                (getExecutableAppActionGroundingRules(call.name)?.targetRules ?? []).flatMap((targetRule) => {
                    const value = call.arguments[targetRule.argument];
                    if (typeof value === 'string' && !value.startsWith('$')) {
                        return [value];
                    }
                    return Array.isArray(value)
                        ? value.filter(
                              (candidate): candidate is string =>
                                  typeof candidate === 'string' && !candidate.startsWith('$')
                          )
                        : [];
                })
            )
        ),
    ];
    return { targetIds, targetRanges: [], protectedTargetIds, protectedRanges: [] };
}

function createSemanticProviderItems(plan: readonly ProviderPlanCall[]): SemanticCommandListItem[] {
    return plan.map((call, index) => {
        const id = `${call.name}-${String(index + 1)}`;
        const trackId = call.arguments.trackId;
        const dependsOn = index === 0 ? undefined : [`${plan[index - 1]!.name}-${String(index)}`];
        if (typeof trackId !== 'string' || trackId.startsWith('$')) {
            return { id, name: call.name, arguments: { ...call.arguments }, dependsOn };
        }
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
        if (track === undefined) {
            throw new TypeError(`Expected provider fixture track ${trackId}`);
        }
        const { trackId: _trackId, ...argumentsWithoutTrackId } = call.arguments;
        return {
            id,
            name: call.name,
            arguments: argumentsWithoutTrackId,
            selector: {
                targetArgument: 'trackId',
                entity: 'track',
                where: { name: track.name },
                quantity: { unit: 'targets', exactly: 1 },
            },
            dependsOn,
        };
    });
}

function useWebLlmPlanFixture(
    plan: readonly ProviderPlanCall[],
    scope: ProviderScope,
    workflowCapabilityId?: string
): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
        Promise.resolve(
            createProviderSemanticListPlanningResponder(
                createSemanticProviderItems(plan),
                scope,
                workflowCapabilityId
            )(userMessage)
        )
    );
}

function useHostedPlanFixture(
    plan: readonly ProviderPlanCall[],
    scope: ProviderScope,
    workflowCapabilityId?: string
): void {
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        const userMessage = getHostedUserMessage(init);
        return Promise.resolve(
            createHostedSemanticListPlanningResponder(
                createSemanticProviderItems(plan),
                scope,
                workflowCapabilityId
            )(userMessage)
        );
    });
}

function createCapabilityPlanResponse(
    userMessage: string,
    plan: readonly ProviderPlanCall[],
    scope: ProviderScope,
    workflowCapabilityId: string
): string {
    const commandNames = [...new Set(plan.map((call) => call.name))];
    if (!decodeProviderPlanningFixtureContext(userMessage).hasCommandCatalogReceipt) {
        return JSON.stringify([
            { name: 'agent.catalog.discover', arguments: { category: 'command', names: commandNames } },
        ]);
    }
    return JSON.stringify([
        { name: 'selectWorkflowCapability', arguments: { capabilityId: workflowCapabilityId } },
        {
            name: 'command.batch.propose',
            arguments: {
                commands: plan,
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Execute the application-owned workflow capability.',
                    constraints: [],
                    scope,
                    capabilityIds: commandNames,
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate the exact application-owned workflow plan.'],
                    stoppingConditions: ['Stop if application validation fails.'],
                },
            },
        },
    ]);
}

function createHostedProviderResponse(calls: string): Response {
    const plan = JSON.parse(calls) as ProviderPlanCall[];
    return new Response(
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
    );
}

function getHostedUserMessage(input: string | RequestInit | undefined): string {
    return decodeHostedProviderUserMessage(input);
}

function createEx11ProviderPlanFromUserMessage(userMessage: string) {
    const planningContext = decodeProviderPlanningFixtureContext(userMessage);
    const capability = planningContext.capabilityData.drumRenderComparisonCapability;
    if (
        !isRecord(capability) ||
        capability.baseRevision !== planningContext.revision ||
        !Array.isArray(capability.orderedToolPlan)
    ) {
        throw new TypeError('Expected revision-bound EX-11 capability');
    }
    return capability.orderedToolPlan.map((call) => {
        if (!isRecord(call) || typeof call.name !== 'string' || !isRecord(call.arguments)) {
            throw new TypeError('Expected complete EX-11 ordered provider plan');
        }
        return { name: call.name, arguments: call.arguments };
    });
}

function getEx11ProviderScope(userMessage: string, plan: readonly ProviderPlanCall[]): ProviderScope {
    const capability = decodeProviderPlanningFixtureContext(userMessage).capabilityData.drumRenderComparisonCapability;
    if (
        !isRecord(capability) ||
        !Array.isArray(capability.protectedObjects) ||
        !Array.isArray(capability.renderSections)
    ) {
        throw new TypeError('Expected complete EX-11 scope');
    }
    const protectedTargetIds = capability.protectedObjects.map((target) => {
        if (!isRecord(target) || typeof target.id !== 'string') {
            throw new TypeError('Expected exact EX-11 protected targets');
        }
        return target.id;
    });
    const targetRanges = capability.renderSections.map((section) => {
        if (!isRecord(section) || typeof section.startBeat !== 'number' || typeof section.endBeat !== 'number') {
            throw new TypeError('Expected exact EX-11 render ranges');
        }
        return { startBeat: section.startBeat, endBeat: section.endBeat };
    });
    return getProviderPlanScope(plan, protectedTargetIds, targetRanges);
}

function useEx11WebLlmFixture(): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) => {
        const plan = createEx11ProviderPlanFromUserMessage(userMessage);
        return Promise.resolve(
            createCapabilityPlanResponse(
                userMessage,
                plan,
                getEx11ProviderScope(userMessage, plan),
                'drum-render-comparison'
            )
        );
    });
}

function useEx11HostedFixture(
    transformPlan: (plan: Array<{ name: string; arguments: Record<string, unknown> }>) => Array<{
        name: string;
        arguments: Record<string, unknown>;
    }> = (plan) => plan,
    transformScope: (scope: ProviderScope) => ProviderScope = (scope) => scope
): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        const userMessage = getHostedUserMessage(init);
        const plan = transformPlan(createEx11ProviderPlanFromUserMessage(userMessage));
        return Promise.resolve(
            createHostedProviderResponse(
                createCapabilityPlanResponse(
                    userMessage,
                    plan,
                    transformScope(getEx11ProviderScope(userMessage, plan)),
                    'drum-render-comparison'
                )
            )
        );
    });
}

function setEx11Project(): void {
    trackStore.set({
        tracks: [
            createTrack('track-kick', 'Kick'),
            createTrack('track-snare', 'Snare'),
            createTrack('track-hats', 'Hats'),
            createTrack('track-room', 'Drum Room'),
            createTrack('track-bass', 'Bass DI'),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    markerStore.set({
        markers: [],
        sections: [
            { id: 'section-verse-one', name: 'Verse One', startBeat: 0, endBeat: 16, color: '#ffffff' },
            { id: 'section-chorus-one', name: 'Chorus One', startBeat: 16, endBeat: 48, color: '#ffffff' },
        ],
    });
}

function createMf01ProviderPlanFromUserMessage(userMessage: string) {
    const planningContext = decodeProviderPlanningFixtureContext(userMessage);
    const capability = planningContext.capabilityData.drumRoutingCapability;
    if (!isRecord(capability) || capability.actionType !== 'setTrackOutput') {
        throw new TypeError('Expected app-owned MF-01 capability');
    }
    if (planningContext.revision === null || capability.baseRevision !== planningContext.revision) {
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
        name: 'setTrackOutput',
        arguments: { trackId, outputId: bus.id },
    }));
}

function getMf01ProviderScope(userMessage: string, plan: readonly ProviderPlanCall[]): ProviderScope {
    const capability = decodeProviderPlanningFixtureContext(userMessage).capabilityData.drumRoutingCapability;
    if (
        !isRecord(capability) ||
        !isRecord(capability.protectedReturn) ||
        typeof capability.protectedReturn.id !== 'string'
    ) {
        throw new TypeError('Expected exact MF-01 protected return');
    }
    return getSemanticProviderPlanScope(plan, [capability.protectedReturn.id]);
}

function useMf01WebLlmFixture(): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) => {
        const plan = createMf01ProviderPlanFromUserMessage(userMessage);
        return Promise.resolve(
            createProviderSemanticListPlanningResponder(
                createSemanticProviderItems(plan),
                getMf01ProviderScope(userMessage, plan),
                'drum-routing'
            )(userMessage)
        );
    });
}

function useMf01HostedFixture({ reverse = false }: { reverse?: boolean } = {}): void {
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        const userMessage = getHostedUserMessage(init);
        const plan = createMf01ProviderPlanFromUserMessage(userMessage);
        if (reverse) {
            plan.reverse();
        }
        return Promise.resolve(
            createHostedSemanticListPlanningResponder(
                createSemanticProviderItems(plan),
                getMf01ProviderScope(userMessage, plan),
                'drum-routing'
            )(userMessage)
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

type Mf06ProviderPlan = { items: SemanticCommandListItem[]; scope: ProviderScope };

function expectSidechainRoutingCapability(userMessage: string | undefined): void {
    if (userMessage === undefined) {
        throw new TypeError('Expected provider planning request');
    }
    expect(decodeProviderPlanningFixtureContext(userMessage).capabilityData.sidechainRoutingCapability).toMatchObject({
        actionType: 'addSidechainRoute',
    });
}

function createMf06ProviderPlanFromUserMessage(userMessage: string): Mf06ProviderPlan {
    const planningContext = decodeProviderPlanningFixtureContext(userMessage);
    const capability = planningContext.capabilityData.sidechainRoutingCapability;
    if (!isRecord(capability) || capability.actionType !== 'addSidechainRoute') {
        throw new TypeError('Expected app-owned MF-06 capability');
    }
    if (planningContext.revision === null || capability.baseRevision !== planningContext.revision) {
        throw new TypeError('Expected revision-bound MF-06 capability');
    }
    const source = capability.source;
    const allowedAction = capability.allowedAction;
    const targets = capability.targets;
    const protectedTargets = capability.protectedTargets;
    if (
        !isRecord(source) ||
        typeof source.trackId !== 'string' ||
        !isRecord(allowedAction) ||
        allowedAction.type !== 'addSidechainRoute' ||
        !Array.isArray(allowedAction.exactRoutes) ||
        !Array.isArray(targets) ||
        !Array.isArray(protectedTargets)
    ) {
        throw new TypeError('Expected exact MF-06 route capability');
    }
    const sourceTrackId = source.trackId;

    const targetsByDeviceId = new Map<string, { trackId: string; deviceName: string; deviceType: string }>();
    const targetTrackIds = new Set<string>();
    for (const target of targets) {
        if (
            !isRecord(target) ||
            typeof target.deviceId !== 'string' ||
            typeof target.trackId !== 'string' ||
            typeof target.deviceName !== 'string' ||
            typeof target.deviceType !== 'string' ||
            targetsByDeviceId.has(target.deviceId)
        ) {
            throw new TypeError('Expected unique semantic MF-06 targets');
        }
        targetsByDeviceId.set(target.deviceId, {
            trackId: target.trackId,
            deviceName: target.deviceName,
            deviceType: target.deviceType,
        });
        targetTrackIds.add(target.trackId);
    }

    const targetIds: string[] = [];
    const items = allowedAction.exactRoutes.map((route, index): SemanticCommandListItem => {
        if (
            !isRecord(route) ||
            route.sourceTrackId !== sourceTrackId ||
            typeof route.targetTrackId !== 'string' ||
            typeof route.targetDeviceId !== 'string'
        ) {
            throw new TypeError('Expected MF-06 routes to match the app-owned source');
        }
        const target = targetsByDeviceId.get(route.targetDeviceId);
        if (
            target === undefined ||
            target.trackId !== route.targetTrackId ||
            targetIds.includes(route.targetDeviceId)
        ) {
            throw new TypeError('Expected MF-06 routes to match capability-filtered target devices');
        }
        for (const targetId of [target.trackId, sourceTrackId, route.targetDeviceId]) {
            if (!targetIds.includes(targetId)) {
                targetIds.push(targetId);
            }
        }
        return {
            id: `sidechain-route-${String(index + 1)}`,
            name: 'addSidechainRoute',
            arguments: { sourceTrackId, targetTrackId: target.trackId },
            selector: {
                targetArgument: 'targetDeviceId',
                entity: 'device',
                where: { name: target.deviceName, trackId: target.trackId, type: target.deviceType },
                quantity: { unit: 'targets', exactly: 1 },
            },
        };
    });
    if (targetIds.length !== targetsByDeviceId.size + targetTrackIds.size + 1) {
        throw new TypeError('Expected complete MF-06 capability target ordering');
    }

    const protectedTargetIds = protectedTargets.map((target) => {
        if (!isRecord(target) || typeof target.id !== 'string' || typeof target.name !== 'string') {
            throw new TypeError('Expected exact MF-06 protected target scope');
        }
        return target.id;
    });
    return {
        items,
        scope: { targetIds, targetRanges: [], protectedTargetIds, protectedRanges: [] },
    };
}

function useMf06WebLlmFixture(transform: (items: SemanticCommandListItem[]) => void = () => undefined): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) => {
        const plan = createMf06ProviderPlanFromUserMessage(userMessage);
        transform(plan.items);
        return Promise.resolve(createProviderSemanticListPlanningResponder(plan.items, plan.scope)(userMessage));
    });
}

function useMf06HostedFixture({ reverse = false }: { reverse?: boolean } = {}): void {
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        const userMessage = getHostedUserMessage(init);
        const plan = createMf06ProviderPlanFromUserMessage(userMessage);
        if (reverse) {
            plan.items.reverse();
            plan.scope.targetIds.reverse();
        }
        return Promise.resolve(createHostedSemanticListPlanningResponder(plan.items, plan.scope)(userMessage));
    });
}

describe('drum bus prompt workflow', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        runtimeMocks.applyRuntimeGraphDelta.mockReset();
        runtimeMocks.applyRuntimeGraphDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.renderOffline.mockResolvedValue(createTestAudioBuffer());
        const providerScope = getProviderPlanScope(providerPlan, ['track-parallel']);
        useWebLlmPlanFixture(providerPlan, providerScope);
        useHostedPlanFixture(providerPlan, providerScope);
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('drum bus prompt workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAudioRenderingHandlers());
        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        clearAgentSectionRenderArtifacts();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        sidechainStore.set({ routes: [] });
        markerStore.set({ markers: [], sections: [] });
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

    afterEach(async () => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        clearAiHistory();
        clearPendingActionConfirmations();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        resetAiWorkflowCommandPreflightFixture();
        clearAgentSectionRenderArtifacts();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        sidechainStore.set({ routes: [] });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds EX-11 into the dependency-ordered drum, parallel, gain, and render batch', async () => {
        setEx11Project();
        useEx11WebLlmFixture();
        const roomBefore = structuredClone(getTrack('track-room'));
        const bassBefore = structuredClone(getTrack('track-bass'));

        await sendChatMessage(EX11_PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error(
                `Expected EX-11 confirmation: ${JSON.stringify(chatStore.value?.messages.at(-1) ?? 'missing')}`
            );
        }
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'createBus',
            'setTrackOutput',
            'setTrackOutput',
            'setTrackOutput',
            'createBus',
            'addDevice',
            'addSend',
            'setTrackGain',
            'renderProjectSections',
        ]);
        const drumBusAction = confirmation?.actions[0];
        const parallelBusAction = confirmation?.actions[4];
        const compressorAction = confirmation?.actions[5];
        if (
            drumBusAction?.type !== 'createBus' ||
            !drumBusAction.payload.busId ||
            parallelBusAction?.type !== 'createBus' ||
            !parallelBusAction.payload.busId ||
            compressorAction?.type !== 'addDevice' ||
            !compressorAction.payload.deviceId
        ) {
            throw new Error('Expected application-owned EX-11 bus and device identities');
        }
        const drumBusId = drumBusAction.payload.busId;
        const parallelBusId = parallelBusAction.payload.busId;
        const compressorDeviceId = compressorAction.payload.deviceId;
        const targetGain = 10 ** (-1.5 / 20);
        const sendLevel = 10 ** (-12 / 20);
        expect(confirmation?.actions).toEqual([
            {
                type: 'createBus',
                payload: {
                    name: 'Drum Bus',
                    busId: drumBusId,
                    initialGain: 1,
                    expectedAbsentTrackNames: ['Drum Bus', 'Parallel Compression'],
                    expectedTrackOutputs: [{ trackId: 'track-room', outputId: 'master' }],
                },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-kick', outputId: drumBusId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-snare', outputId: drumBusId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-hats', outputId: drumBusId, expectedOutputId: 'master' },
            },
            {
                type: 'createBus',
                payload: { name: 'Parallel Compression', busId: parallelBusId, initialGain: 1 },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: parallelBusId,
                    deviceType: 'builtin-compressor',
                    deviceId: compressorDeviceId,
                    expectedDeviceIds: [],
                    expectedFrozen: false,
                },
            },
            {
                type: 'addSend',
                payload: {
                    trackId: drumBusId,
                    busId: parallelBusId,
                    level: sendLevel,
                    preFader: false,
                    expectedAbsent: true,
                },
            },
            {
                type: 'setTrackGain',
                payload: { trackId: parallelBusId, gain: targetGain, expectedGain: 1 },
            },
            {
                type: 'renderProjectSections',
                payload: {
                    sectionIds: ['section-verse-one', 'section-chorus-one'],
                    jobs: [
                        expect.objectContaining({
                            sectionId: 'section-verse-one',
                            sectionName: 'Verse One',
                            startBeat: 0,
                            endBeat: 16,
                            sampleRate: 44_100,
                            tailSeconds: 0,
                        }),
                        expect.objectContaining({
                            sectionId: 'section-chorus-one',
                            sectionName: 'Chorus One',
                            startBeat: 16,
                            endBeat: 48,
                            sampleRate: 44_100,
                            tailSeconds: 0,
                        }),
                    ],
                },
            },
        ]);
        expect(confirmation?.protectedUnchanged).toContainEqual({
            id: 'track-room',
            name: 'Drum Room direct-to-Master route',
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(`Create bus "Drum Bus" (${drumBusId}) at unity gain`);
        expect(proposal?.content).toContain(`Create post-fader send from "Drum Bus" (${drumBusId})`);
        expect(proposal?.content).toContain(`Set "Parallel Compression" (${parallelBusId}) fader from 0 dB to -1.5 dB`);
        expect(proposal?.content).toContain('Render "Verse One" (section-verse-one)');

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            drumBusId,
            drumBusId,
            drumBusId,
        ]);
        expect(getTrack(drumBusId).sends).toEqual([{ busId: parallelBusId, level: sendLevel, preFader: false }]);
        expect(getTrack(parallelBusId)).toMatchObject({
            gain: targetGain,
            devices: [{ id: compressorDeviceId, type: 'builtin-compressor' }],
        });
        expect(getTrack('track-room')).toEqual(roomBefore);
        expect(getTrack('track-bass')).toEqual(bassBefore);
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.sectionId)).toEqual([
            'section-verse-one',
            'section-chorus-one',
        ]);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(2);

        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain(`Create post-fader send from "Drum Bus" (${drumBusId})`);
        expect(receipt?.content).toContain('Render "Verse One" (section-verse-one)');
        expect(receipt?.content).toContain('Protected unchanged: "Drum Room direct-to-Master route" (track-room)');
        expect(receipt?.content).toContain('Outcome: committed');

        await undo();
        expect(trackStore.value?.tracks.some((track) => track.id === drumBusId || track.id === parallelBusId)).toBe(
            false
        );
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
        ]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(getTrack('track-room')).toEqual(roomBefore);

        await redo();
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            drumBusId,
            drumBusId,
            drumBusId,
        ]);
        expect(getTrack(parallelBusId).gain).toBe(targetGain);
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.sectionId)).toEqual([
            'section-verse-one',
            'section-chorus-one',
        ]);
        expect(getTrack('track-room')).toEqual(roomBefore);
    });

    it('normalizes the hosted provider to the same semantic EX-11 batch', async () => {
        setEx11Project();
        useEx11HostedFixture();

        await sendChatMessage(
            'Build the close-drum and parallel buses, keep the room direct, trim the parallel return 1.5 dB, then render the first verse and chorus as a comparison.'
        );

        const hostedMessage = getHostedUserMessage(getHostedRequestBody());
        expect(hostedMessage).toContain('drumRenderComparisonCapability');
        expect(hostedMessage).toContain('track-room');
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'createBus',
            'setTrackOutput',
            'setTrackOutput',
            'setTrackOutput',
            'createBus',
            'addDevice',
            'addSend',
            'setTrackGain',
            'renderProjectSections',
        ]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.sectionId)).toEqual([
            'section-verse-one',
            'section-chorus-one',
        ]);
        expect(getTrack('track-room').outputId).toBe('master');
    });

    it('keeps grouped redo retryable when the protected room route changes after undo', async () => {
        setEx11Project();
        useEx11WebLlmFixture();
        await sendChatMessage(EX11_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error('Expected EX-11 confirmation');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        await undo();
        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === 'track-room' ? { ...track, outputId: 'track-bass' } : track
            ),
            selectedTrackId: null,
            ghostClips: [],
        });
        const collaboratorState = structuredClone(trackStore.value?.tracks ?? []);
        const futureBefore = structuredClone(undoStore.value?.future ?? []);

        await redo();

        expect(trackStore.value?.tracks).toEqual(collaboratorState);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(2);
        expect(undoStore.value?.future).toEqual(futureBefore);
    });

    it('keeps grouped redo retryable when a collaborator claims a reserved bus name after undo', async () => {
        setEx11Project();
        useEx11WebLlmFixture();
        await sendChatMessage(EX11_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error('Expected EX-11 confirmation');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        await undo();
        const collaboratorBus = createTrack('track-collaborator-drum-bus', 'Drum Bus');
        trackStore.set({
            tracks: [...(trackStore.value?.tracks ?? []), collaboratorBus],
            selectedTrackId: null,
            ghostClips: [],
        });
        const collaboratorState = structuredClone(trackStore.value?.tracks ?? []);
        const futureBefore = structuredClone(undoStore.value?.future ?? []);

        await redo();

        expect(trackStore.value?.tracks).toEqual(collaboratorState);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(2);
        expect(undoStore.value?.future).toEqual(futureBefore);
    });

    it('rejects provider omission and target enlargement before confirmation', async () => {
        setEx11Project();
        useEx11HostedFixture((plan) => plan.filter((call) => call.name !== 'setTrackGain'));

        await sendChatMessage(EX11_PROMPT);

        expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId)).toBe(false);
        expect(trackStore.value?.tracks.some((track) => track.name === 'Drum Bus')).toBe(false);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);

        clearAiHistory();
        clearPendingActionConfirmations();
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        useEx11HostedFixture((plan) => [
            ...plan,
            { name: 'setTrackOutput', arguments: { trackId: 'track-bass', outputId: '$drum-bus' } },
        ]);

        await sendChatMessage(EX11_PROMPT);

        expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId)).toBe(false);
        expect(getTrack('track-bass').outputId).toBe('master');
    });

    it('rejects unavailable room and section scope before the provider can propose a write', async () => {
        setEx11Project();
        const room = getTrack('track-room');
        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === room.id ? { ...track, outputId: 'track-bass' } : track
            ),
            selectedTrackId: null,
            ghostClips: [],
        });
        useEx11WebLlmFixture();

        await sendChatMessage(EX11_PROMPT);

        expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId)).toBe(false);
        expect(getTrack('track-room').outputId).toBe('track-bass');
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('aborts the whole EX-11 batch when a routed target changes after confirmation', async () => {
        setEx11Project();
        useEx11WebLlmFixture();
        await sendChatMessage(EX11_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error('Expected EX-11 confirmation');
        }
        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === 'track-snare' ? { ...track, outputId: 'track-bass' } : track
            ),
            selectedTrackId: null,
            ghostClips: [],
        });
        const collaboratorState = structuredClone(trackStore.value?.tracks ?? []);

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).toBe('failed');
        expect(trackStore.value?.tracks).toEqual(collaboratorState);
        expect(trackStore.value?.tracks.some((track) => track.name === 'Drum Bus')).toBe(false);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('receipts a partial comparison render as committed with warning and keeps the group undoable', async () => {
        setEx11Project();
        useEx11WebLlmFixture();
        await sendChatMessage(EX11_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error('Expected EX-11 confirmation');
        }
        runtimeMocks.renderOffline.mockImplementation((options: { startBeat?: number }) => {
            if (options.startBeat === 16) {
                return Promise.reject(new Error('comparison renderer unavailable'));
            }
            return Promise.resolve(createTestAudioBuffer());
        });

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(getAgentSectionRenderArtifacts()).toEqual([expect.objectContaining({ sectionId: 'section-verse-one' })]);
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(3);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(receipt?.content).toContain('The project change committed with a follow-up warning');
        expect(receipt?.content).toContain('comparison renderer unavailable');
        expect(receipt?.content).toContain('Do not replay the confirmed project actions');
        expect(undoStore.value?.past).toHaveLength(9);

        await undo();

        expect(trackStore.value?.tracks.some((track) => track.name === 'Drum Bus')).toBe(false);
        expect(trackStore.value?.tracks.some((track) => track.name === 'Parallel Compression')).toBe(false);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('keeps grouped undo retryable when a collaborator changes the parallel fader', async () => {
        setEx11Project();
        useEx11WebLlmFixture();
        await sendChatMessage(EX11_PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        if (!confirmation) {
            throw new Error('Expected EX-11 confirmation');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        const parallelAction = confirmation.actions.find(
            (action) => action.type === 'createBus' && action.payload.name === 'Parallel Compression'
        );
        if (parallelAction?.type !== 'createBus' || !parallelAction.payload.busId) {
            throw new Error('Expected EX-11 Parallel Compression identity');
        }
        const parallelBusId = parallelAction.payload.busId;
        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === parallelBusId ? { ...track, gain: 0.42 } : track
            ),
            selectedTrackId: null,
            ghostClips: [],
        });
        const collaboratorState = structuredClone(trackStore.value?.tracks ?? []);
        const artifactIds = getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId);

        await undo();

        expect(trackStore.value?.tracks).toEqual(collaboratorState);
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual(artifactIds);
        expect(undoStore.value?.past).toHaveLength(9);
        expect(undoStore.value?.future).toEqual([]);

        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === parallelBusId ? { ...track, gain: 10 ** (-1.5 / 20) } : track
            ),
            selectedTrackId: null,
            ghostClips: [],
        });
        await undo();
        expect(trackStore.value?.tracks.some((track) => track.id === parallelBusId)).toBe(false);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
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
        if (!confirmation) {
            throw new Error(
                `Expected protected routing confirmation: ${JSON.stringify(chatStore.value?.messages.at(-1) ?? 'missing')}`
            );
        }
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

    it('routes a semantic paraphrase to the complete drum-routing capability', async () => {
        setMf01Project();
        useMf01WebLlmFixture();
        await sendChatMessage(MF01_PARAPHRASE);
        expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId)).toBe(true);
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
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(4);
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
        useWebLlmPlanFixture(
            mf01ProviderPlan.slice(0, 3),
            getSemanticProviderPlanScope(mf01ProviderPlan.slice(0, 3), ['track-parallel']),
            'drum-routing'
        );

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
                    ? runtimeMocks.generateWebLlmCompletion.mock.calls.at(-1)?.[1]
                    : getHostedUserMessage(getHostedRequestBody());
            if (providerMessage === undefined) {
                throw new TypeError('Expected provider planning request');
            }
            const planningContext = decodeProviderPlanningFixtureContext(providerMessage);
            expect(planningContext.revision).not.toBeNull();
            const capability = planningContext.capabilityData.drumRoutingCapability;
            expect(capability).toMatchObject({
                baseRevision: planningContext.revision,
                actionType: 'setTrackOutput',
                bus: { id: 'bus-drums', name: 'Drum Bus' },
                protectedReturn: { id: 'track-parallel' },
                allowedAction: {
                    type: 'setTrackOutput',
                    exactTargetIds: ['track-kick', 'track-snare', 'track-hats', 'track-room'],
                },
            });
            expect(isRecord(capability) ? capability.candidateDrums : undefined).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: 'track-kick',
                        name: 'Kick',
                        kind: 'audio',
                        role: 'kick',
                        roleEvidence: 'canonical-name:kick',
                        currentOutputId: 'master',
                        frozen: false,
                        locked: false,
                    }),
                ])
            );
            expect(isRecord(capability) ? capability.protectedNonDrums : undefined).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: 'track-bass',
                        name: 'Bass DI',
                        kind: 'audio',
                        role: 'bass-instrument',
                    }),
                ])
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
        useWebLlmPlanFixture(plan, getProviderPlanScope(plan, ['track-parallel']), 'drum-routing');
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
            useWebLlmPlanFixture(
                mf01ProviderPlan,
                getProviderPlanScope(mf01ProviderPlan, ['track-parallel']),
                'drum-routing'
            );
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
        useMf01WebLlmFixture();
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
        useMf01WebLlmFixture();
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
        useMf01WebLlmFixture();
        runtimeMocks.applyRuntimeGraphDelta
            .mockReturnValueOnce({ acceptance: 'accepted', application: 'applied' })
            .mockImplementationOnce(() => {
                throw new Error('injected Snare route runtime failure');
            })
            .mockReturnValue({ acceptance: 'accepted', application: 'applied' });
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
            runtimeMocks.applyRuntimeGraphDelta.mock.calls.filter(([delta]) =>
                delta.edges.some((edge) => edge.sourceId === 'track-snare' && edge.targetId === 'bus-drums')
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
        useMf01WebLlmFixture();
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
        if (!confirmation) {
            throw new Error(
                `Expected MF-06 confirmation: ${JSON.stringify(chatStore.value?.messages.at(-1) ?? 'missing')}`
            );
        }
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
        const routeIds = sidechainStore.value?.routes.map((route) => route.id) ?? [];
        expect(routeIds).toHaveLength(3);
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
        const executedActions = getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions;
        for (const [index, routeId] of routeIds.entries()) {
            expect(executedActions?.[index]?.affectedIds).toContain(routeId);
            expect(receipt?.content).toContain(routeId);
        }
        expect(undoStore.value?.past).toHaveLength(3);

        await undo();
        expect(sidechainStore.value?.routes).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(3);

        await redo();
        expect(sidechainStore.value?.routes).toHaveLength(3);
        expect(undoStore.value?.past).toHaveLength(3);
    });

    it('reduces kick/bass masking without replacing either sound through the complete WebLLM workflow', async () => {
        setMf06Project();
        const originalTracks = structuredClone(trackStore.value?.tracks);
        useMf06WebLlmFixture();

        await sendChatMessage(EX06_PROMPT);

        const providerRequest = vi.mocked(generateWebLlmCompletion).mock.calls.at(-1)?.[1];
        expect(providerRequest).toContain(EX06_PROMPT);
        expectSidechainRoutingCapability(providerRequest);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(
            confirmation?.actions.flatMap((action) =>
                action.type === 'addSidechainRoute'
                    ? [[action.payload.sourceTrackId, action.payload.targetTrackId, action.payload.targetDeviceId]]
                    : []
            )
        ).toEqual([
            ['track-kick', 'track-bass-synth', 'device-bass-comp-a'],
            ['track-kick', 'track-bass-synth', 'device-bass-comp-b'],
            ['track-kick', 'track-bass-di', 'device-bass-di-comp'],
        ]);
        expect(confirmation).toMatchObject({
            risk: { level: 'authority-sensitive' },
            protectedUnchanged: [
                { id: 'device-bass-eq', name: 'Bass Synth Bass EQ' },
                { id: 'track-guitar', name: 'Guitar' },
            ],
        });
        expect(trackStore.value?.tracks).toEqual(originalTracks);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks).toEqual(originalTracks);
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
        const routeIds = sidechainStore.value?.routes.map((route) => route.id) ?? [];
        const executedActions = getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions;
        expect(routeIds).toHaveLength(3);
        for (const [index, routeId] of routeIds.entries()) {
            expect(executedActions?.[index]?.affectedIds).toContain(routeId);
            expect(receipt?.content).toContain(routeId);
        }

        await undo();
        expect(sidechainStore.value?.routes).toEqual([]);
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(undoStore.value?.future).toHaveLength(3);

        await redo();
        expect(sidechainStore.value?.routes).toHaveLength(3);
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(undoStore.value?.past).toHaveLength(3);
    });

    it('rejects a reordered hosted EX-06 compiler graph without a confirmation', async () => {
        setMf06Project();
        runtimeMocks.backend.value = 'cloud';
        useMf06HostedFixture({ reverse: true });

        await sendChatMessage(EX06_PROMPT);

        const userMessage = getHostedUserMessage(runtimeMocks.fetch.mock.calls.at(-1)?.[1]);
        expect(userMessage).toContain(EX06_PROMPT);
        expectSidechainRoutingCapability(userMessage);
        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(sidechainStore.value?.routes).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each(['omission', 'enlargement'] as const)(
        'rejects EX-06 provider %s without replacing sounds or leaving state residue',
        async (scenario) => {
            setMf06Project();
            const originalTracks = structuredClone(trackStore.value?.tracks);
            useMf06WebLlmFixture((plan) => {
                if (scenario === 'omission') {
                    plan.pop();
                    return;
                }
                plan.push({
                    id: 'sidechain-route-enlargement',
                    name: 'addSidechainRoute',
                    arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-guitar' },
                    selector: {
                        targetArgument: 'targetDeviceId',
                        entity: 'device',
                        where: {
                            name: 'Guitar Compressor',
                            trackId: 'track-guitar',
                            type: 'builtin-sidechain-compressor',
                        },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                });
            });

            await sendChatMessage(EX06_PROMPT);

            expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
            expect(trackStore.value?.tracks).toEqual(originalTracks);
            expect(sidechainStore.value?.routes).toEqual([]);
            expect(runtimeMocks.wireSidechainRoute).not.toHaveBeenCalled();
            expect(undoStore.value?.past).toEqual([]);
        }
    );

    it('rejects stale EX-06 routing atomically without a receipt or runtime prefix', async () => {
        setMf06Project();
        const originalTracks = structuredClone(trackStore.value?.tracks);
        useMf06WebLlmFixture();
        await sendChatMessage(EX06_PROMPT);
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
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(sidechainStore.value?.routes).toEqual([collaboratorRoute]);
        expect(runtimeMocks.wireSidechainRoute).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
    });

    it('rejects a reversed hosted MF-06 compiler graph without a confirmation', async () => {
        setMf06Project();
        runtimeMocks.backend.value = 'cloud';
        useMf06HostedFixture({ reverse: true });

        await sendChatMessage(MF06_PROMPT);

        expectSidechainRoutingCapability(getHostedUserMessage(getHostedRequestBody()));
        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(sidechainStore.value?.routes).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
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
                        id: 'sidechain-route-enlargement',
                        name: 'addSidechainRoute',
                        arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-guitar' },
                        selector: {
                            targetArgument: 'targetDeviceId',
                            entity: 'device',
                            where: {
                                name: 'Guitar Compressor',
                                trackId: 'track-guitar',
                                type: 'builtin-sidechain-compressor',
                            },
                            quantity: { unit: 'targets', exactly: 1 },
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
