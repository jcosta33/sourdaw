import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    analyzeAgentReferenceBuffer,
    compareAgentScopeMeasurements,
    getAgentMeasurementMetricIds,
} from '#/modules/AudioAnalysis/useCases';
import { clearAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { assertRemoteAgentDataPolicy, REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { classifyApplicationToolReceiptData } from '../../models/ApplicationToolReceiptData';
import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import { type ProjectContextSection } from '../../models/ProjectContext';
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
import { agentReferenceStore, readAgentReference } from '../../stores/agentReferenceStore';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { agentRunLifecycle } from '../agentRunLifecycle';
import {
    ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    getAgentToolCatalogSchemas,
} from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { executeReferenceMeasurement } from '../executeReferenceMeasurement';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';
import { generateToolPlanningOutcome, type ProviderAttemptAdmission } from '../llmOrchestration/inference';

const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    isExportActive: vi.fn(),
    cancelExport: vi.fn(),
}));
const transport = vi.hoisted(() => ({ readSecondsAtBeat: vi.fn() }));
const crdt = vi.hoisted(() => ({ projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn() }));
const backend = vi.hoisted(() => ({
    chain: { value: [] as ('cloud' | 'webllm')[] },
    getCloudProviderInfo: vi.fn(),
    generateCloudToolCalls: vi.fn(),
}));
const requestAnthropic = vi.hoisted(() => vi.fn());
const requestOpenAiResponses = vi.hoisted(() => vi.fn());

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: engine.renderOffline,
    renderTrackSubgraphOffline: engine.renderTrackSubgraphOffline,
    isExportActive: engine.isExportActive,
    cancelExport: engine.cancelExport,
}));
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    readSecondsAtBeat: transport.readSecondsAtBeat,
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint,
}));
vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => backend.chain.value,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: backend.generateCloudToolCalls,
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: backend.getCloudProviderInfo,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: requestAnthropic,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: requestOpenAiResponses,
}));

type Track = ReturnType<typeof createTrack>;
type Figures = Parameters<typeof compareAgentScopeMeasurements>[0]['baseline'];
type ReceiptTarget = {
    targetId: string;
    project: Figures;
    deltas: ReturnType<typeof compareAgentScopeMeasurements>;
};

const SAMPLE_RATE = 48_000;
const REVISION = 'revision-7';
const SECTIONS: ProjectContextSection[] = [{ id: 'chorus', name: 'Chorus', startBeat: 16, endBeat: 32 }];
const CHORUS = { sectionId: 'chorus' };
const MASTER = { kind: 'master' };
const FOUR_TRACKS = { kind: 'tracks', ids: ['vocal', 'kick', 'snare', 'pad'] };
const REFERENCE_FILE_NAME = 'Private Mix Master v3.wav';
const REFERENCE_ID = 'reference-test';
/** What the wire may carry per band map: one number for each of the seven frequency bands. */
const MAX_BAND_VALUES = 7;
const PROJECT_AMPLITUDE = 0.25;
const REFERENCE_AMPLITUDE = 0.5;
/** Twice the amplitude is 6.02 dB louder. */
const EXPECTED_LOUDNESS_DELTA_LU = 6.02;
const COMPARE_ARGUMENT_KEYS = ['scope', 'range', 'metrics'];

function track(id: string, kind: Track['kind'], overrides: Partial<Track> = {}): Track {
    return { ...createTrack({ id, name: id, kind }), ...overrides };
}

