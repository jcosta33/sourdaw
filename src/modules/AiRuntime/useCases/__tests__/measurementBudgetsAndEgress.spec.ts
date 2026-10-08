import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    reserveNextTrackColorForCommand,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { endExportCancellationScope } from '#/modules/AudioEngine/useCases';
import {
    clearAgentMeasurementArtifacts,
    getAgentMeasurementArtifacts,
    retainAgentMeasurementRenders,
} from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    previewVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { AGENT_DATA_CATEGORIES, REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type AnalysisMeasureRead } from '../../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { classifyApplicationToolReceiptData } from '../../models/ApplicationToolReceiptData';
import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import {
    resolveMeasurementWallClockMs,
    type MeasurementAdmitter,
    type MeasurementWork,
} from '../../models/MeasurementBudget';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { generateAnthropicToolCalls } from '../../repositories/cloudLlm/cloudInference/generateAnthropicToolCalls';
import { generateOpenAiCompatibleToolCalls } from '../../repositories/cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { generateOpenAiResponsesToolCalls } from '../../repositories/cloudLlm/cloudInference/generateOpenAiResponsesToolCalls';
import { AUTO_TOOL_CHOICE } from '../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import {
    type AnthropicCloudRuntime,
    type OpenAiCloudRuntime,
    type OpenAiCompatibleCloudRuntime,
} from '../../repositories/cloudLlm/cloudSession';
import {
    compileProviderAdapterInstallation,
    OPENAI_RESPONSES_ADAPTER_ID,
} from '../../repositories/providerAdapterRegistry';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { chatStore } from '../../stores/chatStore';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { configureAgentResourceLimits } from '../configureAgentResourceLimits';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { getProjectContext } from '../getProjectContext';
import { getProviderRouteView } from '../getProviderRouteView';
import { generateToolPlanningOutcome, type ProviderAttemptAdmission } from '../llmOrchestration/inference';
import { planPromptActions } from '../planPromptActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

// Only the engine's render boundary is replaced: compilation, grounding, the isolated preview,
// target resolution, retention and the measurement figures are the real ones.
const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    updateDeviceParam: vi.fn(),
    // Wraps the real `cancelExport`, so a row can see whether a measurement's stop reaches it.
    cancelExport: vi.fn(),
}));
const backend = vi.hoisted(() => ({
    chain: { value: [] as ('cloud' | 'webllm')[] },
    getCloudProviderInfo: vi.fn(),
    generateCloudToolCalls: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    engine.cancelExport.mockImplementation(actual.cancelExport);
    return {
        ...actual,
        renderOffline: engine.renderOffline,
        renderOfflineInput: engine.renderOfflineInput,
        renderTrackSubgraphOffline: engine.renderTrackSubgraphOffline,
        updateDeviceParam: engine.updateDeviceParam,
        cancelExport: engine.cancelExport,
    };
});

// The real reductions run; the wrapper only lets a row act between two of them.
vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>();
    return { ...original, measureAgentScopeRender: vi.fn(original.measureAgentScopeRender) };
});

// The real hash runs; the wrapper only lets a row name a render of hundreds of megabytes without allocating it.
vi.mock('#/utils/agentRenderReceipt', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/utils/agentRenderReceipt')>();
    return { ...original, getAudioBufferContentAddress: vi.fn(original.getAudioBufferContentAddress) };
});

// The real preview runs; the wrapper only lets a row read back the workspace it handed out.
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        previewVersionedCommandBatchEnvelope: vi.fn(original.previewVersionedCommandBatchEnvelope),
    };
});

// The real revision check runs; the wrapper only lets a row act between a render and its reduction.
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...original,
        projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn(
            original.projectRevisionMatchesLiveIgnoringCommandCheckpoint
        ),
    };
});

// Planning turns are scripted unless a row exercises the real hosted request.
vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return { ...original, generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome) };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => backend.chain.value,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: backend.generateCloudToolCalls,
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: backend.getCloudProviderInfo,
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../transformers/promptParser/parsing')>()),
    tryPresetMatch: vi.fn(),
    tryParameterizedPath: vi.fn(),
    tryCompoundFastPath: vi.fn(),
}));

const requestAnthropic = vi.hoisted(() => vi.fn());
const requestOpenAiResponses = vi.hoisted(() => vi.fn());

vi.mock('../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: requestAnthropic,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: requestOpenAiResponses,
}));

const SAMPLE_RATE = 48_000;
const PROMPT = 'make the drums punchier and measure it';
const RUN_ID = 'run-measurement-budget';
const DRUMS_GAIN_ID = 'drums-gain';
const DRUMS_TRIM_ID = 'drums-trim';
const BASS_GAIN_ID = 'bass-gain';
const DRUMS = { kind: 'tracks', ids: ['drums'] };
const DRUMS_AND_BASS = { kind: 'tracks', ids: ['drums', 'bass'] };
const MASTER = { kind: 'master' };
const SHORT_RANGE = { startBeat: 0, endBeat: 8 };
/** Beats 0 to 400 at 120 BPM: 200 measured seconds, all of them rendered. */
const LONG_RANGE = { startBeat: 0, endBeat: 400 };
/** Beats 300 to 400: 50 measured seconds that end 200 seconds into the project. */
const LATE_RANGE = { startBeat: 300, endBeat: 400 };
/** What the wire may carry per band map: one number for each of the seven frequency bands. */
const MAX_BAND_VALUES = 7;

type SubgraphRequest = { renderTracks: readonly Track[]; abortSignal?: AbortSignal };

const DEVICE_NAMES: Readonly<Record<string, string>> = {
    [DRUMS_GAIN_ID]: 'Drums Gain',
    [DRUMS_TRIM_ID]: 'Drums Trim',
    [BASS_GAIN_ID]: 'Bass Gain',
};

function gainDevice(id: string): Track['devices'][number] {
    return {
        id,
        name: DEVICE_NAMES[id] ?? id,
        type: 'builtin-gain',
        bypassed: false,
        parameterValues: { 'gain-level': 0 },
    };
}

/** One list item setting the named gain device's level, selected by name as a provider does. */
function lowerGain(deviceId: string, value: number) {
    return {
        id: `lower-${deviceId}`,
        name: 'setDeviceParameter',
        arguments: { paramId: 'gain-level', value },
        selector: {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { name: DEVICE_NAMES[deviceId] ?? deviceId },
            quantity: { unit: 'targets', exactly: 1 },
        },
    };
}

const PROPOSAL = { schemaVersion: 1, items: [lowerGain(DRUMS_GAIN_ID, -6)] };

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

