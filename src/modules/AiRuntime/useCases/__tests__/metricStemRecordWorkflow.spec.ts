import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
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
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import * as promptParser from '../parsePromptToActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { advertisedAnswerSchema } from './answerWireFixture';
import {
    type ScriptedTurn,
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from './highLevelIntentWorkflowFixture';
import { literalMetricIntakeTurn, metricGoalProviderPlan, readMetricPublication } from './metricGoalWorkflowFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const startingMixMetricIntake: ScriptedTurn = (userMessage, providerView) => {
    const call = selectCreativeInterpretationCall({
        catalog: readCreativeInterpretationCatalog(userMessage, providerView),
        modeId: 'create',
        creationSlotObjectTypes: ['track'],
        dimensions: ['processing', 'arrangement'],
    });
    const objective = readMetricPublication({ function: advertisedAnswerSchema(providerView) }).find(
        (candidate) => candidate.kind === 'unsupported'
    );
    if (objective === undefined) {
        throw new TypeError('Expected the published unsupported starting-mix objective.');
    }
    return [
        {
            ...call,
            arguments: {
                ...call.arguments,
                answer: null,
                metricIntent: {
                    kind: 'perceptual',
                    uncertainty: 'none',
                    objectives: [
                        {
                            objectiveId: objective.id,
                            scopeCandidateId: null,
                            referenceScopeCandidateId: null,
                            rangeCandidateId: null,
                        },
                    ],
                },
            },
        },
    ];
};
const STEM_SOURCE_NAMES = [
    'Kick_120.wav',
    'Snare_120.wav',
    'Bass_DI_120.wav',
    'Guitar_L_120.wav',
    'Guitar_R_120.wav',
    'Lead_Vocal_120.wav',
] as const;
const REPLACEMENT_SOURCE_NAMES = ['Replacement_Kick_120.wav', 'Replacement_Snare_120.wav'] as const;

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const mocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        analyzeAgentAuditionBuffer: vi.fn(),
        analyzeCurrentMix: vi.fn(() => ({ status: 'unavailable', reason: 'no-program-audio' })),
        summarizeFeatures: vi.fn(),
        stageDurableAsset:
            vi.fn<(file: File, name: string, leaseId: string) => Promise<{ hash: string; leaseId: string }>>(),
        commitDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'committed' }),
        completeDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
        completeDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
        decodeAudioFile: vi.fn(),
        detectTempo: vi.fn<() => number | null>(() => 120),
        arrangementEventEmit: vi.fn(() => Promise.resolve()),
        executeBatchError: { value: null as Error | null },
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        prepareDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
        prepareDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
        promoteDurableStagedAsset: vi.fn().mockResolvedValue({ status: 'promoted' }),
        reopenDurableAsset: vi.fn().mockResolvedValue({ status: 'opened' }),
        releasePreviewAudioBuffer: vi.fn(),
        removeTrackStrip: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackMute: vi.fn(),
        setTrackOutput: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackSoloGate: vi.fn(),
        transitionDurablePromotionRecoveryToCleanup: vi.fn().mockResolvedValue({ status: 'prepared' }),
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
        protectDurableStagedAssetAcrossTransfer: vi.fn(),
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
    const bindings = cleanupCalls.flatMap(([, entries]) => entries as Array<{ leaseId: string }>);
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
        [REPLACEMENT_SOURCE_NAMES[0]]: 'kick',
        [REPLACEMENT_SOURCE_NAMES[1]]: 'snare',
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
    transformPlan: (plan: ProviderCall[]) => ProviderCall[],
    receipts: readonly unknown[],
    providerView: string | readonly ToolSchema[],
    intake: ScriptedTurn = literalMetricIntakeTurn
): ProviderCall[] {
    if (
        !receipts.some(
            (receipt) =>
                isRecord(receipt) && receipt.toolName === 'selectCreativeInterpretation' && receipt.status === 'success'
        )
    ) {
        return intake(userMessage, providerView);
    }
    if (
        intake === startingMixMetricIntake &&
        receipts.some(
            (receipt) =>
                isRecord(receipt) &&
                receipt.toolName === 'selectWorkflowCapability' &&
                isRecord(receipt.error) &&
                receipt.error.code === 'measurement-required'
        ) &&
        !receipts.some((receipt) => isRecord(receipt) && receipt.toolName === 'analysis.measure')
    ) {
        return [
            {
                name: 'analysis.measure',
                arguments: { scope: { kind: 'master' }, range: { sectionId: 'missing-section' } },
            },
        ];
    }
    if (getProviderContext(userMessage).stemImportCapability === undefined) {
        return withWorkflowCapabilitySelection('stem-import-starting-mix', []);
    }
    const finalCalls = getFinalStemImportCalls(userMessage, transformPlan);
    if (!receipts.some((receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover')) {
        const discovery = catalogDiscoveryPlan(finalCalls);
        if (intake === startingMixMetricIntake) {
            discovery.push({
                name: 'analysis.measure',
                arguments: { scope: { kind: 'master' }, range: { sectionId: 'missing-section' } },
            });
        }
        return discovery;
    }
    assertDiscoveredCommandSchemas(receipts, finalCalls);
    return finalCalls;
}

function createWebLlmResponder(
    transformPlan: (plan: ProviderCall[]) => ProviderCall[] = (plan) => plan,
    intake: ScriptedTurn = literalMetricIntakeTurn
) {
    return (systemPrompt: string, userMessage: string) => {
        const receipts = hasApplicationToolReceiptContext(userMessage) ? getApplicationToolReceipts(userMessage) : [];
        return Promise.resolve(
            JSON.stringify(getProviderCallsForUserMessage(userMessage, transformPlan, receipts, systemPrompt, intake))
        );
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
        const request = JSON.parse(init.body) as { tools: ToolSchema[] };
        // A hosted turn answers the turns behind it natively, so its receipts arrive as tool
        // messages rather than as text folded into the user message.
        return Promise.resolve(
            toolCallsResponse(
                getProviderCallsForUserMessage(
                    userMessage,
                    transformPlan,
                    getReplayedToolReceipts(init.body),
                    request.tools
                )
            )
        );
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
        mocks.backend.value = 'webllm';
        mocks.executeBatchError.value = null;
        vi.stubGlobal('fetch', mocks.fetch);
        // jsdom has no navigator.locks; the durable project checkpoint is
        // written under that lock.
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
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
        flushAutomergeStorageWrites();

        const files = STEM_SOURCE_NAMES.map((name) => new File([name], name, { type: 'audio/wav' }));
        mocks.pickFiles.mockResolvedValue(files);
        mocks.decodeAudioFile.mockImplementation((file: File) => {
            const id = `buffer-${file.name}`;
            const buffer = audioBuffer();
            cacheAudioBuffer({ buffer, bufferId: id });
            return Promise.resolve({ id, buffer });
        });
        mocks.stageDurableAsset.mockImplementation((_file, name) =>
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
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        commandProjectRevisionPort.setProvider(null);
        removeCrdtDoc('root');
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        vi.unstubAllGlobals();
    });

    it.each([
        ['short', 'Raise Guide Mix by 1 dB while keeping true peak below -1 dBTP'],
        ['long', `Raise Guide Mix by 1 dB while keeping true peak below -1 dBTP ${'please '.repeat(1200)}end`],
    ] as const)('plans a staged refinement of the %s predecessor', async (kind, originalPrompt) => {
        useHostedFixture();
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
            const calls = getProviderCallsForUserMessage(message, (plan) => plan, receipts, schemas);
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
            if (serialized !== undefined) {
                const stored = JSON.parse(serialized) as { refinedRequests?: string[] };
                expect({
                    retainedOriginal: stored.refinedRequests?.includes(originalPrompt),
                    codecRejected: metricGoalStateCodec(serialized) === null,
                }).toBeNull();
            }
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
