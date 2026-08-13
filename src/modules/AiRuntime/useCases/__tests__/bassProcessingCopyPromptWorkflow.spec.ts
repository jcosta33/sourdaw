import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    adjustmentLayerStore,
    markerStore,
    trackStore,
    type AdjustmentLayer,
    type Track,
} from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { audioEngine, scheduleAdjustmentLayers } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
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
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const PROMPT =
    "Copy the bass processing from chorus one to chorus two while preserving chorus two's existing distortion automation.";
const PARAPHRASE =
    'Bring the first chorus bass-processing layers into the second chorus but keep its distortion automation untouched.';

const providerPlan = [
    {
        name: 'addAdjustmentRegion',
        arguments: {
            layerId: 'layer-bass-eq',
            startBeat: 48,
            endBeat: 64,
            blend: 0.75,
            fadeInBeats: 0.5,
            fadeOutBeats: 0.25,
        },
    },
    {
        name: 'addAdjustmentRegion',
        arguments: {
            layerId: 'layer-bass-compressor',
            startBeat: 48,
            endBeat: 64,
            blend: 1,
            fadeInBeats: 0,
            fadeOutBeats: 0,
        },
    },
] as const;

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'cloud' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn<(systemPrompt: string, userMessage: string) => Promise<string>>(),
        transformPlan: {
            value: (plan: Array<{ name: string; arguments: Record<string, unknown> }>) => plan,
        },
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getProjectContextFromUserMessage(userMessage: string): Record<string, unknown> {
    const match = /<project_context>\n([\s\S]+?)\n<\/project_context>/u.exec(userMessage);
    if (!match?.[1]) {
        throw new TypeError('Expected serialized project context');
    }
    const parsed: unknown = JSON.parse(match[1]);
    if (!isRecord(parsed)) {
        throw new TypeError('Expected project context object');
    }
    return parsed;
}

function createProviderPlanFromUserMessage(userMessage: string) {
    const context = getProjectContextFromUserMessage(userMessage);
    const capability = context.bassProcessingCopyCapability;
    if (
        !isRecord(capability) ||
        capability.actionType !== 'addAdjustmentRegion' ||
        !Array.isArray(capability.exactPlan)
    ) {
        throw new TypeError('Expected revision-bound EX-03 capability');
    }
    return capability.exactPlan.map((entry) => {
        if (!isRecord(entry)) {
            throw new TypeError('Expected EX-03 plan entry');
        }
        const { layerId, startBeat, endBeat, blend, fadeInBeats, fadeOutBeats } = entry;
        if (
            typeof layerId !== 'string' ||
            typeof startBeat !== 'number' ||
            typeof endBeat !== 'number' ||
            typeof blend !== 'number' ||
            typeof fadeInBeats !== 'number' ||
            typeof fadeOutBeats !== 'number'
        ) {
            throw new TypeError('Expected complete EX-03 plan entry');
        }
        return {
            name: 'addAdjustmentRegion',
            arguments: { layerId, startBeat, endBeat, blend, fadeInBeats, fadeOutBeats },
        };
    });
}

function getHostedUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    if (!isRecord(request) || !Array.isArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    const messages: unknown[] = request.messages;
    const userMessage = messages.find(
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
            'bass-processing-copy',
            runtimeMocks.transformPlan.value(createProviderPlanFromUserMessage(getHostedUserMessage(init.body)))
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

function getProviderVisibleRegionPlan(
    actions: NonNullable<ReturnType<typeof getPendingActionConfirmation>>['actions'] | undefined
) {
    return (actions ?? []).flatMap((action) => {
        if (action.type !== 'addAdjustmentRegion') {
            return [];
        }
        return [
            {
                layerId: action.payload.layerId,
                startBeat: action.payload.startBeat,
                endBeat: action.payload.endBeat,
                blend: action.payload.blend,
                fadeInBeats: action.payload.fadeInBeats,
                fadeOutBeats: action.payload.fadeOutBeats,
            },
        ];
    });
}

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

function createLayer(input: {
    id: string;
    name: string;
    effectType: AdjustmentLayer['effectType'];
    affectedTrackIds: string[];
    region: AdjustmentLayer['regions'][number];
    mix?: number;
}): AdjustmentLayer {
    return {
        id: input.id,
        name: input.name,
        effectType: input.effectType,
        parameters: [],
        affectedTrackIds: input.affectedTrackIds,
        insertionIndex: 0,
        regions: [input.region],
        enabled: true,
        mix: input.mix ?? 1,
        color: '#ffffff',
    };
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

describe('bass-processing section copy workflow', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        vi.spyOn(audioEngine, 'applyAdjustmentLayerTick').mockImplementation(() => undefined);
        vi.spyOn(audioEngine, 'resetAdjustmentLayers').mockImplementation(() => undefined);
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.transformPlan.value = (plan) => plan;
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(
                JSON.stringify(
                    withWorkflowCapabilitySelection(
                        'bass-processing-copy',
                        runtimeMocks.transformPlan.value(createProviderPlanFromUserMessage(userMessage))
                    )
                )
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
        resetCrdtProjectAuthority('bass-processing copy workflow test');
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

        const bass = createTrack('track-bass', 'Bass');
        bass.devices = [
            {
                id: 'device-bass-distortion',
                type: 'builtin-distortion',
                name: 'Bass Distortion',
                bypassed: false,
                parameterValues: { 'dist-drive': 0.4 },
            },
        ];
        const leadVocal = createTrack('track-lead-vocal', 'Lead Vocal');
        trackStore.set({ tracks: [bass, leadVocal], selectedTrackId: null, ghostClips: [] });
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-verse-one', name: 'Verse One', startBeat: 0, endBeat: 16, color: '#ffffff' },
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 16, endBeat: 32, color: '#ffffff' },
                { id: 'section-verse-two', name: 'Verse Two', startBeat: 32, endBeat: 48, color: '#ffffff' },
                { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 48, endBeat: 64, color: '#ffffff' },
            ],
        });
        adjustmentLayerStore.set({
            layers: [
                createLayer({
                    id: 'layer-bass-eq',
                    name: 'Bass Chorus EQ',
                    effectType: 'eq',
                    affectedTrackIds: ['track-bass'],
                    mix: 0.8,
                    region: {
                        id: 'region-bass-eq-chorus-one',
                        startBeat: 16,
                        endBeat: 32,
                        blend: 0.75,
                        fadeInBeats: 0.5,
                        fadeOutBeats: 0.25,
                    },
                }),
                createLayer({
                    id: 'layer-bass-compressor',
                    name: 'Bass Chorus Compression',
                    effectType: 'compressor',
                    affectedTrackIds: ['track-bass'],
                    region: {
                        id: 'region-bass-compressor-chorus-one',
                        startBeat: 16,
                        endBeat: 32,
                        blend: 1,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                }),
                createLayer({
                    id: 'layer-vocal-reverb',
                    name: 'Lead Vocal Chorus Reverb',
                    effectType: 'reverb',
                    affectedTrackIds: ['track-lead-vocal'],
                    region: {
                        id: 'region-vocal-reverb-chorus-one',
                        startBeat: 16,
                        endBeat: 32,
                        blend: 1,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                }),
            ],
        });
        automationStore.set({
            lanes: [
                {
                    id: 'auto-bass-distortion-drive',
                    trackId: 'track-bass',
                    parameterId: 'device-bass-distortion:dist-drive',
                    parameterName: 'Bass Distortion Drive',
                    points: [
                        { beat: 48, value: 0.4, curve: 'linear', tension: 0 },
                        { beat: 56, value: 0.85, curve: 'linear', tension: 0 },
                        { beat: 64, value: 0.4, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
        transportStore.set({ ...defaultTransportState });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        adjustmentLayerStore.set({ layers: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        cloudSession.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        removeCrdtDoc('root');
    });

    it('routes a semantic paraphrase to the bass-processing copy capability', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(getConfirmationId()).not.toBe('');
    });

    it('copies the exact bass processing through confirmation, receipt, runtime scheduling, undo, and redo', async () => {
        const originalLayerState = structuredClone(adjustmentLayerStore.value);
        const originalDistortionAutomation = structuredClone(automationStore.value?.lanes ?? []);

        await sendChatMessage(PROMPT);

        const confirmationId = getConfirmationId();
        expect(confirmationId).not.toBe('');
        const confirmation = getPendingActionConfirmation(confirmationId);
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'addAdjustmentRegion',
            'addAdjustmentRegion',
        ]);
        const regionActions = confirmation?.actions.filter((action) => action.type === 'addAdjustmentRegion') ?? [];
        expect(regionActions).toHaveLength(2);
        expect(regionActions.map((action) => action.payload)).toEqual([
            expect.objectContaining({
                ...providerPlan[0].arguments,
                sourceRegionId: 'region-bass-eq-chorus-one',
                sourceSection: {
                    id: 'section-chorus-one',
                    name: 'Chorus One',
                    startBeat: 16,
                    endBeat: 32,
                },
                targetSection: {
                    id: 'section-chorus-two',
                    name: 'Chorus Two',
                    startBeat: 48,
                    endBeat: 64,
                },
                expectedTracks: [{ trackId: 'track-bass', trackName: 'Bass', frozen: false }],
            }),
            expect.objectContaining({
                ...providerPlan[1].arguments,
                sourceRegionId: 'region-bass-compressor-chorus-one',
                expectedTracks: [{ trackId: 'track-bass', trackName: 'Bass', frozen: false }],
            }),
        ]);
        expect(regionActions[0]?.payload.regionId).toMatch(/^adjr-/u);
        expect(regionActions[1]?.payload.regionId).toMatch(/^adjr-/u);
        expect(new Set(regionActions.map((action) => action.payload.regionId)).size).toBe(2);
        expect(confirmation?.actionLabels).toEqual([
            expect.stringContaining(
                'Copy eq layer "Bass Chorus EQ" (layer-bass-eq) on "Bass" (track-bass) from "Chorus One" (section-chorus-one)'
            ),
            expect.stringContaining(
                'Copy compressor layer "Bass Chorus Compression" (layer-bass-compressor) on "Bass" (track-bass) from "Chorus One" (section-chorus-one)'
            ),
        ]);
        expect(confirmation?.approvalSnapshot.actionLabels).toEqual(confirmation?.actionLabels);
        expect(confirmation?.risk).toEqual({
            level: 'broad-reversible',
            reason: 'This applies the same change to multiple project targets.',
        });
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'track-lead-vocal', name: 'Lead Vocal' },
                { id: 'layer-vocal-reverb', name: 'Lead Vocal Chorus Reverb' },
                {
                    id: 'auto-bass-distortion-drive',
                    name: 'Bass Distortion Drive: 48→0.4 (linear), 56→0.85 (linear), 64→0.4 (linear)',
                },
            ])
        );
        expect(confirmation?.affectedIds).toEqual([
            'layer-bass-eq',
            regionActions[0]?.payload.regionId,
            'section-chorus-two',
            'track-bass',
            'layer-bass-compressor',
            regionActions[1]?.payload.regionId,
        ]);
        expect(automationStore.value?.lanes).toEqual(originalDistortionAutomation);

        const webUserMessage = runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1];
        expect(typeof webUserMessage).toBe('string');
        const providerContext = getProjectContextFromUserMessage(webUserMessage ?? '');
        expect(providerContext.bassProcessingCopyCapability).toMatchObject({
            schemaVersion: 1,
            actionType: 'addAdjustmentRegion',
            sourceSection: { id: 'section-chorus-one', startBeat: 16, endBeat: 32 },
            targetSection: { id: 'section-chorus-two', startBeat: 48, endBeat: 64 },
            exactPlan: providerPlan.map((call) => call.arguments),
        });
        const capability = providerContext.bassProcessingCopyCapability;
        if (!isRecord(capability) || !Array.isArray(capability.protectedObjectIds)) {
            throw new TypeError('Expected protected EX-03 capability IDs');
        }
        const protectedObjectIds: unknown[] = capability.protectedObjectIds;
        expect(protectedObjectIds).toEqual(
            expect.arrayContaining(['track-lead-vocal', 'layer-vocal-reverb', 'auto-bass-distortion-drive'])
        );

        await confirmPendingChatActions({ confirmationId });

        const committedLayers = adjustmentLayerStore.value?.layers ?? [];
        const eqRegions = committedLayers.find((layer) => layer.id === 'layer-bass-eq')?.regions ?? [];
        const compressorRegions = committedLayers.find((layer) => layer.id === 'layer-bass-compressor')?.regions ?? [];
        expect(eqRegions).toEqual([
            originalLayerState?.layers[0]?.regions[0],
            {
                id: regionActions[0]?.payload.regionId,
                startBeat: 48,
                endBeat: 64,
                blend: 0.75,
                fadeInBeats: 0.5,
                fadeOutBeats: 0.25,
            },
        ]);
        expect(compressorRegions).toEqual([
            originalLayerState?.layers[1]?.regions[0],
            {
                id: regionActions[1]?.payload.regionId,
                startBeat: 48,
                endBeat: 64,
                blend: 1,
                fadeInBeats: 0,
                fadeOutBeats: 0,
            },
        ]);
        expect(committedLayers.find((layer) => layer.id === 'layer-vocal-reverb')).toEqual(
            originalLayerState?.layers[2]
        );
        expect(automationStore.value?.lanes).toEqual(originalDistortionAutomation);
        expect(scheduleAdjustmentLayers(56)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ layerId: 'layer-bass-eq', trackId: 'track-bass', effectType: 'eq' }),
                expect.objectContaining({
                    layerId: 'layer-bass-compressor',
                    trackId: 'track-bass',
                    effectType: 'compressor',
                }),
            ])
        );
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'executed',
            executionMode: 'atomic',
            executedActions: [
                expect.objectContaining({ actionType: 'addAdjustmentRegion', outcome: 'committed' }),
                expect.objectContaining({ actionType: 'addAdjustmentRegion', outcome: 'committed' }),
            ],
        });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmationId
        );
        expect(receipt?.content).toContain('Protected unchanged:');
        expect(receipt?.content).toContain('auto-bass-distortion-drive');
        expect(receipt?.content).toContain(regionActions[0]?.payload.regionId);
        expect(receipt?.content).toContain(regionActions[1]?.payload.regionId);
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();
        expect(adjustmentLayerStore.value).toEqual(originalLayerState);
        expect(automationStore.value?.lanes).toEqual(originalDistortionAutomation);

        await redo();
        expect(
            adjustmentLayerStore.value?.layers.flatMap((layer) =>
                layer.regions.filter((region) => region.startBeat === 48 && region.endBeat === 64)
            )
        ).toEqual([
            expect.objectContaining({ id: regionActions[0]?.payload.regionId }),
            expect.objectContaining({ id: regionActions[1]?.payload.regionId }),
        ]);
        expect(automationStore.value?.lanes).toEqual(originalDistortionAutomation);
    });

    it('normalizes the hosted provider plan from the same revision-bound capability', async () => {
        runtimeMocks.transformPlan.value = (plan) => [...plan].reverse();
        useHostedFixture();

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions.map((action) => action.type)).toEqual([
            'addAdjustmentRegion',
            'addAdjustmentRegion',
        ]);
        expect(getProviderVisibleRegionPlan(confirmation?.actions)).toEqual(providerPlan.map((call) => call.arguments));
    });

    it('protects canonical kick aliases that contain the word bass', async () => {
        const trackState = trackStore.value;
        const layerState = adjustmentLayerStore.value;
        if (!trackState || !layerState) {
            throw new TypeError('Expected project state');
        }
        trackStore.set({
            ...trackState,
            tracks: [...trackState.tracks, createTrack('track-bass-drum', 'Bass Drum')],
        });
        adjustmentLayerStore.set({
            layers: [
                ...layerState.layers,
                createLayer({
                    id: 'layer-bass-drum-eq',
                    name: 'Bass Drum Chorus EQ',
                    effectType: 'eq',
                    affectedTrackIds: ['track-bass-drum'],
                    region: {
                        id: 'region-bass-drum-eq-chorus-one',
                        startBeat: 16,
                        endBeat: 32,
                        blend: 0.9,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                }),
            ],
        });

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(
            confirmation?.actions.flatMap((action) =>
                action.type === 'addAdjustmentRegion' ? [action.payload.layerId] : []
            )
        ).toEqual(['layer-bass-eq', 'layer-bass-compressor']);
        expect(confirmation?.protectedUnchanged).toEqual(
            expect.arrayContaining([
                { id: 'track-bass-drum', name: 'Bass Drum' },
                { id: 'layer-bass-drum-eq', name: 'Bass Drum Chorus EQ' },
            ])
        );
    });

    it('copies multiple source regions from one layer as one atomic batch', async () => {
        const state = adjustmentLayerStore.value;
        if (!state) {
            throw new TypeError('Expected layer state');
        }
        adjustmentLayerStore.set({
            layers: state.layers.map((layer) => {
                if (layer.id !== 'layer-bass-eq') {
                    return layer;
                }
                return {
                    ...layer,
                    regions: [
                        {
                            id: 'region-bass-eq-chorus-one-a',
                            startBeat: 16,
                            endBeat: 24,
                            blend: 0.75,
                            fadeInBeats: 0.5,
                            fadeOutBeats: 0,
                        },
                        {
                            id: 'region-bass-eq-chorus-one-b',
                            startBeat: 24,
                            endBeat: 32,
                            blend: 0.6,
                            fadeInBeats: 0,
                            fadeOutBeats: 0.25,
                        },
                        {
                            id: 'region-bass-eq-after-target',
                            startBeat: 80,
                            endBeat: 88,
                            blend: 0.4,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 0.25,
                        },
                    ],
                };
            }),
        });
        const originalState = structuredClone(adjustmentLayerStore.value);

        await sendChatMessage(PROMPT);

        const confirmationId = getConfirmationId();
        const confirmation = getPendingActionConfirmation(confirmationId);
        const eqActions =
            confirmation?.actions.filter(
                (action) => action.type === 'addAdjustmentRegion' && action.payload.layerId === 'layer-bass-eq'
            ) ?? [];
        expect(eqActions).toHaveLength(2);

        const result = await confirmPendingChatActions({ confirmationId });

        expect(result.status).toBe('executed');
        expect(
            adjustmentLayerStore.value?.layers
                .find((layer) => layer.id === 'layer-bass-eq')
                ?.regions.filter((region) => region.startBeat >= 48 && region.endBeat <= 64)
                .map(({ startBeat, endBeat, blend, fadeInBeats, fadeOutBeats }) => ({
                    startBeat,
                    endBeat,
                    blend,
                    fadeInBeats,
                    fadeOutBeats,
                }))
        ).toEqual([
            { startBeat: 48, endBeat: 56, blend: 0.75, fadeInBeats: 0.5, fadeOutBeats: 0 },
            { startBeat: 56, endBeat: 64, blend: 0.6, fadeInBeats: 0, fadeOutBeats: 0.25 },
        ]);
        expect(
            adjustmentLayerStore.value?.layers
                .find((layer) => layer.id === 'layer-bass-eq')
                ?.regions.find((region) => region.id === 'region-bass-eq-after-target')
        ).toEqual(originalState?.layers.find((layer) => layer.id === 'layer-bass-eq')?.regions[2]);

        await undo();
        expect(adjustmentLayerStore.value).toEqual(originalState);
        await redo();
        expect(
            adjustmentLayerStore.value?.layers
                .find((layer) => layer.id === 'layer-bass-eq')
                ?.regions.filter((region) => region.startBeat >= 48 && region.endBeat <= 64)
        ).toHaveLength(2);
    });

    it.each([
        ['omits one layer', (plan: (typeof providerPlan)[number][]) => plan.slice(1)],
        ['duplicates one layer', (plan: (typeof providerPlan)[number][]) => [plan[0]!, plan[0]!]],
        [
            'enlarges the layer set',
            (plan: (typeof providerPlan)[number][]) => [
                ...plan,
                {
                    name: 'addAdjustmentRegion' as const,
                    arguments: {
                        layerId: 'layer-vocal-reverb',
                        startBeat: 48,
                        endBeat: 64,
                        blend: 1,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                },
            ],
        ],
        [
            'changes a copied value',
            (plan: (typeof providerPlan)[number][]) => [
                { ...plan[0]!, arguments: { ...plan[0]!.arguments, blend: 0.5 } },
                plan[1]!,
            ],
        ],
    ])('rejects a provider plan that %s', async (_label, transform) => {
        const originalLayers = structuredClone(adjustmentLayerStore.value);
        runtimeMocks.transformPlan.value = (plan) => transform(plan as (typeof providerPlan)[number][]);

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(adjustmentLayerStore.value).toEqual(originalLayers);
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each([
        [
            'the bass track is frozen',
            () => {
                const state = trackStore.value;
                if (!state) {
                    throw new TypeError('Expected track state');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) =>
                        track.id === 'track-bass' ? { ...track, frozen: true } : track
                    ),
                });
            },
        ],
        [
            'a source region crosses the section boundary',
            () => {
                const state = adjustmentLayerStore.value;
                if (!state) {
                    throw new TypeError('Expected layer state');
                }
                adjustmentLayerStore.set({
                    layers: state.layers.map((layer) => {
                        if (layer.id !== 'layer-bass-eq') {
                            return layer;
                        }
                        return {
                            ...layer,
                            regions: layer.regions.map((region) => ({ ...region, startBeat: 15 })),
                        };
                    }),
                });
            },
        ],
        [
            'the target already contains processing on a copied layer',
            () => {
                const state = adjustmentLayerStore.value;
                if (!state) {
                    throw new TypeError('Expected layer state');
                }
                adjustmentLayerStore.set({
                    layers: state.layers.map((layer) => {
                        if (layer.id !== 'layer-bass-eq') {
                            return layer;
                        }
                        return {
                            ...layer,
                            regions: [
                                ...layer.regions,
                                {
                                    id: 'existing-target-region',
                                    startBeat: 48,
                                    endBeat: 64,
                                    blend: 1,
                                    fadeInBeats: 0,
                                    fadeOutBeats: 0,
                                },
                            ],
                        };
                    }),
                });
            },
        ],
        [
            'the protected distortion automation is missing',
            () => {
                automationStore.set({ lanes: [] });
            },
        ],
    ])('fails closed when %s', async (_label, mutateProject) => {
        mutateProject();
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(providerPlan));
        const originalLayers = structuredClone(adjustmentLayerStore.value);

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(adjustmentLayerStore.value).toEqual(originalLayers);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('aborts a later handler conflict without a project, runtime, receipt, or history prefix', async () => {
        const originalLayers = structuredClone(adjustmentLayerStore.value);
        const originalAutomation = structuredClone(automationStore.value);
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const handlers = getArrangementHandlers();
        const baseHandler = handlers.addAdjustmentRegion;
        clearHandlerRegistry();
        registerHandlerMap({
            ...handlers,
            addAdjustmentRegion: {
                ...baseHandler,
                execute: (action: Parameters<typeof baseHandler.execute>[0]) => {
                    if (action.payload.layerId === 'layer-bass-compressor') {
                        return { status: 'conflict' as const };
                    }
                    return baseHandler.execute(action);
                },
            },
        });

        const result = await confirmPendingChatActions({ confirmationId });

        expect(result.status).toBe('failed');
        expect(adjustmentLayerStore.value).toEqual(originalLayers);
        expect(automationStore.value).toEqual(originalAutomation);
        expect(scheduleAdjustmentLayers(56)).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmationId
        );
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
    });

    it('keeps grouped undo and redo atomic and retryable across collaborator conflicts', async () => {
        const originalLayers = structuredClone(adjustmentLayerStore.value);
        const originalAutomation = structuredClone(automationStore.value);
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        await confirmPendingChatActions({ confirmationId });
        const committedLayers = structuredClone(adjustmentLayerStore.value);

        const current = adjustmentLayerStore.value;
        if (!current) {
            throw new TypeError('Expected committed layer state');
        }
        adjustmentLayerStore.set({
            layers: current.layers.map((layer) => {
                if (layer.id !== 'layer-bass-eq') {
                    return layer;
                }
                return {
                    ...layer,
                    regions: layer.regions.map((region) =>
                        region.startBeat === 48 ? { ...region, blend: 0.5 } : region
                    ),
                };
            }),
        });
        const collaboratorState = structuredClone(adjustmentLayerStore.value);
        const historyBeforeFailedUndo = structuredClone(undoStore.value);

        await undo();

        expect(adjustmentLayerStore.value).toEqual(collaboratorState);
        expect(undoStore.value).toEqual(historyBeforeFailedUndo);
        expect(automationStore.value).toEqual(originalAutomation);

        adjustmentLayerStore.set(structuredClone(committedLayers));
        await undo();
        expect(adjustmentLayerStore.value).toEqual(originalLayers);

        const trackState = trackStore.value;
        if (!trackState) {
            throw new TypeError('Expected track state');
        }
        trackStore.set({
            ...trackState,
            tracks: trackState.tracks.map((track) => (track.id === 'track-bass' ? { ...track, frozen: true } : track)),
        });
        const historyBeforeFailedRedo = structuredClone(undoStore.value);

        await redo();

        expect(adjustmentLayerStore.value).toEqual(originalLayers);
        expect(undoStore.value).toEqual(historyBeforeFailedRedo);

        const frozenState = trackStore.value;
        if (!frozenState) {
            throw new TypeError('Expected frozen track state');
        }
        trackStore.set({
            ...frozenState,
            tracks: frozenState.tracks.map((track) =>
                track.id === 'track-bass' ? { ...track, frozen: false } : track
            ),
        });
        await redo();
        expect(adjustmentLayerStore.value).toEqual(committedLayers);
        expect(automationStore.value).toEqual(originalAutomation);
    });
});