/** Each target sounds at its own level, so a baseline and a preview of one target differ. */
function renderSubgraph(request: SubgraphRequest): Promise<AudioBuffer> {
    const track = request.renderTracks.find((candidate) => candidate.id === 'drums');
    const levelDb = (track?.devices ?? []).reduce(
        (total, device) => total + (device.parameterValues['gain-level'] ?? 0),
        0
    );
    return Promise.resolve(sineBuffer(0.5 * (track?.gain ?? 1) * 10 ** (levelDb / 20)));
}

/** A render that never finishes by itself: it fails only once its abort signal fires. */
function renderUntilAborted(request: SubgraphRequest): Promise<AudioBuffer> {
    return new Promise((_resolve, reject) => {
        request.abortSignal?.addEventListener(
            'abort',
            () => {
                reject(new Error('Render aborted'));
            },
            { once: true }
        );
    });
}

function interpretationCall(revision: string): ToolCallResult {
    const catalog = prepareCreativeInterpretationCatalog({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    const drums = catalog.targets.find((target) => target.objectIds.includes('drums'));
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

function previewDependencies(revision: string) {
    const admission = admitCreativeInterpretation({
        catalog: prepareCreativeInterpretationCatalog({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        }),
        call: interpretationCall(revision),
        projectRevision: revision,
    });
    if (admission.status !== 'admitted') {
        throw new Error(`Expected the drums interpretation to be admitted: ${admission.reason}`);
    }
    const { authority } = admission;
    return { context: getProjectContext(), prompt: PROMPT, runId: RUN_ID, readCreativeAuthority: () => authority };
}

type MeasureOptions = {
    callId?: string;
    signal?: AbortSignal;
    admit?: MeasurementAdmitter;
};

function measureCallArguments(subject: 'project' | 'preview', scope: object, range: object) {
    if (subject === 'preview') {
        return { scope, range, metrics: ['integratedLoudness'], subject, proposal: PROPOSAL };
    }
    return { scope, range, metrics: ['integratedLoudness'] };
}

function measure(
    subject: 'project' | 'preview',
    scope: object,
    range: object,
    options: MeasureOptions = {}
): Promise<AnalysisMeasureRead> {
    const revision = captureProjectRevision();
    return executeAnalysisMeasure({
        call: { name: 'analysis.measure', arguments: measureCallArguments(subject, scope, range) },
        callId: options.callId ?? 'measure-1',
        turn: 1,
        projectRevision: revision,
        sections: getProjectContext().sections ?? [],
        signal: options.signal,
        admit: options.admit,
        preview: previewDependencies(revision),
    });
}

function createRun(): void {
    agentRunLifecycle.create({ runId: RUN_ID, request: PROMPT, mode: 'plan', createdRevision: null });
}

function consumedBudget() {
    return agentRunLifecycle.get(RUN_ID)?.budgets.consumed;
}

function runAdmitter(): MeasurementAdmitter {
    return agentWorkBudget.admitMeasurement(RUN_ID);
}

/** An admission that records what each measurement planned and admits all of it. */
function recordingAdmitter(planned: MeasurementWork[], order: string[] = []): MeasurementAdmitter {
    return (work) => {
        order.push('admit');
        planned.push(work);
        return { status: 'admitted', settle: () => undefined };
    };
}

function receiptCode(read: AnalysisMeasureRead): string | undefined {
    return read.receipt.error?.code;
}

/**
 * Aborts `controller` at the revision check each render ends with, once `renders` renders have
 * finished: the last point the renderer reads the run before it hands its targets back.
 */
async function abortAsRendersHandBack(controller: AbortController, renders: number): Promise<void> {
    const actual = await vi.importActual<typeof import('#/modules/CrdtDocument/useCases')>(
        '#/modules/CrdtDocument/useCases'
    );
    let finished = 0;
    engine.renderTrackSubgraphOffline.mockImplementation(async (request: SubgraphRequest) => {
        const buffer = await renderSubgraph(request);
        finished += 1;
        return buffer;
    });
    vi.mocked(projectRevisionMatchesLiveIgnoringCommandCheckpoint).mockImplementation((revision) => {
        if (finished === renders) {
            controller.abort();
        }
        return actual.projectRevisionMatchesLiveIgnoringCommandCheckpoint(revision);
    });
}

/** Aborts `controller` inside the first reduction, so a later target is the first the run may not reduce. */
async function abortInFirstReduction(controller: AbortController): Promise<void> {
    const actual = await vi.importActual<typeof import('#/modules/AudioAnalysis/useCases')>(
        '#/modules/AudioAnalysis/useCases'
    );
    vi.mocked(measureAgentScopeRender).mockImplementationOnce((buffer, metrics) => {
        controller.abort();
        return actual.measureAgentScopeRender(buffer, metrics);
    });
}

beforeEach(() => {
    configureAiWorkflowCommandPreflightFixture();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('measurement budget test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    commandTrackDefaultsPort.setTrackColorProvider(reserveNextTrackColorForCommand);
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: 'drums', name: 'Drums', kind: 'audio' }),
                devices: [gainDevice(DRUMS_GAIN_ID), gainDevice(DRUMS_TRIM_ID)],
            },
            { ...createTrack({ id: 'bass', name: 'Bass', kind: 'audio' }), devices: [gainDevice(BASS_GAIN_ID)] },
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    transportStore.set({ ...defaultTransportState, tempo: 120 });
    flushAutomergeStorageWrites();
    clearAgentMeasurementArtifacts();
    engine.renderOffline.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderOfflineInput.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderTrackSubgraphOffline.mockReset().mockImplementation(renderSubgraph);
    engine.updateDeviceParam.mockReset();
    engine.cancelExport.mockClear();
    vi.mocked(measureAgentScopeRender).mockReset();
    vi.mocked(previewVersionedCommandBatchEnvelope).mockReset();
    vi.mocked(getAudioBufferContentAddress).mockReset();
    vi.mocked(projectRevisionMatchesLiveIgnoringCommandCheckpoint).mockReset();
    vi.mocked(generateToolPlanningOutcome).mockReset();
    vi.mocked(tryPresetMatch).mockReturnValue([]);
    vi.mocked(tryParameterizedPath).mockReturnValue([]);
    vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    backend.chain.value = [];
    backend.getCloudProviderInfo.mockReset();
    backend.generateCloudToolCalls.mockReset();
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    agentRunLifecycle.clear();
    chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
});

afterEach(() => {
    vi.useRealTimers();
    agentRunLifecycle.clear();
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    resetAiWorkflowCommandPreflightFixture();
    commandTrackDefaultsPort.setTrackColorProvider(null);
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    clearAgentMeasurementArtifacts();
    // The export cancel flag is process-wide; a row that raised it must not fail a later spec's render.
    endExportCancellationScope();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    vi.unstubAllGlobals();
});

describe('a planner measurement draws on the run budgets', () => {
    // Red when the planned render count stops being one render per target.
    it('reserves one render and one reduction per project target before the first render starts', async () => {
        const planned: MeasurementWork[] = [];
        const order: string[] = [];
        engine.renderTrackSubgraphOffline.mockImplementation((request: SubgraphRequest) => {
            order.push('render');
            return renderSubgraph(request);
        });

        const read = await measure('project', DRUMS_AND_BASS, SHORT_RANGE, {
            admit: recordingAdmitter(planned, order),
        });
        await measure('project', MASTER, SHORT_RANGE, { admit: recordingAdmitter(planned) });

        expect(read.receipt.error).toBeNull();
        expect(planned).toEqual([
            { renderJobs: 2, analyses: 2 },
            { renderJobs: 1, analyses: 1 },
        ]);
        expect(order).toEqual(['admit', 'render', 'render']);
    });

    // Red when a preview stops planning both its documents' renders.
    it('reserves two renders per target and one reduction per target for a preview, before the first render', async () => {
        const planned: MeasurementWork[] = [];
        const order: string[] = [];
        engine.renderTrackSubgraphOffline.mockImplementation((request: SubgraphRequest) => {
            order.push('render');
            return renderSubgraph(request);
        });

        const read = await measure('preview', DRUMS_AND_BASS, SHORT_RANGE, {
            admit: recordingAdmitter(planned, order),
        });

        expect(read.receipt.error).toBeNull();
        expect(planned).toEqual([{ renderJobs: 4, analyses: 2 }]);
        expect(order).toEqual(['admit', 'render', 'render', 'render', 'render']);
    });

    // Red when the run's own budgets stop being the ones a measurement spends.
    it.each(['project', 'preview'] as const)(
        'spends a %s measurement against the run and ends at the renders and reductions that ran',
        async (subject) => {
            createRun();

            const read = await measure(subject, DRUMS_AND_BASS, SHORT_RANGE, { admit: runAdmitter() });

            expect(read.receipt.error).toBeNull();
            expect(consumedBudget()).toEqual({
                maxRenderJobs: subject === 'preview' ? 4 : 2,
                localAnalysis: 2,
            });
        }
    );

    // Red when a refusal still renders, or leaves half of its reservation behind.
    it('refuses a measurement the run cannot cover, renders nothing, and lets the loop continue', async () => {
        configureAgentResourceLimits({ maxRenderJobs: 1 });
        createRun();
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete' as const,
                toolCalls: [
                    {
                        id: 'measure-1',
                        name: 'analysis.measure',
                        arguments: measureCallArguments('project', DRUMS_AND_BASS, SHORT_RANGE),
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [] });
        const revision = captureProjectRevision();

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-budget',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
            measurement: {
                toolName: 'analysis.measure',
                revision,
                execute: (call, { callId, turn, signal }) =>
                    executeAnalysisMeasure({
                        call,
                        callId,
                        turn,
                        projectRevision: revision,
                        sections: [],
                        signal,
                        admit: runAdmitter(),
                    }),
            },
        });

        expect(result.receipts[0]).toMatchObject({
            status: 'failure',
            error: {
                code: 'measurement-budget-exhausted',
                retryable: false,
                safeMessage: expect.stringContaining('maxRenderJobs'),
            },
        });
        expect(requestTurn).toHaveBeenCalledTimes(2);
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(consumedBudget()).toEqual({});
    });

    // Red when a preview refusal still previews, renders, or reserves.
    it('refuses a preview the run cannot cover, renders nothing, and releases the preview it made', async () => {
        configureAgentResourceLimits({ maxRenderJobs: 3 });
        createRun();
        const actual = await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
        const previews: ReturnType<typeof previewVersionedCommandBatchEnvelope>[] = [];
        vi.mocked(previewVersionedCommandBatchEnvelope).mockImplementation((envelope) => {
            const preview = actual.previewVersionedCommandBatchEnvelope(envelope);
            previews.push(preview);
            return preview;
        });

        const read = await measure('preview', DRUMS_AND_BASS, SHORT_RANGE, { admit: runAdmitter() });

        expect(receiptCode(read)).toBe('measurement-budget-exhausted');
        expect(read.measuredPreview).toBeNull();
        expect(read.commands).toBeNull();
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(consumedBudget()).toEqual({});
        const [preview] = previews;
        expect(preview?.status).toBe('previewed');
        if (preview?.status === 'previewed') {
            expect(() => preview.workspace.getProjectDocument()).toThrow('released');
        }
    });

    // Red when settling stops trusting the renders that ran over the renders that were planned.
    it('trues the reservation down to nothing when the measurement refuses before it renders', async () => {
        createRun();

        const read = await measure('project', { kind: 'tracks', ids: ['no-such-track'] }, SHORT_RANGE, {
            admit: runAdmitter(),
        });

        expect(receiptCode(read)).toBe('unknown-target');
        expect(consumedBudget()).toEqual({ maxRenderJobs: 0, localAnalysis: 0 });
    });

    // Red when a cancel leaves the whole reservation spent, or reads as a timeout.
    it('trues the reservation down to the one render that started when the run is cancelled during it', async () => {
        createRun();
        const controller = new AbortController();
        engine.renderTrackSubgraphOffline.mockImplementation((request: SubgraphRequest) => {
            queueMicrotask(() => {
                controller.abort();
            });
            return renderUntilAborted(request);
        });

        const read = await measure('project', DRUMS_AND_BASS, SHORT_RANGE, {
            admit: runAdmitter(),
            signal: controller.signal,
        });

        expect(receiptCode(read)).toBe('cancelled');
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(consumedBudget()).toEqual({ maxRenderJobs: 1, localAnalysis: 0 });
        expect(getAgentMeasurementArtifacts()).toEqual([]);
    });

    // Red when the production planner stops giving its measurements the run they belong to.
    it('meters a measurement the production planner runs against the run that plans it', async () => {
        createRun();
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'measure-1',
                        name: 'analysis.measure',
                        arguments: measureCallArguments('project', DRUMS_AND_BASS, SHORT_RANGE),
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const planned = await planPromptActions({
            prompt: 'how loud are the drums and the bass',
            streamIdentity: { runId: RUN_ID, requestId: 'planning-request', cancellationGeneration: 0 },
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        expect(planned.result.applicationToolReceipts).toMatchObject([
            { toolName: 'analysis.measure', status: 'success' },
        ]);
        expect(consumedBudget()).toEqual({ maxRenderJobs: 2, localAnalysis: 2 });
    });
});

describe('a planner measurement stops with its run', () => {
    // Red when the check between a finished render and its reduction goes, or the artifacts it retained stay.
    it.each([
        { subject: 'project', renders: 1 },
        { subject: 'preview', renders: 2 },
    ] as const)(
        'returns cancelled for a $subject measurement cancelled between its renders and its reduction, retaining nothing',
        async ({ subject, renders }) => {
            createRun();
            const controller = new AbortController();
            await abortAsRendersHandBack(controller, renders);

            const read = await measure(subject, DRUMS, SHORT_RANGE, {
                admit: runAdmitter(),
                signal: controller.signal,
            });

            expect(receiptCode(read)).toBe('cancelled');
            expect(read.measuredPreview).toBeNull();
            expect(read.commands).toBeNull();
            expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(renders);
            expect(measureAgentScopeRender).not.toHaveBeenCalled();
            expect(getAgentMeasurementArtifacts()).toEqual([]);
            expect(consumedBudget()).toEqual({ maxRenderJobs: renders, localAnalysis: 0 });
        }
    );

    // Red when the run is checked once for the measurement rather than before each target's reduction.
    it.each([
        { subject: 'project', reductions: 1 },
        { subject: 'preview', reductions: 2 },
    ] as const)(
        'stops a $subject measurement before the next target is reduced once the run is cancelled',
        async ({ subject, reductions }) => {
            createRun();
            const controller = new AbortController();
            await abortInFirstReduction(controller);

            const read = await measure(subject, DRUMS_AND_BASS, SHORT_RANGE, {
                admit: runAdmitter(),
                signal: controller.signal,
            });

            expect(receiptCode(read)).toBe('cancelled');
            expect(measureAgentScopeRender).toHaveBeenCalledTimes(reductions);
            expect(getAgentMeasurementArtifacts()).toEqual([]);
            expect(consumedBudget()).toMatchObject({ localAnalysis: 1 });
        }
    );
});

describe('a planner measurement is bounded in duration', () => {
    // Red when the measured-seconds ceiling goes back to a constant, or the raised one is not read.
    it('refuses a range past the configured measured-seconds ceiling and admits it once the ceiling is raised', async () => {
        createRun();
        configureAgentResourceLimits({ measurementMeasuredSeconds: 100 });

        const refused = await measure('project', DRUMS, LONG_RANGE, { admit: runAdmitter() });

        expect(refused.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'range-exceeds-ceiling', safeMessage: expect.stringContaining('at most 100 s') },
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(consumedBudget()).toEqual({});

        configureAgentResourceLimits({ measurementMeasuredSeconds: 300 });
        const admitted = await measure('project', DRUMS, LONG_RANGE, { admit: runAdmitter() });

        expect(admitted.receipt.error).toBeNull();
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
    });

    // Red when the rendered-seconds ceiling goes back to a constant, or the raised one is not read.
    it('refuses a range that ends past the configured rendered-seconds ceiling and admits it once raised', async () => {
        configureAgentResourceLimits({ measurementRenderedSeconds: 100 });

        const refused = await measure('project', DRUMS, LATE_RANGE);

        expect(refused.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'range-exceeds-ceiling', safeMessage: expect.stringContaining('within 100 s') },
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();

        configureAgentResourceLimits({ measurementRenderedSeconds: 300 });
        const admitted = await measure('project', DRUMS, LATE_RANGE);

        expect(admitted.receipt.error).toBeNull();
    });

    // Red when a preview keeps rendering against the constant ceilings.
    it('holds a preview to the configured ceilings too, and renders nothing past them', async () => {
        configureAgentResourceLimits({ measurementMeasuredSeconds: 100 });

        const refused = await measure('preview', DRUMS, LONG_RANGE);

        expect(refused.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'range-exceeds-ceiling', safeMessage: expect.stringContaining('at most 100 s') },
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();

        configureAgentResourceLimits({ measurementMeasuredSeconds: 300 });
        const admitted = await measure('preview', DRUMS, LONG_RANGE);

        expect(admitted.receipt.error).toBeNull();
    });

    // Red when the allowance stops being four times the total seconds all renders process, floored, and capped by the ceiling.
    it.each([
        { renderJobs: 1, renderedSeconds: 1_000, ceilingMs: 120_000, expectedMs: 120_000 },
        { renderJobs: 1, renderedSeconds: 10, ceilingMs: 120_000, expectedMs: 40_000 },
        { renderJobs: 2, renderedSeconds: 10, ceilingMs: 120_000, expectedMs: 80_000 },
        { renderJobs: 4, renderedSeconds: 5, ceilingMs: 120_000, expectedMs: 80_000 },
        { renderJobs: 4, renderedSeconds: 10, ceilingMs: 120_000, expectedMs: 120_000 },
        { renderJobs: 1, renderedSeconds: 1, ceilingMs: 120_000, expectedMs: 10_000 },
        { renderJobs: 2, renderedSeconds: 1, ceilingMs: 120_000, expectedMs: 10_000 },
        { renderJobs: 4, renderedSeconds: 10, ceilingMs: 5_000, expectedMs: 5_000 },
    ])(
        'allows $expectedMs ms to $renderJobs render(s) of $renderedSeconds s under a $ceilingMs ms ceiling',
        ({ renderJobs, renderedSeconds, ceilingMs, expectedMs }) => {
            expect(resolveMeasurementWallClockMs({ renderJobs, renderedSeconds, ceilingMs })).toBe(expectedMs);
        }
    );

    // Red when the allowance is sized for one render although a two-target preview runs four of them.
    it('lets a two-target preview finish four renders that together outlast one render’s allowance', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let rendersInFlight = 0;
        engine.renderTrackSubgraphOffline.mockImplementation(
            () =>
                new Promise((resolve) => {
                    rendersInFlight += 1;
                    setTimeout(() => {
                        rendersInFlight -= 1;
                        resolve(sineBuffer(0.5));
                    }, 3_000);
                })
        );
        let settled = false;
        // 2.5 rendered seconds at 120 BPM: one render's allowance is the 10 s floor, four renders' is 40 s.
        const pending = measure('preview', DRUMS_AND_BASS, { startBeat: 0, endBeat: 5 }).finally(() => {
            settled = true;
        });

        // Lockstep: the clock moves only once a render's own timer is pending beside the deadline's,
        // so real async work (hashing, previews) never lets the fake clock run ahead of the renders.
        for (let tick = 0; tick < 10_000 && !settled; tick += 1) {
            await new Promise((resolve) => {
                setImmediate(resolve);
            });
            if (rendersInFlight > 0 || vi.getTimerCount() > 1) {
                await vi.advanceTimersToNextTimerAsync();
            }
        }
        const read = await pending;

        expect(read.receipt.error).toBeNull();
        expect(read.receipt.status).toBe('success');
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(4);
    });

    // Red when the deadline stops reaching the renders, or its expiry reads as a user cancel.
    it.each(['project', 'preview'] as const)(
        'stops a %s measurement that outlives its wall-clock allowance and says it timed out',
        async (subject) => {
            createRun();
            configureAgentResourceLimits({ measurementWallClockMs: 50 });
            engine.renderTrackSubgraphOffline.mockImplementation(renderUntilAborted);

            const read = await measure(subject, DRUMS, SHORT_RANGE, { admit: runAdmitter() });

            expect(read.receipt).toMatchObject({
                status: 'failure',
                error: { code: 'measurement-timed-out', retryable: true },
            });
            expect(read.measuredPreview).toBeNull();
            expect(read.commands).toBeNull();
            expect(getAgentMeasurementArtifacts()).toEqual([]);
            expect(consumedBudget()).toEqual({ maxRenderJobs: 1, localAnalysis: 0 });
        }
    );

    // Red when the deadline stops joining the run's signal: a live run signal alone never fires.
    it.each(['project', 'preview'] as const)(
        'times a %s measurement out while the run it belongs to is still live',
        async (subject) => {
            configureAgentResourceLimits({ measurementWallClockMs: 50 });
            engine.renderTrackSubgraphOffline.mockImplementation(renderUntilAborted);
            const liveRun = new AbortController();

            const read = await measure(subject, DRUMS, SHORT_RANGE, { signal: liveRun.signal });

            expect(receiptCode(read)).toBe('measurement-timed-out');
            expect(liveRun.signal.aborted).toBe(false);
        }
    );
});

