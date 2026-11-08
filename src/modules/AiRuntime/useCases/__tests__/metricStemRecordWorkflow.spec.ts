import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initAudioBufferCacheAccess } from '#/app/initAudioBufferCacheAccess';
import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    cacheAudioBuffer,
    getCachedAudioBuffer,
    configureDurableAudioBufferOwnership,
    configureHistoryAudioBufferReferences,
    configureLiveAudioBufferReferences,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    resetActionReplayAuthority,
    undoReplayPreparationPort,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { arrangementStore, projectLoadFailureStore, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type ToolSchema } from '../../models/ToolDefinitions';
import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import * as promptParser from '../parsePromptToActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { literalMetricIntakeTurn, metricGoalProviderPlan } from './metricGoalWorkflowFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const STEM_SOURCE_NAMES = [
    'Kick_120.wav',
    'Snare_120.wav',
    'Bass_DI_120.wav',
    'Guitar_L_120.wav',
    'Guitar_R_120.wav',
    'Lead_Vocal_120.wav',
] as const;

type ProviderCall = { name: string; arguments: Record<string, unknown> };
type AssetTransfer = NonNullable<ReturnType<typeof import('#/modules/Collaboration/useCases').getAssetTransfer>>;
type DecodeAudioFile = typeof import('#/modules/AudioEngine/useCases').decodeAudioFile;

