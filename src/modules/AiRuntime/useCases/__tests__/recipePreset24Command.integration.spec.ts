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
import { type IntentResult } from '../../models/IntentResult';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
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
const DRUMS_SCOPE = { kind: 'tracks', ids: ['guitar-1'] };
const DRUMS_GAIN_ID = 'existing';
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
    const track = request.renderTracks.find((candidate) => candidate.id === 'guitar-1');
    const levelDb = (track?.devices ?? []).reduce(
        (total, device) => total + (device.parameterValues['gain-level'] ?? 0),
        0
    );
    return Promise.resolve(sineBuffer(0.5 * (track?.gain ?? 1) * 10 ** (levelDb / 20)));
}

/** The interpretation a hosted run admits for the prompt: edit the drums' processing. */
function interpretationCall(revision: string): ToolCallResult {
    const catalog = prepareCreativeInterpretationCatalog({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    const drums = catalog.targets.find((target) => target.objectIds.includes('guitar-1'));
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
        affectedIds: ['guitar-1'],
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
                ...createTrack({ id: 'guitar-1', name: 'Guitar', kind: 'audio' }),
                devices: [gainDevice(DRUMS_GAIN_ID)],
            },
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    // Controlled runtime reducer starts at the existing strip and validates each topology transition.
    const initial = trackStore.value?.tracks.find((track) => track.id === 'guitar-1');
    if (initial === undefined) throw new Error('Missing guitar fixture');
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
    const before = structuredClone(trackStore.value?.tracks.find((track) => track.id === 'guitar-1')?.devices);
    const historyBefore = structuredClone(undoHistoryStore.value);
    scriptTurns(revision, [
        [{ id: 'discover-1', name: 'recipe.discover', arguments: { descriptors: ['warm'], role: 'guitar' } }],
        [
            {
                id: 'expand-1',
                name: 'recipe.expand',
                arguments: { recipeId: 'preset:fx-chain-guitar-clean:warm', targetId: 'guitar-1', role: 'guitar' },
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
    expect(view?.recipes).toMatchObject([{ recipeId: 'preset:fx-chain-guitar-clean:warm', targetId: 'guitar-1' }]);
    expect(view?.measuredPreview?.targets).toHaveLength(1);
    const receipt = planned.applicationToolReceipts?.find((entry) => entry.callId === 'expand-1');
    expect(new TextEncoder().encode(JSON.stringify(receipt)).length).toBeLessThanOrEqual(16384);
    expect(vi.mocked(generateToolPlanningOutcome).mock.calls.at(-1)?.[9]?.localReceiptContextComplete).toBe(true);
    const pending = getPendingActionConfirmation(confirmationId);
    expect(pending?.approvalSnapshot.measuredPreview?.batchContentHash).toBe(planned.measuredPreview?.batchContentHash);
    const batch = pending?.approvalSnapshot.commandBatch;
    if (batch === undefined) throw new Error('Missing command batch');
    const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    if (parsed.status === 'invalid') throw new Error(parsed.reason);
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
    expect(trackStore.value?.tracks.find((track) => track.id === 'guitar-1')?.devices).toEqual(before);
    expect(undoHistoryStore.value).toEqual(historyBefore);
    expect(await confirmPendingChatActions({ confirmationId })).toEqual({ status: 'executed' });
    const devices = trackStore.value?.tracks.find((track) => track.id === 'guitar-1')?.devices ?? [];
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
    expect(engine.updateDeviceParam).toHaveBeenCalled();
    expect(await undo()).toEqual({ headConsumed: true });
    expect(trackStore.value?.tracks.find((track) => track.id === 'guitar-1')?.devices).toEqual(before);
});