/** Content addresses of the retained renders, in a stable order. */
function retainedAddresses(): string[] {
    return getAgentMeasurementArtifacts()
        .map((artifact) => artifact.contentAddress)
        .toSorted();
}

function tinyBuffer(): AudioBuffer {
    return {
        sampleRate: SAMPLE_RATE,
        length: 4,
        numberOfChannels: 1,
        duration: 4 / SAMPLE_RATE,
        getChannelData: () => new Float32Array(4),
    } as unknown as AudioBuffer;
}

/** Fills the store with `count` renders of earlier measurements, as many as it holds when `count` is 16. */
function seedArtifacts(count: number): string[] {
    const addresses = Array.from(
        { length: count },
        (_unused, index) => `seed-render-${String(index).padStart(2, '0')}`
    );
    retainAgentMeasurementRenders({
        renders: addresses.map((contentAddress) => ({ contentAddress, buffer: tinyBuffer() })),
        sourceRevision: 'seed-revision',
    });
    return addresses;
}

describe('a measurement that does not report leaves the shared state as it found it', () => {
    // Red when renders are retained before they are reported, or a stop discards what an earlier receipt cites.
    it.each(['project', 'preview'] as const)(
        'keeps the renders an earlier %s receipt cites when the same measurement is cancelled in its first reduction',
        async (subject) => {
            const first = await measure(subject, DRUMS_AND_BASS, SHORT_RANGE, { callId: 'measure-1' });
            const cited = retainedAddresses();
            const controller = new AbortController();
            await abortInFirstReduction(controller);

            const repeat = await measure(subject, DRUMS_AND_BASS, SHORT_RANGE, {
                callId: 'measure-2',
                signal: controller.signal,
            });

            expect(first.receipt.error).toBeNull();
            expect(cited.length).toBeGreaterThan(0);
            expect(receiptCode(repeat)).toBe('cancelled');
            expect(retainedAddresses()).toEqual(cited);
        }
    );

    // Red when a stopped measurement on a full store evicts older renders it never reports.
    it.each(['project', 'preview'] as const)(
        'leaves all 16 retained renders when a 2-target %s measurement is cancelled on a full store',
        async (subject) => {
            const seeded = seedArtifacts(16);
            const controller = new AbortController();
            await abortInFirstReduction(controller);

            const read = await measure(subject, DRUMS_AND_BASS, SHORT_RANGE, { signal: controller.signal });

            expect(receiptCode(read)).toBe('cancelled');
            expect(retainedAddresses()).toEqual(seeded);
        }
    );

    // Red when a reduction that throws still leaves its renders in the store.
    it.each(['project', 'preview'] as const)(
        'leaves the store unchanged when a %s reduction throws',
        async (subject) => {
            const seeded = seedArtifacts(3);
            createRun();
            vi.mocked(measureAgentScopeRender).mockImplementationOnce(() => {
                throw new Error('reduction failed');
            });

            await expect(measure(subject, DRUMS_AND_BASS, SHORT_RANGE, { admit: runAdmitter() })).rejects.toThrow(
                'reduction failed'
            );

            expect(retainedAddresses()).toEqual(seeded);
            expect(consumedBudget()).toEqual({ maxRenderJobs: subject === 'preview' ? 4 : 2, localAnalysis: 0 });
        }
    );

    // Red when a measurement that reports stops retaining its renders against the revision it measured.
    it.each(['project', 'preview'] as const)(
        'retains the renders a reporting %s measurement cites, against the revision it measured',
        async (subject) => {
            const revision = captureProjectRevision();

            const read = await measure(subject, DRUMS, SHORT_RANGE);

            const cited = Array.from(
                JSON.stringify(read.receipt.data).matchAll(/"contentAddress":"([^"]+)"/gu),
                (match) => match[1]
            ).toSorted();
            expect(read.receipt.error).toBeNull();
            expect(cited).toHaveLength(subject === 'preview' ? 2 : 1);
            expect(retainedAddresses()).toEqual(cited);
            expect(getAgentMeasurementArtifacts().map((artifact) => artifact.sourceRevision)).toEqual(
                cited.map(() => revision)
            );
        }
    );

    // `cancelExport` raises the shared export flag only while a musician's export holds the render
    // lock, and also aborts a musician's export that is queued behind an agent render. A measurement's
    // stop routed through it would therefore cancel a musician's export, so this pins that the stop
    // never calls it. It pins the call, not the flag: with no export holding the lock the flag stays
    // down whichever way the stop travels. Red when the measurement's abort calls `cancelExport`.
    it('stops a timed-out master measurement on its own signal without calling cancelExport', async () => {
        configureAgentResourceLimits({ measurementWallClockMs: 50 });
        engine.renderOffline.mockImplementation(
            (options: { abortSignal?: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    // A real render winds down at its next segment boundary, not at the abort itself.
                    options.abortSignal?.addEventListener(
                        'abort',
                        () => {
                            setTimeout(() => {
                                reject(new Error('Export cancelled'));
                            }, 30);
                        },
                        { once: true }
                    );
                })
        );
        const read = await measure('project', MASTER, SHORT_RANGE, { signal: new AbortController().signal });

        expect(receiptCode(read)).toBe('measurement-timed-out');
        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(engine.cancelExport).not.toHaveBeenCalled();
    });
});

