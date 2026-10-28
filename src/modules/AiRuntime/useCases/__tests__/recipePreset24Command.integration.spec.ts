import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    runtimeGraphTopology,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import { clearAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    parseVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import { type IntentResult } from '../../models/IntentResult';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { budgetLocalPlanningRequest } from '../../transformers/budgetLocalPlanningRequest';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { serializeWebLlmToolPlanningPrompt } from '../../transformers/serializeWebLlmToolPlanningPrompt';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

// A controlled topology reducer and render boundary replace the audio engine. Command and
// Arrangement handlers, compilation, grounding, isolated preview and measurement remain real.
const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    updateDeviceParam: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: engine.renderOffline,
    renderOfflineInput: engine.renderOfflineInput,
    renderTrackSubgraphOffline: engine.renderTrackSubgraphOffline,
    updateDeviceParam: engine.updateDeviceParam,
    applyRuntimeGraphDelta: engine.applyRuntimeGraphDelta,
    matchesRuntimeDeviceChainTopology: engine.matchesRuntimeDeviceChainTopology,
    mirrorDeviceChainDelta: engine.mirrorDeviceChainDelta,
}));

const localProvider = vi.hoisted(() => ({
    calls: vi.fn(),
    cloud: vi.fn(),
    backends: ['webllm'] as ('cloud' | 'webllm')[],
}));
vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => localProvider.backends,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: localProvider.cloud,
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({
        provider: 'openai',
        model: 'hosted-model',
        baseUrl: 'https://api.openai.com/v1',
        authentication: 'api-key',
    }),
}));
vi.mock('../../repositories/cloudLlm/usesStrictCloudToolSchemas', () => ({ usesStrictCloudToolSchemas: () => false }));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../repositories/webLlm/toolCalling', () => ({ generateWebLlmToolCalls: localProvider.calls }));

// The provider's turns are scripted; every turn's tools run through the real planning loop.
vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../transformers/promptParser/parsing')>()),
    tryPresetMatch: vi.fn(),
    tryParameterizedPath: vi.fn(),
    tryCompoundFastPath: vi.fn(),
}));

const SAMPLE_RATE = 48_000;
const PROMPT = 'make the guitar warm and apply the clean guitar strip';
const RUN_ID = 'run-preview';
const ASSISTANT_ID = 'assistant-preview';
const RANGE = { startBeat: 0, endBeat: 8 };
const DRUMS_SCOPE = { kind: 'tracks', ids: ['8c25eb5a-f366-460e-bd4b-15560d8ad9c0'] };
const DRUMS_GAIN_ID = 'f1f07d73-34c3-42a7-a055-1672dd517517';
type SubgraphRequest = { renderTracks: readonly Track[]; trackId?: string };
const DEVICE_NAMES: Readonly<Record<string, string>> = { existing: 'Existing Gain' };
function gainDevice(id: string): Track['devices'][number] {
    return {
        id,
        name: DEVICE_NAMES[id] ?? id,
        type: 'builtin-gain',
        bypassed: false,
        parameterValues: { 'gain-level': 0 },
    };
}