const mocks = vi.hoisted(() => {
    return {
        stageDurableAsset: vi.fn<AssetTransfer['stageDurableAsset']>(),
        commitDurablePromotionRecovery: vi
            .fn<AssetTransfer['commitDurablePromotionRecovery']>()
            .mockImplementation(async (recoveryId) => ({ status: 'committed', recoveryId })),
        completeDurableCleanupRecovery: vi
            .fn<AssetTransfer['completeDurableCleanupRecovery']>()
            .mockImplementation(async (recoveryId) => ({ status: 'completed', recoveryId, releasedHashes: [] })),
        completeDurablePromotionRecovery: vi
            .fn<AssetTransfer['completeDurablePromotionRecovery']>()
            .mockImplementation(async (recoveryId) => ({ status: 'completed', recoveryId, promotedHashes: [] })),
        decodeAudioFile: vi.fn<DecodeAudioFile>(),
        arrangementEventEmit: vi.fn(() => Promise.resolve()),
        fetch: vi.fn<typeof fetch>(),
        pickFiles: vi.fn<typeof import('#/modules/Project/useCases').pickFiles>(),
        prepareDurableCleanupRecovery: vi
            .fn<AssetTransfer['prepareDurableCleanupRecovery']>()
            .mockImplementation(async (recoveryId) => ({ status: 'prepared', recoveryId, ownerId: 'fixture-owner' })),
        prepareDurablePromotionRecovery: vi
            .fn<AssetTransfer['prepareDurablePromotionRecovery']>()
            .mockImplementation(async (recoveryId) => ({ status: 'prepared', recoveryId, ownerId: 'fixture-owner' })),
        promoteDurableStagedAsset: vi
            .fn<AssetTransfer['promoteDurableStagedAsset']>()
            .mockImplementation(async (leaseId, hash) => ({
                status: 'promoted',
                leaseId,
                hash,
                blob: new Blob(),
                name: 'fixture',
            })),
        protectDurableStagedAssetAcrossTransfer: vi.fn<AssetTransfer['protectDurableStagedAssetAcrossTransfer']>(),
        reopenDurableAsset: vi
            .fn<AssetTransfer['reopenDurableAsset']>()
            .mockImplementation(async (hash) => ({ status: 'opened', hash, blob: new Blob(), name: 'fixture' })),
        transitionDurablePromotionRecoveryToCleanup: vi
            .fn<AssetTransfer['transitionDurablePromotionRecoveryToCleanup']>()
            .mockImplementation(async (recoveryId) => ({ status: 'prepared', recoveryId, ownerId: 'fixture-owner' })),
    };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['cloud'],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'cloud',
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: () => ({
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        prepareDurableCleanupRecovery: mocks.prepareDurableCleanupRecovery,
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        promoteDurableStagedAsset: mocks.promoteDurableStagedAsset,
        protectDurableStagedAssetAcrossTransfer: mocks.protectDurableStagedAssetAcrossTransfer,
        reopenDurableAsset: mocks.reopenDurableAsset,
        stageDurableAsset: mocks.stageDurableAsset,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
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
    for (const id of expectedAudioBufferIds) {
        expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
    }
    const cleanupCalls = [
        ...mocks.prepareDurableCleanupRecovery.mock.calls,
        ...mocks.transitionDurablePromotionRecoveryToCleanup.mock.calls,
    ];
    const bindings = cleanupCalls.flatMap(([, entries]) => entries);
    expect(bindings.map(({ leaseId }) => leaseId).sort()).toEqual(expectedAssetLeaseIds);
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

function audioBuffer(duration = 5): AudioBuffer {
    const sampleRate = 48_000;
    const data = new Float32Array(duration * sampleRate);
    for (let start = 0; start < data.length; start += sampleRate / 2) {
        for (let i = 0; i < 960 && start + i < data.length; i++) {
            data[start + i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * (1 - i / 960);
        }
    }
    return {
        duration,
        length: data.length,
        numberOfChannels: 1,
        sampleRate,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        getChannelData: () => data,
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

function getExpectedCatalogCommandNames(finalCalls: readonly ProviderCall[]): string[] {
    const names = finalCalls.flatMap((call) => {
        if (call.name === 'selectWorkflowCapability') {
            return [];
        }
        if (call.name !== 'command.batch.propose') {
            return [call.name];
        }
        const commands = call.arguments.commands;
        if (!Array.isArray(commands)) {
            return [];
        }
        return commands.flatMap((command) => {
            if (isRecord(command) && typeof command.name === 'string') {
                return [command.name];
            }
            return [];
        });
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

/** The receipts a hosted turn replays natively, one `tool` message per receipt, in wire order. */
function getReplayedToolReceipts(requestBody: string): unknown[] {
    const request: unknown = JSON.parse(requestBody);
    if (!isRecord(request) || !Array.isArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    return request.messages.flatMap((message: unknown) => {
        if (!isRecord(message) || message.role !== 'tool' || typeof message.content !== 'string') {
            return [];
        }
        const receipt: unknown = JSON.parse(message.content);
        return [receipt];
    });
}

function assertDiscoveredCommandSchemas(receipts: readonly unknown[], finalCalls: readonly ProviderCall[]): void {
    const discovery = receipts.find((receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover');
    if (
        !isRecord(discovery) ||
        discovery.status !== 'success' ||
        discovery.turn !== 2 ||
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
            // #4729: a provider that omits usage entirely. A hosted run may not spend its
            // remoteTokens budget on unreported estimates before the loop's own turn limit ends it.
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}

function getProviderCallsForUserMessage(
    userMessage: string,
    receipts: readonly unknown[],
    providerView: readonly ToolSchema[]
): ProviderCall[] {
    if (
        !receipts.some(
            (receipt) =>
                isRecord(receipt) && receipt.toolName === 'selectCreativeInterpretation' && receipt.status === 'success'
        )
    ) {
        return literalMetricIntakeTurn(userMessage, providerView);
    }
    if (getProviderContext(userMessage).stemImportCapability === undefined) {
        return withWorkflowCapabilitySelection('stem-import-starting-mix', []);
    }
    const calls = withWorkflowCapabilitySelection(
        'stem-import-starting-mix',
        asCommandBatchProposal(userMessage, createProviderPlan(userMessage))
    );
    if (!receipts.some((receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover')) {
        return catalogDiscoveryPlan(calls);
    }
    assertDiscoveredCommandSchemas(receipts, calls);
    return calls;
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

async function storedBuffer(id: string): Promise<unknown> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio', 5);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise((resolve, reject) => {
            const request = database.transaction('buffers', 'readonly').objectStore('buffers').get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        database.close();
    }
}

describe('stem import and starting mix workflow', () => {
    let installation: TransactionalIndexedDbInstallation;
    beforeAll(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        installation = installTransactionalIndexedDb();
    });
    afterAll(async () => {
        await withProjectAudioStorageLock(() => Promise.resolve());
        await installation.dispose();
        vi.unstubAllGlobals();
    });
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mocks.fetch);
        // Production shape, from `src/app/bootstrap.ts`. Only a batch executed
        // under the durable idempotency ledger reaches a project checkpoint, and
        // only a configured revision provider can expose that checkpoint's exact
        // revision — which the confirmation path requires before it may report a
        // clean commit.
        configureCommandBatchIdempotency({ canExecute: () => true });
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            authentication: 'none',
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
        commandBatchPreflightPort.setProvider(({ assetReferences, targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: assetReferences.flatMap((reference) =>
                reference.assetHash ? [reference.assetHash] : []
            ),
            availableAudioBufferIds: assetReferences.flatMap((reference) =>
                reference.audioBufferId ? [reference.audioBufferId] : []
            ),
            lockedRanges: [],
            projectId: captureProjectIdentity(),
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
        const project = projectStore.value;
        if (!project) {
            throw new Error('Expected open project');
        }
        projectStore.set({ ...project, loading: false });
        arrangementStore.set({ arrangements: [], activeArrangementId: 'active' });
        projectLoadFailureStore.set(null);
        flushAutomergeStorageWrites();
        initAudioBufferCacheAccess();

        const files = STEM_SOURCE_NAMES.map((name) => new File([name], name, { type: 'audio/wav' }));
        mocks.pickFiles.mockResolvedValue(files);
        mocks.decodeAudioFile.mockImplementation((file: File, hold) => {
            const id = `buffer-${file.name}`;
            const buffer = audioBuffer();
            hold?.retain(id);
            cacheAudioBuffer({ buffer, bufferId: id });
            return Promise.resolve({ id, buffer });
        });
        mocks.stageDurableAsset.mockImplementation(async (_file, name) => {
            const id = `buffer-${name}`;
            await vi.waitFor(async () => expect(await storedBuffer(id)).toBeDefined());
            return { hash: `hash-${name}`, leaseId: `lease-${name}` };
        });
    });

    afterEach(async () => {
        const live =
            pendingActionConfirmationStore.value?.confirmations.filter((entry) => entry.status === 'proposed') ?? [];
        for (const entry of live) {
            await cancelPendingChatActions({ confirmationId: entry.id });
        }
        await withProjectAudioStorageLock(() => Promise.resolve());
        configureDurableAudioBufferOwnership(null);
        configureLiveAudioBufferReferences(null);
        configureHistoryAudioBufferReferences(null);
        undoReplayPreparationPort.setProvider(null);
        resetAiWorkflowCommandPreflightFixture();
        clearPendingActionConfirmations();
        await cloudSession.clear();
        clearAiHistory();
        clearUndoHistory();
        resetActionReplayAuthority();
        commandBatchPreflightPort.setProvider(null);
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        commandProjectRevisionPort.setProvider(null);
        removeCrdtDoc('root');
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
    });

    it.each([
        ['short', 'Raise Guide Mix by 1 dB while keeping true peak below -1 dBTP'],
        ['long', `Raise Guide Mix by 1 dB while keeping true peak below -1 dBTP ${'please '.repeat(1200)}end`],
    ] as const)('plans a staged refinement of the %s predecessor', async (kind, originalPrompt) => {
        let predecessorId = '';
        mocks.fetch.mockImplementation((_input, init) => {
            if (typeof init?.body !== 'string') {
                throw new TypeError('Expected hosted body');
            }
            const body = init.body;
            const message = getHostedUserMessage(body);
            const schemas = (JSON.parse(body) as { tools: ToolSchema[] }).tools;
            const receipts = getReplayedToolReceipts(body);
            if (!predecessorId) {
                if (
                    !receipts.some(
                        (entry) =>
                            isRecord(entry) &&
                            entry.toolName === 'selectCreativeInterpretation' &&
                            entry.status === 'success'
                    )
                ) {
                    return Promise.resolve(toolCallsResponse(literalMetricIntakeTurn(message, schemas)));
                }
                if (!receipts.some((entry) => isRecord(entry) && entry.toolName === 'agent.catalog.discover')) {
                    return Promise.resolve(
                        toolCallsResponse([
                            {
                                name: 'agent.catalog.discover',
                                arguments: { category: 'command', names: ['setTrackGain'] },
                            },
                        ])
                    );
                }
                return Promise.resolve(
                    toolCallsResponse([
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                commands: [{ name: 'setTrackGain', arguments: { trackId: 'track-guide', deltaDb: 1 } }],
                                plan: metricGoalProviderPlan('Raise Guide Mix by 1 dB', ['track-guide']),
                            },
                        },
                    ])
                );
            }
            const calls = getProviderCallsForUserMessage(message, receipts, schemas);
            return Promise.resolve(
                toolCallsResponse(
                    calls.map((call) => {
                        if (call.name !== 'command.batch.propose') {
                            return call;
                        }
                        return { ...call, arguments: { ...call.arguments, refines: predecessorId } };
                    })
                )
            );
        });
        await sendChatMessage(originalPrompt);
        predecessorId = confirmationId();
        expect(predecessorId, chatStore.value?.messages.at(-1)?.content).not.toBe('');
        expect(getPendingActionConfirmation(predecessorId)?.prompt).toBe(originalPrompt);
        expect(
            metricGoalStateCodec(getPendingActionConfirmation(predecessorId)?.approvalSnapshot.metricGoalState)
        ).not.toBeNull();
        const rawBefore = JSON.stringify(getCrdtDoc('root'));
        const tracksBefore = structuredClone(trackStore.value);
        const planning = vi.spyOn(promptParser, 'parsePromptToActions');
        await sendChatMessage(
            'Remove the Guide Mix gain from the pending proposal and import the selected stems using the published role-based gain and pan values.'
        );
        const plans = await Promise.all(planning.mock.results.map((entry) => entry.value));
        planning.mockRestore();
        expect(mocks.stageDurableAsset).toHaveBeenCalledTimes(STEM_SOURCE_NAMES.length);
        if (kind === 'long') {
            const serialized = plans.at(-1)?.metricGoalState;
            let diagnostic = 'No verification record returned';
            if (serialized !== undefined) {
                const stored = JSON.parse(serialized) as { refinedRequests?: string[] };
                diagnostic = JSON.stringify({
                    retainedOriginal: stored.refinedRequests?.includes(originalPrompt),
                    codecRejected: metricGoalStateCodec(serialized) === null,
                });
            }
            expect(serialized, diagnostic).toBeUndefined();
            expect(plans.at(-1)).toMatchObject({
                actions: [],
                rejectionReason: "This proposal's verification record can no longer be read; start a fresh request.",
            });
            expect(getPendingActionConfirmation(predecessorId)).toMatchObject({
                status: 'proposed',
                supersededBy: null,
            });
            expectPreparedStemResourcesReleased(1);
            for (const name of STEM_SOURCE_NAMES) {
                await vi.waitFor(async () => expect(await storedBuffer(`buffer-${name}`)).toBeUndefined());
            }
            for (const name of STEM_SOURCE_NAMES) {
                expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledWith(`stem-cleanup:["lease-${name}"]`);
            }
            expect(
                pendingActionConfirmationStore.value?.confirmations
                    .filter((entry) => entry.status === 'proposed')
                    .map((entry) => entry.id)
            ).toEqual([predecessorId]);
            expect(trackStore.value).toEqual(tracksBefore);
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(rawBefore);
        } else {
            expect(plans.at(-1)?.rejectionReason).toBeUndefined();
            expect(plans.at(-1)?.actions.map((action) => action.type)).toEqual(['importStemSet']);
            for (const name of STEM_SOURCE_NAMES) {
                expect(await storedBuffer(`buffer-${name}`)).toBeDefined();
                expect(getCachedAudioBuffer({ bufferId: `buffer-${name}` })).not.toBeNull();
            }
            expect(metricGoalStateCodec(plans.at(-1)?.metricGoalState)?.refinedRequests).toEqual([originalPrompt]);
            expect(getPendingActionConfirmation(predecessorId)).toMatchObject({
                status: 'invalidated',
                supersededBy: expect.any(String),
            });
            expect(trackStore.value).toEqual(tracksBefore);
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(rawBefore);
        }
    });
});