/** Frames of a mono render that alone exceed the retention byte limit (280 MB against 256 MB). */
const OVERSIZED_FRAMES = 70_000_000;
/** Frames of a mono render that fit alone (160 MB) but not as a pair. */
const PAIR_FRAMES = 40_000_000;

type TaggedBuffer = AudioBuffer & { address: string };

/** A render that claims `frames` frames while holding none, so a row can size retention without allocating. */
function claimedBuffer(address: string, frames: number): TaggedBuffer {
    return {
        sampleRate: SAMPLE_RATE,
        length: frames,
        numberOfChannels: 1,
        duration: frames / SAMPLE_RATE,
        getChannelData: () => new Float32Array(4),
        address,
    } as unknown as TaggedBuffer;
}

/** Each isolated render hands back the next buffer, and reports `warningsPerRender` renderer warnings. */
function renderClaimedBuffers(buffers: readonly TaggedBuffer[], warningsPerRender: number): void {
    const remaining = [...buffers];
    vi.mocked(getAudioBufferContentAddress).mockImplementation((buffer) =>
        Promise.resolve((buffer as TaggedBuffer).address)
    );
    vi.mocked(measureAgentScopeRender).mockImplementation(() => ({
        integratedLoudness: { status: 'measured', metricVersion: 1, unit: 'LUFS', value: -20, confidence: 'exact' },
    }));
    engine.renderTrackSubgraphOffline.mockImplementation((request: { onWarning?: (message: string) => void }) => {
        for (let count = 0; count < warningsPerRender; count += 1) {
            request.onWarning?.(`renderer warning ${String(count)}`);
        }
        const next = remaining.shift();
        if (next === undefined) {
            throw new Error('The row scripted fewer renders than the measurement ran.');
        }
        return Promise.resolve(next);
    });
}