/** Two seconds of a 1 kHz stereo sine at `amplitude`. */
function sineBuffer(amplitude: number): AudioBuffer {
    const length = SAMPLE_RATE * 2;
    const channel = new Float32Array(length);
    for (let frame = 0; frame < length; frame++) {
        channel[frame] = amplitude * Math.sin((2 * Math.PI * 1_000 * frame) / SAMPLE_RATE);
    }
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 2,
        duration: length / SAMPLE_RATE,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

/**
 * A stand-in renderer that honours what it is handed: the drums sound at their fader gain times
 * every gain device's level, so a preview that lowers a device renders quieter.
 */
function renderSubgraph(request: SubgraphRequest): Promise<AudioBuffer> {
    const track = request.renderTracks.find((candidate) => candidate.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0');
    const levelDb = (track?.devices ?? []).reduce(
        (total, device) => total + (device.parameterValues['gain-level'] ?? 0),
        0
    );
    return Promise.resolve(sineBuffer(0.5 * (track?.gain ?? 1) * 10 ** (levelDb / 20)));
}

/** The interpretation a hosted run admits for the prompt: edit the drums' processing. */
function interpretationCall(revision: string, trackId = '8c25eb5a-f366-460e-bd4b-15560d8ad9c0'): ToolCallResult {
    const catalog = prepareCreativeInterpretationCatalog({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    const drums = catalog.targets.find((target) => target.objectIds.includes(trackId));
    const processing = catalog.dimensions.find((dimension) => dimension.dimension === 'processing');
    const deviceSlot = catalog.creationSlots.find((slot) => slot.objectType === 'device');
    if (drums === undefined || processing === undefined || deviceSlot === undefined) {
        throw new Error('Expected the creative catalog to offer the drums track, its processing and a device.');
    }
    return {
        id: 'interpretation-1',
        name: 'selectCreativeInterpretation',
        arguments: {
            catalogId: catalog.catalogId,
            modeId: 'edit',
            targetCandidateIds: [drums.candidateId],
            editDimensionCandidateIds: catalog.dimensions
                .filter(({ dimension }) => dimension === 'processing' || dimension === 'arrangement')
                .map(({ candidateId }) => candidateId),
            constraintCandidateIds: [],
            creationSlotIds: catalog.creationSlots
                .filter((slot) => slot.objectType === 'device' || slot.objectType === 'track')
                .map((slot) => slot.candidateId),
            uncertainty: 'none',
        },
    };
}

function scriptTurns(revision: string, turns: ReadonlyArray<ToolCallResult[]>): void {
    const planning = vi.mocked(generateToolPlanningOutcome);
    planning.mockResolvedValueOnce({
        status: 'complete',
        toolCalls: [interpretationCall(revision)],
        providerTurn: { provider: 'openai', assistantItems: null },
    });
    for (const toolCalls of turns) {
        planning.mockResolvedValueOnce({
            status: 'complete',
            toolCalls,
            providerTurn: { provider: 'openai', assistantItems: null },
        });
    }
}

/** Decode the provider-visible legend independently of the production formatter. */
function receiptsFromLocalMessage(message: string): unknown {
    const section = message.match(/(?:^|\n)relevant_evidence:\n([^\n]+)/)?.[1];
    if (section === undefined) {
        throw new Error('Missing relevant evidence');
    }
    const evidence: { receipts: { summary: { value: string; truncated: boolean } }[] } = JSON.parse(section);
    const summary = evidence.receipts[0]?.summary;
    if (summary === undefined || summary.truncated) {
        throw new Error('Missing complete receipt text');
    }
    const wire: { version: number; layouts: string[][]; strings: string[]; shared: unknown[]; receipts: unknown } =
        JSON.parse(summary.value.split('\n').at(-1)!);
    expect(wire.version).toBe(1);
    function decode(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map(decode);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        const entry = value as Record<string, unknown>;
        const keys = Object.keys(entry);
        if (keys.length === 1 && keys[0] === '$s') {
            return wire.strings[entry.$s as number];
        }
        if (keys.length === 1 && keys[0] === '$v') {
            return decode(wire.shared[entry.$v as number]);
        }
        if (keys.length === 1 && keys[0] === '$r') {
            const [index, ...values] = entry.$r as unknown[];
            const layout = wire.layouts[index as number]!;
            if (layout.length !== values.length) {
                throw new Error('Invalid receipt layout');
            }
            return Object.fromEntries(layout.map((key, i) => [key, decode(values[i])]));
        }
        if (keys.length === 1 && keys[0] === '$l') {
            return Object.fromEntries((entry.$l as [string, unknown][]).map(([key, child]) => [key, decode(child)]));
        }
        return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, decode(child)]));
    }
    return decode(wire.receipts);
}

/** Persist a planned result for approval as the prompt route does, under a run that is planning. */
function persistForApproval(planned: IntentResult, revision: string): string {
    agentRunLifecycle.create({ runId: RUN_ID, request: PROMPT, mode: 'apply', createdRevision: null, createdAt: 1 });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
    const group = { groupId: 'group-preview', groupLabel: 'Punchier drums' };
    const actionLabels = planned.actions.map((action) => action.type);
    const compiled = compileAgentActionExecution({
        actions: planned.actions,
        actionCommandGraph: planned.actionCommandGraph,
        actionLabels,
        group,
        intent: PROMPT,
        projectRevision: revision,
        runId: RUN_ID,
        context: getProjectContext(),
        requiresConfirmation: true,
    });
    if (compiled.agentApproval === null) {
        throw new Error('Expected the batch to wait for approval.');
    }
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    const confirmationId = persistPromptActionConfirmation({
        runId: RUN_ID,
        prompt: PROMPT,
        assistantMessageId: ASSISTANT_ID,
        actions: planned.actions,
        actionLabels,
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: compiled.agentApproval,
        affectedIds: ['8c25eb5a-f366-460e-bd4b-15560d8ad9c0'],
        protectedUnchanged: [],
        measuredPreview: planned.measuredPreview,
        executionMode: 'atomic',
        group,
        projectRevision: revision,
        parsedCommandBatch,
        content: 'Punchier drums',
    });
    if (confirmationId === null) {
        throw new Error('Expected the proposal to be retained for approval.');
    }
    return confirmationId;
}

beforeEach(() => {
    configureAiWorkflowCommandPreflightFixture();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('preview measurement test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    // A palette that advances on every draw, as the session's does.
    let drawnColors = 0;
    commandTrackDefaultsPort.setTrackColorProvider(() => `#00000${String((drawnColors += 1) % 10)}`);
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: '8c25eb5a-f366-460e-bd4b-15560d8ad9c0', name: 'Guitar', kind: 'audio' }),
                devices: [gainDevice(DRUMS_GAIN_ID)],
            },
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    // Controlled runtime reducer starts at the existing strip and validates each topology transition.
    const initial = trackStore.value?.tracks.find((track) => track.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0');
    if (initial === undefined) {
        throw new Error('Missing guitar fixture');
    }
    let runtimeNode = runtimeGraphTopology.createNode(initial);
    engine.matchesRuntimeDeviceChainTopology.mockImplementation(
        (node: typeof runtimeNode) => JSON.stringify(node) === JSON.stringify(runtimeNode)
    );
    engine.applyRuntimeGraphDelta.mockImplementation(
        (delta: {
            before: typeof runtimeNode;
            after: typeof runtimeNode;
            correlation: { appRevision: number; projectRevision: string };
        }) => {
            if (JSON.stringify(delta.before) !== JSON.stringify(runtimeNode)) {
                return { acceptance: 'rejected', application: 'not-applied', reason: 'runtime source mismatch' };
            }
            runtimeNode = delta.after;
            return {
                acceptance: 'accepted',
                application: 'applied',
                correlation: delta.correlation,
                runtimeRevision: delta.correlation.appRevision + 1,
            };
        }
    );
    engine.mirrorDeviceChainDelta.mockResolvedValue({ outcome: 'skipped', reason: 'controlled runtime' });
    transportStore.set({ ...defaultTransportState, tempo: 120 });
    flushAutomergeStorageWrites();
    clearAgentMeasurementArtifacts();
    engine.renderOffline.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderOfflineInput.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderTrackSubgraphOffline.mockReset().mockImplementation(renderSubgraph);
    engine.updateDeviceParam.mockReset();
    vi.mocked(generateToolPlanningOutcome).mockReset();
    localProvider.backends = ['webllm'];
    localProvider.cloud.mockReset();
    localProvider.calls.mockReset();
    vi.mocked(tryPresetMatch).mockReturnValue([]);
    vi.mocked(tryParameterizedPath).mockReturnValue([]);
    vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    chatStore.set({
        messages: [{ id: ASSISTANT_ID, role: 'assistant', content: 'Planning', timestamp: 1 }],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    resetAiWorkflowCommandPreflightFixture();
    commandTrackDefaultsPort.setTrackColorProvider(null);
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    clearAgentMeasurementArtifacts();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

it('previews and confirms the complete factory guitar strip as one undo group', async () => {
    const revision = captureProjectRevision();
    const before = structuredClone(
        trackStore.value?.tracks.find((track) => track.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0')?.devices
    );
    const historyBefore = structuredClone(undoHistoryStore.value);
    scriptTurns(revision, [
        [{ id: 'discover-1', name: 'recipe.discover', arguments: { descriptors: ['warm'], role: 'guitar' } }],
        [
            {
                id: 'expand-1',
                name: 'recipe.expand',
                arguments: {
                    recipeId: 'preset:fx-chain-guitar-clean:warm',
                    targetId: '8c25eb5a-f366-460e-bd4b-15560d8ad9c0',
                    role: 'guitar',
                },
            },
        ],
        [
            {
                id: 'preview-1',
                name: 'analysis.measure',
                arguments: {
                    scope: DRUMS_SCOPE,
                    range: RANGE,
                    metrics: ['integratedLoudness'],
                    subject: 'preview',
                    recipeCallId: 'expand-1',
                },
            },
        ],
        [
            {
                id: 'propose-1',
                name: 'command.batch.propose',
                arguments: { commands: [], compiledCallIds: ['preview-1'] },
            },
        ],
    ]);
    const planned = await parsePromptToActions({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    expect({
        rejection: planned.rejectionReason ?? null,
        failures: (planned.applicationToolReceipts ?? []).flatMap((r) =>
            r.error === null ? [] : [r.error.safeMessage]
        ),
    }).toEqual({ rejection: null, failures: [] });
    expect(planned.actions).toHaveLength(24);
    expect(planned.applicationToolReceipts?.find((r) => r.callId === 'expand-1')?.status).toBe('success');
    expect(planned.applicationToolReceipts?.find((r) => r.callId === 'preview-1')?.status).toBe('success');
    const confirmationId = persistForApproval(planned, revision);
    const view = getAgentApprovalView({ confirmationId });
    expect(view?.recipes).toMatchObject([
        { recipeId: 'preset:fx-chain-guitar-clean:warm', targetId: '8c25eb5a-f366-460e-bd4b-15560d8ad9c0' },
    ]);
    expect(view?.measuredPreview?.targets).toHaveLength(1);
    const receipt = planned.applicationToolReceipts?.find((entry) => entry.callId === 'expand-1');
    expect(new TextEncoder().encode(JSON.stringify(receipt)).length).toBeLessThanOrEqual(16384);
    expect(vi.mocked(generateToolPlanningOutcome).mock.calls.at(-1)?.[9]?.localReceiptContextComplete).toBe(true);
    const pending = getPendingActionConfirmation(confirmationId);
    expect(pending?.approvalSnapshot.measuredPreview?.batchContentHash).toBe(planned.measuredPreview?.batchContentHash);
    const batch = pending?.approvalSnapshot.commandBatch;
    if (batch === undefined) {
        throw new Error('Missing command batch');
    }
    const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    expect(parsed.envelope.commands).toHaveLength(24);
    agentRunLifecycle.create({
        runId: 'budget-24',
        request: PROMPT,
        mode: 'apply',
        createdRevision: revision,
        budgets: { limits: { maxCommands: 24 }, consumed: {} },
    });
    agentRunLifecycle.create({
        runId: 'budget-23',
        request: PROMPT,
        mode: 'apply',
        createdRevision: revision,
        budgets: { limits: { maxCommands: 23 }, consumed: {} },
    });
    expect(
        agentWorkBudget.reserveCommandWork({ runId: 'budget-24', attemptId: 'batch', envelope: parsed.envelope })
    ).toMatchObject({
        status: 'reserved',
        estimates: expect.arrayContaining([{ category: 'maxCommands', amount: 24 }]),
    });
    expect(
        agentWorkBudget.reserveCommandWork({ runId: 'budget-23', attemptId: 'batch', envelope: parsed.envelope })
    ).toMatchObject({ status: 'hard-limit-reached' });
    expect(agentRunLifecycle.get('budget-23')?.budgets.consumed).toEqual({});

    expect(captureProjectRevision()).toBe(revision);
    expect(
        trackStore.value?.tracks.find((track) => track.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0')?.devices
    ).toEqual(before);
    expect(undoHistoryStore.value).toEqual(historyBefore);
    expect(await confirmPendingChatActions({ confirmationId })).toEqual({ status: 'executed' });
    const devices =
        trackStore.value?.tracks.find((track) => track.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0')?.devices ?? [];
    expect(devices.map((device) => device.type)).toEqual([
        'builtin-gain',
        'builtin-eq',
        'builtin-compressor',
        'builtin-chorus',
        'builtin-reverb',
    ]);
    expect(devices.slice(1).map((device) => device.parameterValues)).toEqual([
        {
            'eq-low-q': 1,
            'eq-high-q': 1,
            'eq-low-gain': -2,
            'eq-low-freq': 100,
            'eq-mid-gain': 2,
            'eq-mid-freq': 1500,
            'eq-mid-q': 1,
            'eq-high-gain': 1,
            'eq-high-freq': 6000,
        },
        {
            'comp-threshold': -15,
            'comp-ratio': 2.5,
            'comp-attack': 20,
            'comp-release': 150,
            'comp-makeup': 2,
            'comp-knee': 6,
        },
        { 'chorus-rate': 0.6, 'chorus-depth': 4, 'chorus-feedback': 0.2, 'chorus-mix': 0.25 },
        {
            'rev-size': 0.3,
            'rev-decay': 1.5,
            'rev-damping': 0.2,
            'rev-mix': 0.25,
            'rev-lowcut': 80,
            'rev-predelay': 10,
        },
    ]);
    expect(engine.applyRuntimeGraphDelta).toHaveBeenCalled();
    expect(
        engine.applyRuntimeGraphDelta.mock.calls[0]?.[0].after.devices.map((device: { type: string }) => device.type)
    ).toEqual(devices.map((device) => device.type));
    const storedValues = [
        {
            'eq-low-gain': -2,
            'eq-low-freq': 100,
            'eq-mid-gain': 2,
            'eq-mid-freq': 1500,
            'eq-mid-q': 1,
            'eq-high-gain': 1,
            'eq-high-freq': 6000,
        },
        { 'comp-threshold': -15, 'comp-ratio': 2.5, 'comp-attack': 20, 'comp-release': 150, 'comp-makeup': 2 },
        { 'chorus-rate': 0.6, 'chorus-depth': 4, 'chorus-feedback': 0.2, 'chorus-mix': 0.25 },
        { 'rev-size': 0.3, 'rev-decay': 1.5, 'rev-damping': 0.2, 'rev-mix': 0.25 },
    ];
    for (const [index, values] of storedValues.entries()) {
        for (const [parameter, value] of Object.entries(values)) {
            expect(engine.updateDeviceParam).toHaveBeenCalledWith(
                '8c25eb5a-f366-460e-bd4b-15560d8ad9c0',
                devices[index + 1]?.id,
                parameter,
                value
            );
        }
    }
    expect(await undo()).toEqual({ headConsumed: true });
    expect(
        trackStore.value?.tracks.find((track) => track.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0')?.devices
    ).toEqual(before);
});

// Scripted local turns omit providerTurn and call IDs; the loop must synthesize and retain them.
it.each(['guitar-1', '8c25eb5a-f366-460e-bd4b-15560d8ad9c0'])(
    'admits the complete guitar preview through local budgets for %s',
    async (trackId) => {
        const existing = trackStore.value;
        if (existing === null) {
            throw new Error('Missing project tracks');
        }
        trackStore.set({
            ...existing,
            tracks: existing.tracks.map((track) =>
                track.id === '8c25eb5a-f366-460e-bd4b-15560d8ad9c0' ? { ...track, id: trackId } : track
            ),
        });
        flushAutomergeStorageWrites();
        const revision = captureProjectRevision();
        const planning = vi.mocked(generateToolPlanningOutcome);
        const actual = await vi.importActual<typeof import('../llmOrchestration/inference')>(
            '../llmOrchestration/inference'
        );
        planning.mockImplementation(actual.generateToolPlanningOutcome);
        let turn = 0;
        localProvider.calls.mockReset().mockImplementation(async (_system: string, localText: string) => {
            turn += 1;
            if (turn === 1) {
                const { id: _id, ...interpretation } = interpretationCall(revision, trackId);
                return { status: 'complete', toolCalls: [interpretation] };
            }
            if (turn === 2) {
                return {
                    status: 'complete',
                    toolCalls: [{ name: 'recipe.discover', arguments: { descriptors: ['warm'], role: 'guitar' } }],
                };
            }
            if (turn === 3) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'recipe.expand',
                            arguments: {
                                recipeId: 'preset:fx-chain-guitar-clean:warm',
                                targetId: trackId,
                                role: 'guitar',
                            },
                        },
                    ],
                };
            }
            const expectedTurn = turn === 4 ? 3 : 4;
            const match = localText.match(new RegExp(`planning-[0-9a-f-]{36}-${String(expectedTurn)}-0`));
            if (match === null) {
                throw new Error(`Missing synthesized call ID for turn ${String(expectedTurn)}`);
            }
            if (turn === 4) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'analysis.measure',
                            arguments: {
                                scope: { kind: 'tracks', ids: [trackId] },
                                range: RANGE,
                                metrics: ['integratedLoudness'],
                                subject: 'preview',
                                recipeCallId: match[0],
                            },
                        },
                    ],
                };
            }
            return {
                status: 'complete',
                toolCalls: [
                    { name: 'command.batch.propose', arguments: { commands: [], compiledCallIds: [match[0]] } },
                ],
            };
        });
        const planned = await parsePromptToActions({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        });
        expect(
            (planned.applicationToolReceipts ?? []).flatMap((receipt) =>
                receipt.error === null ? [] : [receipt.error.safeMessage]
            )
        ).toEqual([]);
        expect(planned.rejectionReason ?? null).toBeNull();
        expect(planned.actions).toHaveLength(24);
        const call = planning.mock.calls.at(-1);
        expect(call?.[9]?.localReceiptContextComplete).toBe(true);
        if (call === undefined || call[10] === undefined) {
            throw new Error('Missing local planning input');
        }
        const localCall = localProvider.calls.mock.calls.at(-1);
        if (localCall === undefined) {
            throw new Error('Local provider boundary was not reached');
        }
        const budget = budgetLocalPlanningRequest({
            systemPrompt: serializeWebLlmToolPlanningPrompt(localCall[0], localCall[2]),
            userMessage: localCall[1],
            windowTokens: 32768,
            configuredMaxOutputTokens: 4096,
        });
        expect(budget.status).toBe('admitted');
        expect(receiptsFromLocalMessage(localCall[1])).toEqual(planned.applicationToolReceipts);
    }
);

it('retains hosted history and delivers complete local text on hosted fallback', async () => {
    const revision = captureProjectRevision();
    const planning = vi.mocked(generateToolPlanningOutcome);
    const providerTurn = { provider: 'openai' as const, assistantItems: null };
    for (const toolCalls of [
        [interpretationCall(revision)],
        [{ id: 'discover-1', name: 'recipe.discover', arguments: { descriptors: ['warm'], role: 'guitar' } }],
        [
            {
                id: 'expand-1',
                name: 'recipe.expand',
                arguments: {
                    recipeId: 'preset:fx-chain-guitar-clean:warm',
                    targetId: '8c25eb5a-f366-460e-bd4b-15560d8ad9c0',
                    role: 'guitar',
                },
            },
        ],
        [
            {
                id: 'preview-1',
                name: 'analysis.measure',
                arguments: {
                    scope: DRUMS_SCOPE,
                    range: RANGE,
                    metrics: ['integratedLoudness'],
                    subject: 'preview',
                    recipeCallId: 'expand-1',
                },
            },
        ],
    ]) {
        planning.mockResolvedValueOnce({ status: 'complete', toolCalls, providerTurn });
    }
    localProvider.backends = ['cloud', 'webllm'];
    localProvider.cloud.mockRejectedValue(new Error('controlled hosted failure'));
    localProvider.calls.mockResolvedValue({
        status: 'complete',
        toolCalls: [{ name: 'command.batch.propose', arguments: { commands: [], compiledCallIds: ['preview-1'] } }],
    });
    const actual = await vi.importActual<typeof import('../llmOrchestration/inference')>(
        '../llmOrchestration/inference'
    );
    planning.mockImplementation(actual.generateToolPlanningOutcome);
    const planned = await parsePromptToActions({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    expect(planned.rejectionReason ?? null).toBeNull();
    expect(planned.actions).toHaveLength(24);
    const input = planning.mock.calls.at(-1);
    expect(input?.[9]?.localReceiptContextComplete).toBe(true);
    const history: HostedTurnHistory = input?.[9]?.history ?? [];
    expect(history.flatMap((entry) => entry.receipts.map((receipt) => receipt.callId))).toEqual([
        'interpretation-1',
        'discover-1',
        'expand-1',
        'preview-1',
    ]);
    expect(
        history.flatMap((entry) => entry.receipts).find((receipt) => receipt.callId === 'expand-1')?.data
    ).toHaveProperty('commands');
    expect(history.flatMap((entry) => entry.receipts)).toEqual(planned.applicationToolReceipts);
    expect(localProvider.cloud).toHaveBeenCalledOnce();
    expect(localProvider.calls).toHaveBeenCalledOnce();
    const localMessage = localProvider.calls.mock.calls[0]?.[1];
    expect(localMessage).toContain('Expand recursively to recover the exact receipts.');
    expect(receiptsFromLocalMessage(localMessage)).toEqual(planned.applicationToolReceipts);
});

it('refuses an adopted recipe beside a selector and repeat that expand beyond one batch', async () => {
    const original = trackStore.value?.tracks ?? [];
    const extra = Array.from({ length: 24 }, (_, index) =>
        createTrack({ id: `extra-${index}`, name: `Extra ${index}`, kind: 'audio' })
    );
    trackStore.set({ tracks: [...original, ...extra], selectedTrackId: null, ghostClips: [] });
    const revision = captureProjectRevision();
    const context = getProjectContext();
    const ids = context.tracks.filter((track) => track.kind === 'audio').map((track) => track.id);
    expect(ids).toHaveLength(25);
    const plan = {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Mute audio tracks',
        constraints: [],
        scope: { targetIds: ids, targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        capabilityIds: [],
        assetIds: [],
        alternatives: [],
        validationStrategy: ['Validate targets'],
        stoppingConditions: ['Stop on conflict'],
    };
    const list = {
        schemaVersion: 1,
        items: [
            {
                id: 'mute-audio',
                name: 'muteTrack',
                arguments: { muted: true },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    where: { kind: 'audio' },
                    quantity: { unit: 'targets', exactly: 25 },
                },
                repeat: { count: 2 },
            },
        ],
    };
    const compiled = compileArbitraryCommandList({
        context,
        revision,
        calls: [{ name: 'command.batch.propose', arguments: { plan, list } }],
    });
    expect(compiled.status).toBe('accepted');
    if (compiled.status !== 'accepted') {
        throw new Error(compiled.reason);
    }
    expect(compiled.compilerEvidence?.commands).toHaveLength(25);
    scriptTurns(revision, [
        [
            {
                id: 'catalog-1',
                name: 'agent.catalog.discover',
                arguments: { category: 'command', names: ['muteTrack'] },
            },
            {
                id: 'expand-small',
                name: 'recipe.expand',
                arguments: {
                    recipeId: 'guitar-warm',
                    targetId: '8c25eb5a-f366-460e-bd4b-15560d8ad9c0',
                    role: 'guitar',
                },
            },
        ],
        [
            {
                id: 'proposal-1',
                name: 'command.batch.propose',
                arguments: { plan, list, compiledCallIds: ['expand-small'] },
            },
        ],
    ]);
    const result = await parsePromptToActions({ prompt: PROMPT, context, projectRevision: revision });
    expect(result.applicationToolReceipts?.find((receipt) => receipt.callId === 'expand-small')?.status).toBe(
        'success'
    );
    expect(result.rejectionReason).toContain('cannot run as successive batches');
    expect(result.actions).toEqual([]);
    expect(captureProjectRevision()).toBe(revision);
});
