import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { type initializeTrackStripFromSnapshot } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    executeAppAction,
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
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore, stopGenerating } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const PROMPT =
    'Import stems, align them to project tempo, name and group them, classify likely instrument roles, and create a sensible starting mix.';
const PARAPHRASE =
    'Bring in this stem set, tempo-align and organize it by likely instrument, then establish a practical initial balance.';
const STEM_SOURCE_NAMES = [
    'Kick_120.wav',
    'Snare_120.wav',
    'Bass_DI_120.wav',
    'Guitar_L_120.wav',
    'Guitar_R_120.wav',
    'Lead_Vocal_120.wav',
] as const;

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const mocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        stageLocalAsset: vi.fn<(file: File, name: string) => Promise<{ hash: string; leaseId: string }>>(),
        decodeAudioFile: vi.fn(),
        detectTempo: vi.fn<() => number | null>(() => 120),
        arrangementEventEmit: vi.fn(() => Promise.resolve()),
        executeBatchError: { value: null as Error | null },
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        initializeTrackStripFromSnapshot: vi.fn<typeof initializeTrackStripFromSnapshot>(() => ({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 0, projectRevision: 'workflow-test-revision' },
            runtimeRevision: 1,
        })),
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        promoteStagedAsset: vi.fn(),
        releaseStagedAsset: vi.fn(),
        releasePreviewAudioBuffer: vi.fn(),
        removeTrackStrip: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackMute: vi.fn(),
        setTrackOutput: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackSoloGate: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        executeAppActionBatch: (...args: Parameters<typeof original.executeAppActionBatch>) => {
            if (mocks.executeBatchError.value) {
                return Promise.reject(mocks.executeBatchError.value);
            }
            return original.executeAppActionBatch(...args);
        },
        executeVersionedCommandBatch: (...args: Parameters<typeof original.executeVersionedCommandBatch>) => {
            if (mocks.executeBatchError.value) {
                return Promise.reject(mocks.executeBatchError.value);
            }
            return original.executeVersionedCommandBatch(...args);
        },
        executeVersionedCommandBatchEnvelope: (
            ...args: Parameters<typeof original.executeVersionedCommandBatchEnvelope>
        ) => {
            if (mocks.executeBatchError.value) {
                return Promise.reject(mocks.executeBatchError.value);
            }
            return original.executeVersionedCommandBatchEnvelope(...args);
        },
    };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [mocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => mocks.backend.value,
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({ detectTempo: mocks.detectTempo }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
    initializeTrackStripFromSnapshot: mocks.initializeTrackStripFromSnapshot,
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
    removeTrackStrip: mocks.removeTrackStrip,
    setTrackGain: mocks.setTrackGain,
    setTrackMute: mocks.setTrackMute,
    setTrackOutput: mocks.setTrackOutput,
    setTrackPan: mocks.setTrackPan,
    setTrackSoloGate: mocks.setTrackSoloGate,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: () => ({
        stageLocalAsset: mocks.stageLocalAsset,
        promoteStagedAsset: mocks.promoteStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
    }),
}));

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    pickFiles: mocks.pickFiles,
}));

const notificationEventBus = {
    emit: vi.fn(() => Promise.resolve()),
    on: vi.fn(() => () => undefined),
};