/** The addresses a successful receipt cites, whichever render of it cites them. */
function citedAddresses(read: AnalysisMeasureRead): string[] {
    return Array.from(
        JSON.stringify(read.receipt.data).matchAll(/"contentAddress":"([^"]+)"/gu),
        (match) => match[1] ?? ''
    );
}

describe('every render a successful receipt cites is kept or named', () => {
    // Red when a retention line is the one the warning cap cuts, or retention stops naming an oversized render.
    it('names an oversized render beside the warnings the renderers already filled the cap with', async () => {
        renderClaimedBuffers(
            [
                claimedBuffer('oversized-baseline', OVERSIZED_FRAMES),
                claimedBuffer('baseline-bass', 1_000),
                claimedBuffer('preview-drums', 1_000),
                claimedBuffer('preview-bass', 1_000),
            ],
            2
        );

        const read = await measure('preview', DRUMS_AND_BASS, SHORT_RANGE);

        expect(read.receipt.error).toBeNull();
        expect(read.receipt.warnings).toHaveLength(8);
        expect(read.receipt.warnings.some((warning) => warning.includes('oversized-baseline'))).toBe(true);
        expect(retainedAddresses()).not.toContain('oversized-baseline');
    });

    // Red when the project path puts its retention lines after the renderer warnings the cap cuts from.
    it('names an oversized render of a four-target project measurement whose renderers filled the cap', async () => {
        trackStore.set({
            tracks: [
                createTrack({ id: 'master', name: 'Master', kind: 'master' }),
                ...['drums', 'bass', 'keys', 'pad'].map((id) => createTrack({ id, name: id, kind: 'audio' })),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        renderClaimedBuffers(
            [
                claimedBuffer('oversized-drums', OVERSIZED_FRAMES),
                claimedBuffer('bass', 1_000),
                claimedBuffer('keys', 1_000),
                claimedBuffer('pad', 1_000),
            ],
            2
        );

        const read = await measure('project', { kind: 'tracks', ids: ['drums', 'bass', 'keys', 'pad'] }, SHORT_RANGE);

        expect(read.receipt.error).toBeNull();
        expect(read.receipt.warnings).toHaveLength(8);
        expect(read.receipt.warnings.some((warning) => warning.includes('oversized-drums'))).toBe(true);
    });

    // Red when one render cited twice is named twice, spending a warning slot on a repeat.
    it('names a render cited by both documents of a preview once', async () => {
        const shared = claimedBuffer('shared-oversized', OVERSIZED_FRAMES);
        renderClaimedBuffers([shared, shared], 0);

        const read = await measure('preview', DRUMS, SHORT_RANGE);

        expect(read.receipt.error).toBeNull();
        expect(citedAddresses(read)).toEqual(['shared-oversized', 'shared-oversized']);
        expect(read.receipt.warnings).toEqual([expect.stringContaining('shared-oversized')]);
    });

    // Red when retention stops naming a render too large to keep, which no row observed before.
    it('names a plain oversized render and does not retain it', async () => {
        renderClaimedBuffers([claimedBuffer('oversized-render', OVERSIZED_FRAMES)], 0);

        const read = await measure('project', DRUMS, SHORT_RANGE);

        expect(read.receipt.error).toBeNull();
        expect(read.receipt.warnings).toEqual([expect.stringContaining('oversized-render')]);
        expect(retainedAddresses()).toEqual([]);
    });

    // Red when a batch over the byte limit evicts its own earlier render without naming it.
    it('names the earlier render of a pair that together exceeds the byte limit', async () => {
        renderClaimedBuffers(
            [claimedBuffer('pair-baseline', PAIR_FRAMES), claimedBuffer('pair-preview', PAIR_FRAMES)],
            0
        );

        const read = await measure('preview', DRUMS, SHORT_RANGE);

        expect(read.receipt.error).toBeNull();
        expect(citedAddresses(read).toSorted()).toEqual(['pair-baseline', 'pair-preview']);
        expect(retainedAddresses()).toEqual(['pair-preview']);
        expect(read.receipt.warnings).toEqual([expect.stringContaining('pair-baseline')]);
    });
});

function measurementReceipt(subject: 'project' | 'preview', callId: string): Promise<ApplicationToolReceipt> {
    return measure(subject, DRUMS_AND_BASS, SHORT_RANGE, { callId }).then((read) => read.receipt);
}

function historyOf(...receipts: ApplicationToolReceipt[]): HostedTurnHistory {
    return [
        {
            turn: 1,
            provider: 'anthropic',
            assistantItems: null,
            calls: receipts.map((receipt) => ({ id: receipt.callId, name: 'analysis.measure', arguments: {} })),
            receipts,
        },
    ];
}

describe('a measurement is local numeric evidence for the data policy', () => {
    // Red when a measurement receipt stops naming the measurement category, or another receipt starts to.
    it('classifies a successful measure receipt as measurement and nothing else', async () => {
        const project = await measurementReceipt('project', 'measure-1');
        const preview = await measurementReceipt('preview', 'measure-2');
        const refused = (await measure('project', { kind: 'tracks', ids: ['no-such-track'] }, SHORT_RANGE)).receipt;
        const query: ApplicationToolReceipt = {
            ...project,
            toolName: 'project.query',
            data: { kind: 'project-query' },
        };

        expect(classifyApplicationToolReceiptData(project)).toEqual(['measurement']);
        expect(classifyApplicationToolReceiptData(preview)).toEqual(['measurement']);
        expect(classifyApplicationToolReceiptData(refused)).toEqual([]);
        expect(classifyApplicationToolReceiptData(query)).toEqual([]);
        expect(AGENT_DATA_CATEGORIES).toContain('measurement');
    });

    const hostedTools: ToolSchema[] = [
        {
            type: 'function',
            function: {
                name: 'muteTrack',
                description: 'Mute one track.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { trackId: { type: 'string' } },
                    required: ['trackId'],
                },
            },
        },
    ];

    async function planHostedTurn(history: HostedTurnHistory): Promise<ProviderAttemptAdmission> {
        backend.chain.value = ['cloud'];
        backend.getCloudProviderInfo.mockReturnValue({
            provider: 'anthropic',
            model: 'hosted-model',
            baseUrl: 'https://api.anthropic.com',
            authentication: 'api-key',
        });
        backend.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'drums' } }],
            strictToolSchemas: true,
            usage: null,
        });
        const admissions: ProviderAttemptAdmission[] = [];
        await generateToolPlanningOutcome(
            'system',
            'mute the drums',
            hostedTools,
            undefined,
            'mute the drums',
            undefined,
            { runId: RUN_ID, requestId: `request-${String(history.length)}`, cancellationGeneration: 0 },
            (admission) => {
                admissions.push(admission);
                return { status: 'admitted' };
            },
            AUTO_TOOL_CHOICE,
            { firstUserMessage: 'mute the drums', history, budgetNote: 'Budget remaining.' }
        );
        const [admission] = admissions;
        if (admission === undefined) {
            throw new Error('Expected the hosted planning request to be admitted.');
        }
        return admission;
    }

    // Red when a replayed measure receipt stops adding its category to what the request declares.
    it('declares measurement on a hosted planning request whose history replays a measure receipt, and discloses it', async () => {
        createRun();
        const receipt = await measurementReceipt('project', 'measure-1');

        const admission = await planHostedTurn(historyOf(receipt));

        expect(admission.request.dataCategories).toEqual([...REMOTE_TEXT_AGENT_DATA_CATEGORIES, 'measurement']);
        expect(getProviderRouteView({ runId: RUN_ID, candidates: [] })?.dataDisclosure?.categories).toEqual([
            ...REMOTE_TEXT_AGENT_DATA_CATEGORIES,
            'measurement',
        ]);
    });

    // Red when a request starts declaring measurement it does not carry.
    it('declares no measurement on a hosted planning request whose history holds none', async () => {
        createRun();
        const receipt = await measurementReceipt('project', 'measure-1');
        const unrelated: ApplicationToolReceipt = { ...receipt, toolName: 'project.query', data: { kind: 'project' } };

        const admission = await planHostedTurn(historyOf(unrelated));

        expect(admission.request.dataCategories).toEqual([...REMOTE_TEXT_AGENT_DATA_CATEGORIES]);
        expect(getProviderRouteView({ runId: RUN_ID, candidates: [] })?.dataDisclosure?.categories).toEqual([
            ...REMOTE_TEXT_AGENT_DATA_CATEGORIES,
        ]);
    });
});