function setProject(): void {
    trackStore.set({
        tracks: [
            track('master', 'master'),
            track('vocal', 'audio'),
            track('kick', 'audio'),
            track('snare', 'audio'),
            track('pad', 'midi'),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
}

/** Four seconds of a 1 kHz stereo sine at `amplitude`. */
function sineBuffer(amplitude: number): AudioBuffer {
    const length = SAMPLE_RATE * 4;
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

async function loadReference(amplitude = REFERENCE_AMPLITUDE): Promise<void> {
    const buffer = sineBuffer(amplitude);
    agentReferenceStore.set({
        reference: {
            ...analyzeAgentReferenceBuffer(buffer),
            referenceId: REFERENCE_ID,
            name: REFERENCE_FILE_NAME,
            contentAddress: await getAudioBufferContentAddress(buffer),
        },
        loadEpoch: 0,
    });
}

/** The measurement read as `parsePromptToActions` binds it: the reference tool is a companion of analysis.measure. */
function measurement() {
    return {
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        companionToolNames: [ANALYSIS_COMPARE_REFERENCE_TOOL_NAME],
        execute: (call: ToolCallResult, context: { callId: string; turn: number; signal?: AbortSignal }) => {
            const input = {
                call,
                callId: context.callId,
                turn: context.turn,
                projectRevision: REVISION,
                sections: SECTIONS,
                signal: context.signal,
            };
            if (call.name === ANALYSIS_COMPARE_REFERENCE_TOOL_NAME) {
                return executeReferenceMeasurement(input);
            }
            return executeAnalysisMeasure(input);
        },
    };
}

function toolCall(index: number, name: string, argumentsValue: Record<string, unknown>): ToolCallResult {
    return { id: `call-${String(index)}`, name, arguments: argumentsValue };
}

type PlannedCall = { name: string; arguments: Record<string, unknown> };

/** One loop run whose first turn makes the given calls and whose second turn ends the run. */
async function runTurn(calls: readonly PlannedCall[]) {
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: calls.map((call, index) => toolCall(index + 1, call.name, call.arguments)),
        })
        .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
    return runApplicationOwnedToolLoop({
        loopId: 'reference-loop',
        terminalToolNames: new Set(['command.batch.propose']),
        requestTurn,
        measurement: measurement(),
    });
}

async function compareOnce(argumentsValue: Record<string, unknown>): Promise<ApplicationToolReceipt> {
    const result = await runTurn([{ name: ANALYSIS_COMPARE_REFERENCE_TOOL_NAME, arguments: argumentsValue }]);
    const receipt = result.receipts.find((candidate) => candidate.callId === 'call-1');
    if (receipt === undefined) {
        throw new Error(`The loop returned no compare receipt: ${JSON.stringify(result)}`);
    }
    return receipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function receiptTargets(receipt: ApplicationToolReceipt): Record<string, unknown>[] {
    const targets = isRecord(receipt.data) && Array.isArray(receipt.data.targets) ? receipt.data.targets : [];
    return targets.filter(isRecord);
}

function collectParameterNames(schema: unknown, names: Set<string>): void {
    if (!isRecord(schema)) {
        return;
    }
    if (isRecord(schema.properties)) {
        for (const [key, child] of Object.entries(schema.properties)) {
            names.add(key);
            collectParameterNames(child, names);
        }
    }
    collectParameterNames(schema.items, names);
}

function findSchema(schemas: readonly ToolSchema[], name: string): ToolSchema {
    const found = schemas.find((schema) => schema.function.name === name);
    if (found === undefined) {
        throw new Error(`Expected ${name} among the schemas.`);
    }
    return found;
}

beforeEach(() => {
    engine.renderOffline.mockReset().mockResolvedValue(sineBuffer(PROJECT_AMPLITUDE));
    engine.renderTrackSubgraphOffline.mockReset().mockResolvedValue(sineBuffer(PROJECT_AMPLITUDE));
    engine.isExportActive.mockReset().mockReturnValue(false);
    engine.cancelExport.mockReset();
    transport.readSecondsAtBeat.mockReset().mockImplementation(({ beat }: { beat: number }) => beat * 0.5);
    crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockReset().mockReturnValue(true);
    backend.chain.value = [];
    backend.getCloudProviderInfo.mockReset();
    backend.generateCloudToolCalls.mockReset();
    agentReferenceStore.set({ reference: null, loadEpoch: 0 });
    setProject();
    clearAgentMeasurementArtifacts();
});

afterEach(() => {
    agentRunLifecycle.clear();
    clearAgentMeasurementArtifacts();
    agentReferenceStore.set({ reference: null, loadEpoch: 0 });
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    vi.unstubAllGlobals();
});

describe('analysis.compareReference publication', () => {
    // Red when the planner is offered a comparison against a reference that is not loaded.
    it('is offered to the planner and the catalog only while a reference is loaded', async () => {
        const offeredBefore = getPlanningProviderToolSchemas().map((schema) => schema.function.name);
        expect(offeredBefore).not.toContain(ANALYSIS_COMPARE_REFERENCE_TOOL_NAME);
        expect(offeredBefore).toContain(ANALYSIS_MEASURE_TOOL_NAME);
        expect(() =>
            getAgentToolCatalogEntries({ category: 'analysis', names: [ANALYSIS_COMPARE_REFERENCE_TOOL_NAME] })
        ).toThrow('Catalog entry is unavailable');

        await loadReference();

        expect(getPlanningProviderToolSchemas().map((schema) => schema.function.name)).toContain(
            ANALYSIS_COMPARE_REFERENCE_TOOL_NAME
        );
        expect(
            getAgentToolCatalogEntries({ category: 'analysis', names: [ANALYSIS_COMPARE_REFERENCE_TOOL_NAME] }).items
        ).toHaveLength(1);
    });

    // Red when the tool grows a file, path, buffer or audio parameter, or drifts from analysis.measure's scope and range.
    it('advertises a closed schema of scope, range and metrics with no file, path, buffer or audio parameter', () => {
        const schemas = getAgentToolCatalogSchemas();
        const compare = findSchema(schemas, ANALYSIS_COMPARE_REFERENCE_TOOL_NAME).function;
        const measure = findSchema(schemas, ANALYSIS_MEASURE_TOOL_NAME).function;

        expect(compare.parameters).toMatchObject({ additionalProperties: false, required: ['scope', 'range'] });
        expect(Object.keys(compare.parameters.properties)).toEqual(COMPARE_ARGUMENT_KEYS);
        for (const key of COMPARE_ARGUMENT_KEYS) {
            expect(compare.parameters.properties[key]).toEqual(measure.parameters.properties[key]);
        }
        const names = new Set<string>();
        collectParameterNames(compare.parameters, names);
        expect(
            Array.from(names).filter((name) =>
                /pcm|sample|byte|base64|buffer|waveform|audio|stem|file|path|name/iu.test(name)
            )
        ).toEqual([]);
        expect(compare.description).toContain('reference minus project');
    });
});

describe('analysis.compareReference execution', () => {
    // Red when a call with no reference loaded renders, or fails under another code.
    it('fails with no-reference-loaded and renders nothing while none is loaded', async () => {
        const receipt = await compareOnce({ scope: MASTER, range: CHORUS });

        expect(receipt).toMatchObject({
            toolName: ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
            status: 'failure',
            data: null,
            error: { code: 'no-reference-loaded', retryable: false },
        });
        expect(engine.renderOffline).not.toHaveBeenCalled();
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    // Red when the receipt stops holding the reference figures, the project figures, or reference-minus-project deltas.
    it('returns the reference figures, each target’s project figures and reference-minus-project deltas', async () => {
        await loadReference();

        const receipt = await compareOnce({ scope: { kind: 'tracks', ids: ['vocal', 'kick'] }, range: CHORUS });

        const reference = readAgentReference();
        expect(receipt).toMatchObject({
            toolName: ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
            status: 'success',
            data: {
                kind: 'reference-measurement',
                deltaSign: 'reference-minus-project',
                reference: {
                    referenceId: REFERENCE_ID,
                    contentAddress: reference?.contentAddress,
                    sampleRate: SAMPLE_RATE,
                    frameCount: SAMPLE_RATE * 4,
                    channelCount: 2,
                    durationSeconds: 4,
                },
                metrics: [...getAgentMeasurementMetricIds()],
            },
        });
        const data = receipt.data as { referenceMeasurements: Figures };
        expect(data.referenceMeasurements).toEqual(reference?.measurements);
        const targets = receiptTargets(receipt) as ReceiptTarget[];
        expect(targets.map((target) => target.targetId)).toEqual(['vocal', 'kick']);
        for (const target of targets) {
            expect(target.deltas).toEqual(
                compareAgentScopeMeasurements({ baseline: target.project, preview: data.referenceMeasurements })
            );
            expect(target.deltas.integratedLoudness).toMatchObject({ status: 'compared', unit: 'LU' });
            expect(target.deltas.integratedLoudness).toEqual({
                status: 'compared',
                unit: 'LU',
                delta: expect.closeTo(EXPECTED_LOUDNESS_DELTA_LU, 1),
            });
            expect(target.deltas.frequencyBandEnergy).toEqual({ status: 'incomparable', reason: 'non-scalar' });
        }
    });

    // Red when only the asked metrics stop bounding the reference's figures and the deltas.
    it('reports only the metrics asked, for the reference and the project alike', async () => {
        await loadReference();

        const receipt = await compareOnce({
            scope: MASTER,
            range: CHORUS,
            metrics: ['integratedLoudness', 'truePeak'],
        });

        const data = receipt.data as { referenceMeasurements: object; metrics: string[] };
        expect(data.metrics).toEqual(['integratedLoudness', 'truePeak']);
        expect(Object.keys(data.referenceMeasurements)).toEqual(['integratedLoudness', 'truePeak']);
        const [target] = receiptTargets(receipt);
        expect(Object.keys(target?.project as object)).toEqual(['integratedLoudness', 'truePeak']);
        expect(Object.keys(target?.deltas as object)).toEqual(['integratedLoudness', 'truePeak']);
    });

    // Red when four targets with every metric overflow the per-call receipt budget, which would drop the comparison.
    it('keeps four track targets with every metric inside the per-call receipt budget', async () => {
        await loadReference();

        const receipt = await compareOnce({ scope: FOUR_TRACKS, range: CHORUS });

        expect(receipt.status).toBe('success');
        expect(receiptTargets(receipt)).toHaveLength(4);
        expect(new TextEncoder().encode(JSON.stringify(receipt)).byteLength).toBeLessThanOrEqual(16_384);
    });

    // Red when the receipt starts naming the file, its extension, or any path.
    it('names the reference by id and content address only, never by file name or path', async () => {
        await loadReference();

        const receipt = await compareOnce({ scope: MASTER, range: CHORUS });

        const text = JSON.stringify(receipt);
        expect(text).not.toMatch(/Private|Master v3|\.wav|[/\\]/u);
        expect(Object.keys((receipt.data as { reference: object }).reference).toSorted()).toEqual([
            'channelCount',
            'contentAddress',
            'durationSeconds',
            'frameCount',
            'referenceId',
            'sampleRate',
        ]);
    });

    // Red when a call may carry a file, a path, a buffer, or a preview subject through to a render.
    it.each([
        ['a file', { file: REFERENCE_FILE_NAME }],
        ['a path', { path: '/Users/someone/mix.wav' }],
        ['a buffer', { buffer: [0.1, 0.2] }],
        ['a preview subject', { subject: 'preview' }],
        ['a project subject', { subject: 'project' }],
    ])('refuses a call carrying %s without rendering', async (_label, extra) => {
        await loadReference();

        const receipt = await compareOnce({ scope: MASTER, range: CHORUS, ...extra });

        expect(receipt).toMatchObject({
            status: 'failure',
            error: {
                code: 'invalid-arguments',
                safeMessage: 'analysis.compareReference accepts only scope, range and metrics.',
            },
        });
        expect(engine.renderOffline).not.toHaveBeenCalled();
    });

    // Red when a malformed scope is accepted, or refused under the other tool's name.
    it('applies analysis.measure’s scope validation and names its own tool in the refusal', async () => {
        await loadReference();

        const receipt = await compareOnce({ scope: { kind: 'tracks', ids: [] }, range: CHORUS });

        expect(receipt).toMatchObject({
            status: 'failure',
            error: {
                code: 'invalid-arguments',
                safeMessage: expect.stringContaining('analysis.compareReference scope'),
            },
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });
});

describe('analysis.compareReference shares the one measurement allowed per turn', () => {
    // Red when a comparison and a measurement in one turn both render.
    it.each([
        ['a measurement then a comparison', [ANALYSIS_MEASURE_TOOL_NAME, ANALYSIS_COMPARE_REFERENCE_TOOL_NAME]],
        ['a comparison then a measurement', [ANALYSIS_COMPARE_REFERENCE_TOOL_NAME, ANALYSIS_MEASURE_TOOL_NAME]],
    ])('executes only the first of %s', async (_label, names) => {
        await loadReference();

        const result = await runTurn(names.map((name) => ({ name, arguments: { scope: MASTER, range: CHORUS } })));

        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(result.receipts.find((receipt) => receipt.callId === 'call-1')?.status).toBe('success');
        expect(result.receipts.find((receipt) => receipt.callId === 'call-2')).toMatchObject({
            status: 'failure',
            error: { code: 'measure-per-turn-limit', retryable: true },
        });
    });
});

describe('a reference measurement is local numeric evidence for the data policy', () => {
    // Red when a reference receipt stops naming the measurement category, or a refusal starts to.
    it('classifies a successful reference receipt as measurement and a refused one as nothing', async () => {
        const refused = await compareOnce({ scope: MASTER, range: CHORUS });
        await loadReference();
        const compared = await compareOnce({ scope: MASTER, range: CHORUS });

        expect(classifyApplicationToolReceiptData(compared)).toEqual(['measurement']);
        expect(classifyApplicationToolReceiptData(refused)).toEqual([]);
    });

    // Red when reference audio stops being refused for a hosted provider.
    it('still refuses reference-audio for a hosted provider', () => {
        expect(() => {
            assertRemoteAgentDataPolicy(['reference-audio']);
        }).toThrow('Remote AI transmission blocked for: reference-audio');
        expect(() => {
            assertRemoteAgentDataPolicy(['measurement']);
        }).not.toThrow();
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
        const isIndexedSeries = entries.length > MAX_BAND_VALUES && entries.every(([key]) => INDEX_KEY.test(key));
        return isIndexedSeries || entries.some(([key, entry]) => AUDIO_KEY.test(key) || containsSampleData(entry));
    }
    return false;
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

/** Each metric of the reference's figures and of each target's figures is a number, a flag, or one number per band. */
function figuresAreScalarsOrBandRecords(receipt: Record<string, unknown>): boolean {
    const data = isRecord(receipt.data) ? receipt.data : {};
    const targets = Array.isArray(data.targets) ? data.targets.filter(isRecord) : [];
    const figures = [data.referenceMeasurements, ...targets.map((target) => target.project)].filter(isRecord);
    const entries = figures.flatMap((figure) => Object.values(figure)).filter(isRecord);
    return (
        entries.length > 0 &&
        entries.every((entry) => entry.status === 'unavailable' || isScalarOrBandRecord(entry.value))
    );
}

function historyOf(...receipts: ApplicationToolReceipt[]): HostedTurnHistory {
    return [
        {
            turn: 1,
            provider: 'anthropic',
            assistantItems: null,
            calls: receipts.map((receipt) => ({
                id: receipt.callId,
                name: ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
                arguments: {},
            })),
            receipts,
        },
    ];
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

type WireBodies = { anthropic: unknown; openAiResponses: unknown; openAiCompatible: unknown };

/** What each hosted dialect puts on the wire when the tool is advertised and the history replays the receipts. */
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
    const turn = {
        systemPrompt: 'system',
        userMessage: 'make my mix as loud as the reference',
        toolSchemas: getPlanningProviderToolSchemas().filter(
            (schema) => schema.function.name === ANALYSIS_COMPARE_REFERENCE_TOOL_NAME
        ),
        maxOutputTokens: 8_192,
        directive: AUTO_TOOL_CHOICE,
        history,
        budgetNote: 'Budget remaining.',
    };
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

describe('no reference audio, name or path reaches a hosted provider', () => {
    const DIALECTS = ['anthropic', 'openAiResponses', 'openAiCompatible'] as const;

    // Red when a reference receipt, or the tool's advertised schema, starts carrying samples, a name or a path to the wire.
    it.each(DIALECTS)(
        'sends the %s request holding only the reference figures, the project figures and the deltas',
        async (dialect) => {
            await loadReference();
            const receipt = await compareOnce({ scope: { kind: 'tracks', ids: ['vocal', 'kick'] }, range: CHORUS });

            const bodies = await buildWireBodies(historyOf(receipt));

            const body = JSON.stringify(bodies[dialect]);
            const onWire = receiptsOn(bodies[dialect]);
            expect(onWire.map((entry) => entry.callId)).toEqual(['call-1']);
            expect(body).toContain('compareReference');
            expect(containsSampleData(bodies[dialect])).toBe(false);
            expect(body).not.toMatch(/Private|Master v3|\.wav|\/Users|"(?:pcm|base64|bytes)"\s*:/u);
            for (const entry of onWire) {
                expect(figuresAreScalarsOrBandRecords(entry)).toBe(true);
            }
        }
    );

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
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'vocal' } }],
            strictToolSchemas: true,
            usage: null,
        });
        const admissions: ProviderAttemptAdmission[] = [];
        await generateToolPlanningOutcome(
            'system',
            'mute the vocal',
            [
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
            ],
            undefined,
            'mute the vocal',
            undefined,
            { runId: 'run-reference', requestId: 'request-1', cancellationGeneration: 0 },
            (admission) => {
                admissions.push(admission);
                return { status: 'admitted' };
            },
            AUTO_TOOL_CHOICE,
            { firstUserMessage: 'mute the vocal', history, budgetNote: 'Budget remaining.' }
        );
        const [admission] = admissions;
        if (admission === undefined) {
            throw new Error('Expected the hosted planning request to be admitted.');
        }
        return admission;
    }

    // Red when a replayed reference receipt stops declaring measurement, or the request starts declaring reference-audio.
    it('declares measurement, and never reference-audio, on a hosted planning request replaying the receipt', async () => {
        await loadReference();
        const receipt = await compareOnce({ scope: MASTER, range: CHORUS });
        agentRunLifecycle.create({
            runId: 'run-reference',
            request: 'mute the vocal',
            mode: 'plan',
            createdRevision: null,
        });

        const admission = await planHostedTurn(historyOf(receipt));

        expect(admission.request.dataCategories).toEqual([...REMOTE_TEXT_AGENT_DATA_CATEGORIES, 'measurement']);
        expect(admission.request.dataCategories).not.toContain('reference-audio');
    });
});