function expectPreparedStemResourcesReleased(timesPerStem: number): void {
    const expectedAudioBufferIds = STEM_SOURCE_NAMES.flatMap((name) =>
        Array.from({ length: timesPerStem }, () => `buffer-${name}`)
    ).sort();
    const expectedAssetLeaseIds = STEM_SOURCE_NAMES.flatMap((name) =>
        Array.from({ length: timesPerStem }, () => `lease-${name}`)
    ).sort();
    expect(mocks.releasePreviewAudioBuffer.mock.calls.map(([audioBufferId]) => audioBufferId).sort()).toEqual(
        expectedAudioBufferIds
    );
    expect(mocks.releaseStagedAsset.mock.calls.map(([assetLeaseId]) => assetLeaseId).sort()).toEqual(
        expectedAssetLeaseIds
    );
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

function audioBuffer(duration = 16): AudioBuffer {
    return {
        duration,
        length: duration * 48_000,
        numberOfChannels: 2,
        sampleRate: 48_000,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        getChannelData: () => new Float32Array(duration * 48_000),
    };
}

function confirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
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

function getProviderContext(userMessage: string): Record<string, unknown> {
    const schemas = getProviderSection(userMessage, 'capability_schemas');
    if (typeof schemas.availableCapabilities !== 'string') {
        throw new TypeError('Expected serialized available capabilities in provider request');
    }
    const capabilities: unknown = JSON.parse(schemas.availableCapabilities);
    if (!isRecord(capabilities)) {
        throw new TypeError('Expected object-shaped available capabilities');
    }
    return { ...capabilities, projectRevision: getProviderSection(userMessage, 'revision_and_selection').revision };
}

function createProviderPlan(userMessage: string): ProviderCall[] {
    const context = getProviderContext(userMessage);
    if (typeof context.projectRevision !== 'string') {
        throw new TypeError('Expected revision-bound project context');
    }
    const capability = context.stemImportCapability;
    if (capability === undefined) {
        return [];
    }
    if (
        !isRecord(capability) ||
        capability.baseRevision !== context.projectRevision ||
        typeof capability.selectionId !== 'string' ||
        !Array.isArray(capability.stems)
    ) {
        throw new TypeError('Expected revision-bound stem import capability');
    }
    const rolesByName: Record<string, string> = {
        'Kick_120.wav': 'kick',
        'Snare_120.wav': 'snare',
        'Bass_DI_120.wav': 'bass',
        'Guitar_L_120.wav': 'guitar-left',
        'Guitar_R_120.wav': 'guitar-right',
        'Lead_Vocal_120.wav': 'lead-vocal',
    };
    const stems = capability.stems.map((stem) => {
        if (!isRecord(stem) || typeof stem.stemId !== 'string' || typeof stem.sourceName !== 'string') {
            throw new TypeError('Expected exact selected stem metadata');
        }
        return { stemId: stem.stemId, role: rolesByName[stem.sourceName] };
    });
    return [
        {
            name: 'importStemSet',
            arguments: { selectionId: capability.selectionId, groupName: 'Imported Stems', stems },
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
    const parsed: unknown = JSON.parse(String(receiptSummary.summary.value).split('\n').at(-1) ?? '');
    if (!isRecord(parsed) || !Array.isArray(parsed.receipts)) {
        throw new TypeError('Expected serialized application tool receipt list');
    }
    return parsed.receipts;
}

function hasApplicationToolReceiptContext(userMessage: string): boolean {
    const evidence = getProviderSection(userMessage, 'relevant_evidence');
    return (
        Array.isArray(evidence.receipts) &&
        evidence.receipts.some(
            (receipt) =>
                isRecord(receipt) &&
                receipt.id === 'application-tool-loop' &&
                isRecord(receipt.summary) &&
                receipt.summary.truncated === false &&
                typeof receipt.summary.value === 'string'
        )
    );
}

function getExpectedCatalogCommandNames(finalCalls: readonly ProviderCall[]): string[] {
    const names = finalCalls.flatMap((call) => {
        if (call.name === 'selectWorkflowCapability') {
            return [];
        }
        if (call.name !== 'command.batch.propose') {
            return [call.name];
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

function catalogDiscoveryPlan(finalCalls: readonly ProviderCall[]): ProviderCall[] {
    return [
        {
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: getExpectedCatalogCommandNames(finalCalls) },
        },
    ];
}

function assertDiscoveredCommandSchemas(userMessage: string, finalCalls: readonly ProviderCall[]): void {
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
        throw new TypeError('Expected successful command catalog discovery receipt');
    }
    const disclosedNames = new Set<string>();
    for (const item of discovery.data.items) {
        if (
            !isRecord(item) ||
            !isRecord(item.function) ||
            typeof item.function.name !== 'string' ||
            !isRecord(item.function.parameters)
        ) {
            continue;
        }
        disclosedNames.add(item.function.name);
    }
    for (const name of getExpectedCatalogCommandNames(finalCalls)) {
        if (!disclosedNames.has(name)) {
            throw new TypeError(`Expected disclosed command schema for ${name}`);
        }
    }
}

function getStemImportPlanScope(userMessage: string) {
    const context = getProviderContext(userMessage);
    const capability = context.stemImportCapability;
    if (
        !isRecord(capability) ||
        capability.baseRevision !== context.projectRevision ||
        typeof capability.selectionId !== 'string' ||
        !Array.isArray(capability.stems) ||
        !isRecord(capability.constraints) ||
        capability.constraints.preserveExistingProject !== true
    ) {
        throw new TypeError('Expected complete revision-bound stem-import scope');
    }
    return {
        targetIds: [],
        targetRanges: [],
        protectedTargetIds: ['track-guide'],
        protectedRanges: [],
    };
}

function asCommandBatchProposal(userMessage: string, commands: readonly ProviderCall[]): ProviderCall[] {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                commands,
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Import, tempo-align, classify, group, and mix the exact selected stem set.',
                    constraints: ['Preserve the existing project and let the application assign every project ID.'],
                    scope: getStemImportPlanScope(userMessage),
                    capabilityIds: ['importStemSet'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate revision, selection ID, every stem ID, role, and staged asset.'],
                    stoppingConditions: [
                        'Stop if selection, staged assets, project revision, or existing-project protection changes.',
                    ],
                },
            },
        },
    ];
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

function getFinalStemImportCalls(
    userMessage: string,
    transformPlan: (plan: ProviderCall[]) => ProviderCall[]
): ProviderCall[] {
    const plan = transformPlan(createProviderPlan(userMessage));
    return withWorkflowCapabilitySelection(
        'stem-import-starting-mix',
        plan.length === 0 ? [] : asCommandBatchProposal(userMessage, plan)
    );
}

function getProviderCallsForUserMessage(
    userMessage: string,
    transformPlan: (plan: ProviderCall[]) => ProviderCall[]
): ProviderCall[] {
    if (getProviderContext(userMessage).stemImportCapability === undefined) {
        return withWorkflowCapabilitySelection('stem-import-starting-mix', []);
    }
    const finalCalls = getFinalStemImportCalls(userMessage, transformPlan);
    if (!hasApplicationToolReceiptContext(userMessage)) {
        return catalogDiscoveryPlan(finalCalls);
    }
    assertDiscoveredCommandSchemas(userMessage, finalCalls);
    return finalCalls;
}

function createWebLlmResponder(transformPlan: (plan: ProviderCall[]) => ProviderCall[] = (plan) => plan) {
    return (_systemPrompt: string, userMessage: string) => {
        return Promise.resolve(JSON.stringify(getProviderCallsForUserMessage(userMessage, transformPlan)));
    };
}

function createHostedResponder(
    transformPlan: (plan: ProviderCall[]) => ProviderCall[] = (plan) => plan
): (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> {
    return (_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const userMessage = getHostedUserMessage(init.body);
        return Promise.resolve(toolCallsResponse(getProviderCallsForUserMessage(userMessage, transformPlan)));
    };
}

function getHostedUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    if (!isRecord(request) || !Array.isArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    const message = request.messages.find(
        (entry) => isRecord(entry) && entry.role === 'user' && typeof entry.content === 'string'
    );
    if (!isRecord(message) || typeof message.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return message.content;
}

function useHostedFixture(): void {
    mocks.backend.value = 'cloud';
    mocks.fetch.mockImplementation(createHostedResponder());
}

describe('stem import and starting mix workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        mocks.initializeTrackStripFromSnapshot.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 0, projectRevision: 'workflow-test-revision' },
            runtimeRevision: 1,
        });
        mocks.backend.value = 'webllm';
        mocks.executeBatchError.value = null;
        vi.stubGlobal('fetch', mocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('stem import workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        commandBatchPreflightPort.setProvider(({ assetReferences, targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: assetReferences.flatMap((reference) =>
                reference.assetHash ? [reference.assetHash] : []
            ),
            availableAudioBufferIds: assetReferences.flatMap((reference) =>
                reference.audioBufferId ? [reference.audioBufferId] : []
            ),
            lockedRanges: [],
            projectId: captureProjectRevision(),
            projectInvariantsValid: true,
            targetFingerprints: Object.fromEntries(
                targetIds
                    .filter((targetId) => JSON.stringify(trackStore.value).includes(targetId))
                    .map((targetId) => [targetId, targetId])
            ),
        }));
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: mocks.arrangementEventEmit });
        setNotificationEventBus(notificationEventBus);
        trackStore.set({ tracks: [createTrack('track-guide', 'Guide Mix')], selectedTrackId: null, ghostClips: [] });
        transportStore.set({ ...defaultTransportState, tempo: 100 });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });

        const files = STEM_SOURCE_NAMES.map((name) => new File([name], name, { type: 'audio/wav' }));
        mocks.pickFiles.mockResolvedValue(files);
        mocks.decodeAudioFile.mockImplementation((file: File) =>
            Promise.resolve({ id: `buffer-${file.name}`, buffer: audioBuffer() })
        );
        mocks.stageLocalAsset.mockImplementation((_file, name) =>
            Promise.resolve({ hash: `hash-${name}`, leaseId: `lease-${name}` })
        );
        mocks.generateWebLlmCompletion.mockImplementation(createWebLlmResponder());
    });

    afterEach(async () => {
        resetAiWorkflowCommandPreflightFixture();
        clearPendingActionConfirmations();
        await cloudSession.clear();
        clearAiHistory();
        clearUndoHistory();
        resetActionReplayAuthority();
        commandBatchPreflightPort.setProvider(null);
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('routes a semantic paraphrase to the stem-import capability before opening the picker', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(confirmationId()).not.toBe('');
    });

    it('imports, aligns, classifies, groups, mixes, receipts, and replays the exact selected stem set', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(confirmationId());
        expect(confirmation).not.toBeNull();
        expect(confirmation?.actions).toHaveLength(1);
        expect(confirmation?.actionLabels).toEqual([
            'Import 6 stems into folder "Imported Stems" at 100 BPM: Kick (kick, 0.8 gain, center), Snare (snare, 0.7 gain, center), Bass DI (bass, 0.72 gain, center), Guitar L (guitar-left, 0.62 gain, -20 pan), Guitar R (guitar-right, 0.62 gain, +20 pan), Lead Vocal (lead-vocal, 0.7 gain, center); time-stretch every 120 BPM source to 100 BPM',
        ]);
        expect(confirmation?.protectedUnchanged).toContainEqual({ id: 'track-guide', name: 'Guide Mix' });

        await expect(confirmPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(mocks.promoteStagedAsset).toHaveBeenCalledTimes(6);
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();

        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        expect(committedTracks).toHaveLength(8);
        const folder = committedTracks.find((track) => track.kind === 'folder');
        expect(folder?.name).toBe('Imported Stems');
        expect(committedTracks.filter((track) => track.parentId === folder?.id)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'Kick', gain: 0.8, pan: 0 }),
                expect.objectContaining({ name: 'Snare', gain: 0.7, pan: 0 }),
                expect.objectContaining({ name: 'Bass DI', gain: 0.72, pan: 0 }),
                expect.objectContaining({ name: 'Guitar L', gain: 0.62, pan: -20 }),
                expect.objectContaining({ name: 'Guitar R', gain: 0.62, pan: 20 }),
                expect.objectContaining({ name: 'Lead Vocal', gain: 0.7, pan: 0 }),
            ])
        );
        for (const track of committedTracks.filter((candidate) => candidate.parentId === folder?.id)) {
            expect(track.clips).toHaveLength(1);
            expect(track.clips[0]).toMatchObject({
                startBeat: 0,
                endBeat: 32,
                stretchMode: 'timestretch',
                stretchRatio: 100 / 120,
            });
        }
        expect(committedTracks.find((track) => track.id === 'track-guide')).toEqual(originalTracks[0]);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain(confirmation?.actionLabels[0]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        await undo();
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expect(trackStore.value?.tracks).toEqual(committedTracks);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('normalizes the hosted provider plan from the same revision-bound selected-stem capability', async () => {
        useHostedFixture();

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(confirmationId());
        expect(confirmation?.actions).toEqual([
            expect.objectContaining({
                type: 'importStemSet',
                payload: expect.objectContaining({
                    groupName: 'Imported Stems',
                    projectTempo: 100,
                    stems: expect.arrayContaining([
                        expect.objectContaining({ sourceName: 'Kick_120.wav', role: 'kick', trackGain: 0.8 }),
                        expect.objectContaining({
                            sourceName: 'Lead_Vocal_120.wav',
                            role: 'lead-vocal',
                            trackGain: 0.7,
                        }),
                    ]),
                }),
            }),
        ]);
        expect(mocks.fetch).toHaveBeenCalledTimes(3);
        await expect(confirmPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'executed',
        });
    });

    it('treats closing the picker as cancellation after semantic selection without project writes', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        mocks.pickFiles.mockResolvedValue(null);

        await sendChatMessage(PROMPT);

        expect(mocks.generateWebLlmCompletion).toHaveBeenCalledOnce();
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(confirmationId()).toBe('');
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('stops sequential preparation between expensive stems and releases staged resources', async () => {
        let resolveFirstDecode: ((value: { id: string; buffer: AudioBuffer }) => void) | undefined;
        mocks.decodeAudioFile.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveFirstDecode = resolve;
                })
        );

        const sending = sendChatMessage(PROMPT);
        await vi.waitFor(() => expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(1));
        stopGenerating();
        resolveFirstDecode?.({ id: 'buffer-Kick_120.wav', buffer: audioBuffer() });
        await sending;

        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(mocks.generateWebLlmCompletion).toHaveBeenCalledOnce();
        expect(confirmationId()).toBe('');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-Kick_120.wav');
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('preserves numbered stem names instead of collapsing them to ambiguous tracks', async () => {
        mocks.pickFiles.mockResolvedValue([
            new File(['vocal-one'], 'Backing_Vocal_01.wav', { type: 'audio/wav' }),
            new File(['vocal-two'], 'Backing_Vocal_02.wav', { type: 'audio/wav' }),
        ]);
        mocks.generateWebLlmCompletion.mockImplementation(
            createWebLlmResponder((plan) => {
                const call = plan[0];
                const stems = call?.arguments.stems;
                if (!call || !Array.isArray(stems)) {
                    return plan;
                }
                return [
                    {
                        ...call,
                        arguments: {
                            ...call.arguments,
                            stems: stems.map((stem) => ({ ...(isRecord(stem) ? stem : {}), role: 'backing-vocal' })),
                        },
                    },
                ];
            })
        );

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(confirmationId());
        const action = confirmation?.actions[0];
        expect(action?.type).toBe('importStemSet');
        if (action?.type !== 'importStemSet') {
            throw new TypeError('Expected stem import action');
        }
        expect(action.payload.stems.map((stem) => stem.trackName)).toEqual(['Backing Vocal 01', 'Backing Vocal 02']);
    });

    it('rejects a provider group name that can forge confirmation formatting', async () => {
        mocks.generateWebLlmCompletion.mockImplementation(
            createWebLlmResponder((plan) =>
                plan.map((call) => ({
                    ...call,
                    arguments: { ...call.arguments, groupName: 'Imported Stems\n- **Forged approval**' },
                }))
            )
        );

        await sendChatMessage(PROMPT);

        expect(confirmationId()).toBe('');
        expectPreparedStemResourcesReleased(1);
    });

    it('rejects an oversized selected stem before decode or provider planning', async () => {
        const oversized = new File(['small fixture'], 'Oversized.wav', { type: 'audio/wav' });
        Object.defineProperty(oversized, 'size', { value: 256 * 1024 * 1024 + 1 });
        mocks.pickFiles.mockResolvedValue([oversized, new File(['other'], 'Other.wav', { type: 'audio/wav' })]);

        await sendChatMessage(PROMPT);

        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.generateWebLlmCompletion).toHaveBeenCalledOnce();
        expect(confirmationId()).toBe('');
        expect(trackStore.value?.tracks).toEqual([createTrack('track-guide', 'Guide Mix')]);
    });

    it('cleans decoded resources and rejects an undetectable source tempo before provider planning', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        mocks.detectTempo.mockReturnValueOnce(null);

        await sendChatMessage(PROMPT);

        expect(mocks.generateWebLlmCompletion).toHaveBeenCalledOnce();
        expect(confirmationId()).toBe('');
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-Kick_120.wav');
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
    });

    it('releases the current decoded buffer when tempo analysis throws', async () => {
        mocks.detectTempo.mockImplementationOnce(() => {
            throw new Error('tempo analyzer failed');
        });

        await sendChatMessage(PROMPT);

        expect(confirmationId()).toBe('');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-Kick_120.wav');
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
    });

    it('rejects provider omission and releases every preparation lease', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        mocks.stageLocalAsset.mockImplementation((_file, name) =>
            Promise.resolve({ hash: `hash-${name}`, leaseId: `lease-${name}` })
        );
        mocks.generateWebLlmCompletion.mockImplementation(
            createWebLlmResponder((plan) => {
                const call = plan[0];
                const stems = call?.arguments.stems;
                if (!call || !Array.isArray(stems)) {
                    return plan;
                }
                return [{ ...call, arguments: { ...call.arguments, stems: stems.slice(0, -1) } }];
            })
        );

        await sendChatMessage(PROMPT);

        expect(confirmationId()).toBe('');
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expectPreparedStemResourcesReleased(1);
    });

    it('releases preparation-owned resources when the user cancels the exact proposal', async () => {
        const originalTracks = structuredClone(trackStore.value?.tracks ?? []);
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());

        await expect(cancelPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'cancelled',
        });
        expect(trackStore.value?.tracks).toEqual(originalTracks);
        expectPreparedStemResourcesReleased(2);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('invalidates a stale proposal and cleans resources without touching the collaborator edit', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());
        await executeAppAction(
            { type: 'addTrack', payload: { id: 'track-collaborator', name: 'Collaborator', kind: 'audio' } },
            { skipUndo: true }
        );

        const result = await confirmPendingChatActions({ confirmationId: confirmation!.id });

        expect(result.status).toBe('invalidated');
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['track-guide', 'track-collaborator']);
        expectPreparedStemResourcesReleased(2);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('keeps grouped undo retryable when a collaborator changes an imported track', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());
        await confirmPendingChatActions({ confirmationId: confirmation!.id });
        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        const kick = committedTracks.find((track) => track.name === 'Kick');
        const collaboratorTracks = committedTracks.map((track) =>
            track.id === kick?.id ? { ...track, gain: 0.42 } : track
        );
        trackStore.set({ ...trackStore.value!, tracks: collaboratorTracks });

        await undo();

        expect(trackStore.value?.tracks).toEqual(collaboratorTracks);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        trackStore.set({ ...trackStore.value!, tracks: committedTracks });
        await undo();
        expect(trackStore.value?.tracks).toEqual([createTrack('track-guide', 'Guide Mix')]);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('keeps grouped redo retryable when a collaborator reuses an imported track identity', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());
        const action = confirmation?.actions[0];
        if (!confirmation || action?.type !== 'importStemSet') {
            throw new TypeError('Expected materialized stem import action');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        await undo();
        const reusedId = action.payload.stems[0]!.trackId;
        await executeAppAction(
            { type: 'addTrack', payload: { id: reusedId, name: 'Collaborator Stem', kind: 'audio' } },
            { skipUndo: true }
        );
        const beforeRedo = structuredClone(trackStore.value?.tracks ?? []);

        await redo();

        expect(trackStore.value?.tracks).toEqual(beforeRedo);
        expect(trackStore.value?.tracks.some((track) => track.id === action.payload.folderId)).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('does not consume redo when a collaborator reuses every generated track identity with different state', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());
        const action = confirmation?.actions[0];
        if (!confirmation || action?.type !== 'importStemSet') {
            throw new TypeError('Expected materialized stem import action');
        }
        await confirmPendingChatActions({ confirmationId: confirmation.id });
        await undo();
        const reused = [action.payload.folderId, ...action.payload.stems.map((stem) => stem.trackId)].map((id, index) =>
            createTrack(id, `Collaborator ${String(index)}`)
        );
        trackStore.set({ ...trackStore.value!, tracks: [createTrack('track-guide', 'Guide Mix'), ...reused] });
        const beforeRedo = structuredClone(trackStore.value?.tracks ?? []);

        await redo();

        expect(trackStore.value?.tracks).toEqual(beforeRedo);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('reconciles a transient live-strip projection failure after the atomic project commit', async () => {
        mocks.initializeTrackStripFromSnapshot.mockImplementationOnce(() => {
            throw new Error('transient strip projection failure');
        });
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());

        await expect(confirmPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks).toHaveLength(8);
        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledTimes(STEM_SOURCE_NAMES.length + 1);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).not.toContain('manual repair required');
    });

    it('reconciles a transient track-added event failure before reporting a clean commit', async () => {
        mocks.arrangementEventEmit.mockRejectedValueOnce(new Error('transient track-added event failure'));
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());

        await expect(confirmPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(mocks.arrangementEventEmit).toHaveBeenCalledTimes(8);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).not.toContain('follow-up warning');
    });

    it('cleans staged resources when Command rejects unexpectedly before a status result', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());
        mocks.executeBatchError.value = new Error('unexpected command rejection');

        await expect(confirmPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'failed',
            reason: 'unexpected command rejection',
        });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(6);
        expect(mocks.releaseStagedAsset).toHaveBeenCalledTimes(6);
        expect(trackStore.value?.tracks).toEqual([createTrack('track-guide', 'Guide Mix')]);
    });

    it('reports persistent live-strip projection failure as committed with a manual-repair warning', async () => {
        mocks.initializeTrackStripFromSnapshot.mockImplementation(() => {
            throw new Error('persistent strip projection failure');
        });
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(confirmationId());

        await expect(confirmPendingChatActions({ confirmationId: confirmation!.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks).toHaveLength(8);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledTimes(STEM_SOURCE_NAMES.length * 2);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('committed with a follow-up warning');
        expect(receipt?.content.toLowerCase()).toContain('manual repair required');
        expect(receipt?.error).toContain('persistent strip projection failure');
    });
});