/** A body that is, or carries as keys or encoded text, anything other than the figures a receipt reports. */
const AUDIO_KEY = /^(samples?|pcm|audio|buffer|channeldata)$/iu;
const BASE64_BLOB = /^[A-Za-z0-9+/]{256,}={0,2}$/u;
const INDEX_KEY = /^\d+$/u;

function parseEncodedJson(value: string): unknown {
    if (!/^\s*[[{]/u.test(value)) {
        return value;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}

function containsSampleData(value: unknown): boolean {
    if (ArrayBuffer.isView(value)) {
        return true;
    }
    if (typeof value === 'string') {
        const decoded = parseEncodedJson(value);
        return decoded === value ? BASE64_BLOB.test(value) : containsSampleData(decoded);
    }
    if (Array.isArray(value)) {
        const isNumberSeries = value.length > MAX_BAND_VALUES && value.every((entry) => typeof entry === 'number');
        return isNumberSeries || value.some(containsSampleData);
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value);
        // A typed array serializes as an object keyed by index.
        const isIndexedSeries = entries.length > MAX_BAND_VALUES && entries.every(([key]) => INDEX_KEY.test(key));
        return isIndexedSeries || entries.some(([key, entry]) => AUDIO_KEY.test(key) || containsSampleData(entry));
    }
    return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every application tool receipt a request body carries, wherever it is encoded. */
function receiptsOn(value: unknown): Record<string, unknown>[] {
    if (typeof value === 'string') {
        const decoded = parseEncodedJson(value);
        return decoded === value ? [] : receiptsOn(decoded);
    }
    if (Array.isArray(value)) {
        return value.flatMap(receiptsOn);
    }
    if (!isRecord(value)) {
        return [];
    }
    if (value.schema === 'sourdaw.application-tool-receipt') {
        return [value];
    }
    return Object.values(value).flatMap(receiptsOn);
}

function isScalarOrBandRecord(value: unknown): boolean {
    if (typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (!isRecord(value)) {
        return false;
    }
    const bands = Object.values(value);
    return bands.length <= MAX_BAND_VALUES && bands.every((band) => typeof band === 'number');
}

/** Each metric of each measured figure is a number, a flag, or one number per band. */
function measurementEntriesAreScalarsOrBandRecords(receipt: Record<string, unknown>): boolean {
    const data = isRecord(receipt.data) ? receipt.data : {};
    const targets = Array.isArray(data.targets) ? data.targets : [];
    const figures = targets.flatMap((target) =>
        isRecord(target) ? [target.measurements, target.baseline, target.preview].filter(isRecord) : []
    );
    const entries = figures.flatMap((figure) => Object.values(figure)).filter(isRecord);
    return (
        entries.length > 0 &&
        entries.every((entry) => entry.status === 'unavailable' || isScalarOrBandRecord(entry.value))
    );
}

const anthropicRuntime: AnthropicCloudRuntime = {
    provider: 'anthropic',
    authentication: 'api-key',
    model: 'claude-test',
    session_id: 'provider-session-00000000000000000000000000000000',
};
const openAiRuntime: OpenAiCloudRuntime = {
    provider: 'openai',
    model: 'gpt-test',
    base_url: 'https://api.openai.com/v1',
    authentication: 'api-key',
    adapter: compileProviderAdapterInstallation({
        adapterId: OPENAI_RESPONSES_ADAPTER_ID,
        providerId: 'openai',
        modelId: 'gpt-test',
        protocolFamily: 'openai-responses',
        origin: 'https://api.openai.com',
    }),
    session_id: `provider-session-${'0'.repeat(32)}`,
};
const compatibleRuntime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: 'compatible-model',
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: false,
};
const wireTools: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'analysis.measure',
            description: 'Measure the project.',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
    },
];

/** The turn every dialect is asked to replay: the first message, the history, the budget note. */
function wireTurn(history: HostedTurnHistory) {
    return {
        systemPrompt: 'system',
        userMessage: 'how loud is the mix',
        toolSchemas: wireTools,
        maxOutputTokens: 8_192,
        directive: AUTO_TOOL_CHOICE,
        history,
        budgetNote: 'Budget remaining.',
    };
}

type WireBodies = { anthropic: unknown; openAiResponses: unknown; openAiCompatible: unknown };

/** What each hosted dialect actually puts on the wire for this history. The reply is beside the point. */
async function buildWireBodies(history: HostedTurnHistory): Promise<WireBodies> {
    const bodies: string[] = [];
    const reply = (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
        bodies.push(request.body);
        request.onBodyChunk(new TextEncoder().encode('{}'));
        return Promise.resolve({ status: 200, contentType: 'application/json' });
    };
    requestAnthropic.mockImplementation(reply);
    requestOpenAiResponses.mockImplementation(reply);
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((_url, init) => {
            if (typeof init?.body !== 'string') {
                throw new TypeError('Expected a JSON request body.');
            }
            bodies.push(init.body);
            return Promise.resolve(
                new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
            );
        })
    );
    const turn = wireTurn(history);
    await generateAnthropicToolCalls({
        ...turn,
        runtime: anthropicRuntime,
        signal: new AbortController().signal,
    }).catch(() => undefined);
    await generateOpenAiResponsesToolCalls({ ...turn, runtime: openAiRuntime }).catch(() => undefined);
    await generateOpenAiCompatibleToolCalls({ ...turn, runtime: compatibleRuntime }).catch(() => undefined);
    const [anthropic, openAiResponses, openAiCompatible] = bodies.map((body) => JSON.parse(body) as unknown);
    return { anthropic, openAiResponses, openAiCompatible };
}

function withTargetField(receipt: ApplicationToolReceipt, field: Record<string, unknown>): ApplicationToolReceipt {
    const data = isRecord(receipt.data) ? receipt.data : {};
    const targets = Array.isArray(data.targets) ? data.targets.filter(isRecord) : [];
    return { ...receipt, data: { ...data, targets: targets.map((target) => ({ ...target, ...field })) } };
}

describe('no sample data reaches a hosted provider', () => {
    const DIALECTS = ['anthropic', 'openAiResponses', 'openAiCompatible'] as const;

    // Red when a receipt starts carrying samples, a buffer, or an encoded blob to the wire.
    it.each(DIALECTS)(
        'sends the %s request holding only scalars and band records for a project and a preview',
        async (dialect) => {
            const project = await measurementReceipt('project', 'measure-1');
            const preview = await measurementReceipt('preview', 'measure-2');

            const bodies = await buildWireBodies(historyOf(project, preview));

            const onWire = receiptsOn(bodies[dialect]);
            expect(onWire.map((receipt) => receipt.callId)).toEqual(['measure-1', 'measure-2']);
            expect(containsSampleData(bodies[dialect])).toBe(false);
            for (const receipt of onWire) {
                expect(measurementEntriesAreScalarsOrBandRecords(receipt)).toBe(true);
            }
        }
    );

    // Red when the detector stops flagging a 1024-long number array, whichever way it is carried.
    it.each(DIALECTS)('flags the %s request whose receipt carries a 1024-sample array', async (dialect) => {
        const project = await measurementReceipt('project', 'measure-1');
        const samples = Array.from({ length: 1_024 }, (_unused, index) => Math.sin(index));
        const channel = new Float32Array(samples);
        const poisoned = {
            series: withTargetField(project, { levels: samples }),
            named: withTargetField(project, { samples: [0.25] }),
            typed: withTargetField(project, { levels: channel }),
            encoded: withTargetField(project, { levels: 'A'.repeat(512) }),
        };

        for (const [carrier, receipt] of Object.entries(poisoned)) {
            const bodies = await buildWireBodies(historyOf(receipt));
            expect({ carrier, flagged: containsSampleData(bodies[dialect]) }).toEqual({ carrier, flagged: true });
        }
    });

    // Red when the entry check stops rejecting a metric whose value is a series.
    it('rejects a measurement entry that carries a 1024-long series instead of a scalar or band record', async () => {
        const project = await measurementReceipt('project', 'measure-1');
        const series = Array.from({ length: 1_024 }, () => 0.1);
        const data = isRecord(project.data) ? project.data : {};
        const [target] = Array.isArray(data.targets) ? data.targets : [];
        const measurements = isRecord(target) && isRecord(target.measurements) ? target.measurements : {};
        const poisoned = withTargetField(project, {
            measurements: { ...measurements, integratedLoudness: { status: 'measured', value: series } },
        });

        const [cleanOnWire] = receiptsOn(JSON.stringify(project));
        const [poisonedOnWire] = receiptsOn(JSON.stringify(poisoned));
        expect(cleanOnWire && measurementEntriesAreScalarsOrBandRecords(cleanOnWire)).toBe(true);
        expect(poisonedOnWire && measurementEntriesAreScalarsOrBandRecords(poisonedOnWire)).toBe(false);
    });
});
