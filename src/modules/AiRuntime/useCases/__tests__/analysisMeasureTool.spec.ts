import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { clearAgentMeasurementArtifacts, getAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';
import { digest } from '#/utils/canonicalDigest';

import { type ProjectContext, type ProjectContextSection } from '../../models/ProjectContext';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { ANALYSIS_MEASURE_TOOL_NAME } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    isExportActive: vi.fn(),
    cancelExport: vi.fn(),
}));
const transport = vi.hoisted(() => ({ readSecondsAtBeat: vi.fn() }));
const crdt = vi.hoisted(() => ({ projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn() }));

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

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...original,
        tryPresetMatch: vi.fn(original.tryPresetMatch),
        tryParameterizedPath: vi.fn(original.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(original.tryCompoundFastPath),
    };
});

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return { ...original, generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome) };
});

type Track = ReturnType<typeof createTrack>;

const SAMPLE_RATE = 48_000;
const REVISION = 'revision-7';
const SECTIONS: ProjectContextSection[] = [{ id: 'chorus', name: 'Chorus', startBeat: 16, endBeat: 32 }];
const CHORUS = { sectionId: 'chorus' };
const MASTER = { kind: 'master' };

const PROJECT_CONTEXT: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    sections: SECTIONS,
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function track(id: string, kind: Track['kind'], overrides: Partial<Track> = {}): Track {
    return { ...createTrack({ id, name: id, kind }), ...overrides };
}

function projectTracks(overrides: Readonly<Record<string, Partial<Track>>> = {}): Track[] {
    const tracks = [
        track('master', 'master'),
        track('vocal', 'audio', { sends: [{ busId: 'plate', level: 0.5, preFader: false }] }),
        track('plate', 'bus'),
        track('kick', 'audio', { outputId: 'drum-bus' }),
        track('snare', 'audio', { outputId: 'drum-bus' }),
        track('drum-bus', 'bus'),
        track('pad', 'midi', { outputId: 'keys-folder' }),
        track('keys-folder', 'folder'),
    ];
    return tracks.map((candidate) => ({ ...candidate, ...overrides[candidate.id] }));
}

function setProject(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
}

function clickChannel(length: number, clickFrames: readonly number[]): Float32Array {
    const samples = new Float32Array(length);
    for (const frame of clickFrames) {
        samples[frame] = 0.9;
    }
    return samples;
}

function fakeBuffer(channelData: readonly Float32Array[], sampleRate = SAMPLE_RATE): AudioBuffer {
    const length = channelData[0]?.length ?? 0;
    return {
        sampleRate,
        length,
        numberOfChannels: channelData.length,
        duration: length / sampleRate,
        getChannelData: (channel: number) => channelData[channel] ?? new Float32Array(length),
    } as unknown as AudioBuffer;
}

/** Four seconds holding one click in the middle of each second, on both channels. */
function fourClicksBuffer(sampleRate = SAMPLE_RATE): AudioBuffer {
    const clicks = clickChannel(
        sampleRate * 4,
        [0.5, 1.5, 2.5, 3.5].map((second) => second * sampleRate)
    );
    return fakeBuffer([clicks, clicks], sampleRate);
}

function measurement(sections: readonly ProjectContextSection[] = SECTIONS) {
    return {
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        execute: (call: ToolCallResult, context: { callId: string; turn: number; signal?: AbortSignal }) =>
            executeAnalysisMeasure({
                call,
                callId: context.callId,
                turn: context.turn,
                projectRevision: REVISION,
                sections,
                signal: context.signal,
            }),
    };
}

function measureCall(index: number, argumentsValue: Record<string, unknown>): ToolCallResult {
    return { id: `measure-${String(index)}`, name: ANALYSIS_MEASURE_TOOL_NAME, arguments: argumentsValue };
}

/** One loop run whose first turn makes the given measure calls and whose second turn ends the run. */
async function runMeasureTurn(
    argumentsList: readonly Record<string, unknown>[],
    options: { signal?: AbortSignal; withMeasurement?: boolean } = {}
) {
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: argumentsList.map((argumentsValue, index) => measureCall(index + 1, argumentsValue)),
        })
        .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
    const result = await runApplicationOwnedToolLoop({
        loopId: 'measure-loop',
        terminalToolNames: new Set(['command.batch.propose']),
        requestTurn,
        signal: options.signal,
        measurement: options.withMeasurement === false ? undefined : measurement(),
    });
    return { result, requestTurn };
}

async function measureOnce(argumentsValue: Record<string, unknown>) {
    const { result, requestTurn } = await runMeasureTurn([argumentsValue]);
    const receipt = result.receipts.find((candidate) => candidate.callId === 'measure-1');
    if (receipt === undefined) {
        throw new Error(`The loop returned no measure receipt: ${JSON.stringify(result)}`);
    }
    return { result, receipt, requestTurn };
}

/** An `AudioBuffer` duck type: a plain number array walk never matches it (its
 *  channels sit behind a method, not an own enumerable array), so raw audio
 *  smuggled into a receipt as a whole buffer needs its own check. */
function isAudioBufferLike(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { getChannelData?: unknown }).getChannelData === 'function' &&
        typeof (value as { numberOfChannels?: unknown }).numberOfChannels === 'number'
    );
}

/** No receipt may carry raw samples: a bare number series, a typed array
 *  (`Float32Array` and friends walk as plain numeric objects, not arrays), or
 *  an `AudioBuffer` itself. */
function containsRawAudioData(value: unknown): boolean {
    if (ArrayBuffer.isView(value) || isAudioBufferLike(value)) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.some((entry) => typeof entry === 'number' || containsRawAudioData(entry));
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(containsRawAudioData);
    }
    return false;
}

function renderedTrackIds(callIndex = 0): string[] {
    const input = engine.renderTrackSubgraphOffline.mock.calls[callIndex]?.[0] as
        { renderTracks: readonly Track[] } | undefined;
    return input?.renderTracks.map((candidate) => candidate.id) ?? [];
}

beforeEach(() => {
    engine.renderOffline.mockReset().mockResolvedValue(fourClicksBuffer());
    engine.renderTrackSubgraphOffline.mockReset().mockResolvedValue(fourClicksBuffer());
    engine.isExportActive.mockReset().mockReturnValue(false);
    engine.cancelExport.mockReset();
    transport.readSecondsAtBeat.mockReset().mockImplementation(({ beat }: { beat: number }) => beat * 0.5);
    crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockReset().mockReturnValue(true);
    vi.mocked(generateToolPlanningOutcome).mockReset();
    vi.mocked(tryPresetMatch).mockReturnValue([]);
    vi.mocked(tryParameterizedPath).mockReturnValue([]);
    vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    sidechainStore.set({ routes: [] });
    setProject(projectTracks());
    clearAgentMeasurementArtifacts();
});

afterEach(() => {
    clearAgentMeasurementArtifacts();
    setProject([]);
});

describe('analysis.measure', () => {
    it('is published in the analysis category with a closed argument schema', () => {
        const catalog = getAgentToolCatalogEntries({ category: 'analysis', names: [ANALYSIS_MEASURE_TOOL_NAME] });

        expect(catalog.items).toHaveLength(1);
        expect(catalog.items[0]).toMatchObject({
            function: {
                name: 'analysis.measure',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['scope', 'range'],
                    properties: {
                        scope: { additionalProperties: false },
                        range: { additionalProperties: false },
                    },
                },
            },
        });
    });

    it('measures the master mixdown of a named section and lets the loop continue', async () => {
        const buffer = fourClicksBuffer();
        engine.renderOffline.mockResolvedValue(buffer);

        const { result, receipt, requestTurn } = await measureOnce({ scope: MASTER, range: CHORUS });

        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(engine.renderOffline).toHaveBeenCalledWith(
            expect.objectContaining({ startBeat: 16, durationBeats: 16, sampleRate: 48000, tailSeconds: 0 })
        );
        expect(receipt).toMatchObject({
            toolName: 'analysis.measure',
            status: 'success',
            revision: REVISION,
            data: {
                kind: 'analysis-measurement',
                schemaVersion: 1,
                scope: { kind: 'master' },
                sourceRevisionDigest: digest(REVISION),
                range: { startBeat: 16, endBeat: 32, sectionId: 'chorus' },
                targets: [
                    {
                        targetId: 'master',
                        targetKind: 'master',
                        route: 'mixdown',
                        artifact: {
                            contentAddress: await getAudioBufferContentAddress(buffer),
                            sampleRate: SAMPLE_RATE,
                            frameCount: SAMPLE_RATE * 4,
                            channelCount: 2,
                        },
                        measurements: { onsetCount: { status: 'measured', unit: 'count', value: 4 } },
                    },
                ],
            },
        });
        expect(result.status).toBe('complete');
        expect(requestTurn).toHaveBeenCalledTimes(2);
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('"callId":"measure-1"');
    });

    it('keeps four track targets with every metric inside the per-call receipt budget and returns no series', async () => {
        const { receipt } = await measureOnce({
            scope: { kind: 'tracks', ids: ['vocal', 'kick', 'snare', 'pad'] },
            range: CHORUS,
        });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({ metrics: expect.arrayContaining(['onsetCount']) });
        expect((receipt.data as { targets: unknown[] }).targets).toHaveLength(4);
        for (const target of (receipt.data as { targets: { measurements: object }[] }).targets) {
            expect(Object.keys(target.measurements)).toHaveLength(14);
        }
        expect(new TextEncoder().encode(JSON.stringify(receipt)).byteLength).toBeLessThanOrEqual(16_384);
        expect(containsRawAudioData(receipt.data)).toBe(false);
    });

    it('would catch a typed array or a whole AudioBuffer smuggled into a receipt', () => {
        // Proves the guard above actually discriminates: a naive number-array walk
        // never matches either shape, so a regression here would silently defeat
        // every "no audio in the receipt" assertion.
        expect(containsRawAudioData(new Float32Array([0.1, 0.2]))).toBe(true);
        expect(containsRawAudioData(fourClicksBuffer())).toBe(true);
        expect(containsRawAudioData({ measurements: { onsetCount: { value: 4 } } })).toBe(false);
    });

    it('renders a track target through its isolated subgraph with its send return', async () => {
        const { receipt } = await measureOnce({ scope: { kind: 'tracks', ids: ['vocal'] }, range: CHORUS });

        expect(engine.renderOffline).not.toHaveBeenCalled();
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledWith(
            expect.objectContaining({
                targetTrackId: 'vocal',
                printTrackIds: ['plate'],
                startBeat: 16,
                endBeat: 32,
                tailSeconds: 0,
            })
        );
        expect(renderedTrackIds()).toEqual(['vocal', 'plate']);
        expect(receipt.data).toMatchObject({
            targets: [{ targetId: 'vocal', targetKind: 'track', route: 'isolated-subgraph' }],
        });
    });

    it('renders a bus target with the members routed into it', async () => {
        const { receipt } = await measureOnce({ scope: { kind: 'buses', ids: ['drum-bus'] }, range: CHORUS });

        expect(renderedTrackIds()).toEqual(['kick', 'snare', 'drum-bus']);
        expect(receipt.data).toMatchObject({
            targets: [{ targetId: 'drum-bus', targetKind: 'bus', route: 'isolated-subgraph' }],
        });
    });

    it('refuses a plain folder under buses: it builds no live strip to isolate', async () => {
        const { receipt } = await measureOnce({ scope: { kind: 'buses', ids: ['keys-folder'] }, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', data: null, error: { code: 'kind-mismatch' } });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('accepts a folder under buses when a toaster device makes it a live strip', async () => {
        setProject(
            projectTracks({
                'keys-folder': {
                    devices: [
                        { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
                    ],
                },
            })
        );

        const { receipt } = await measureOnce({ scope: { kind: 'buses', ids: ['keys-folder'] }, range: CHORUS });

        expect(renderedTrackIds()).toEqual(['pad', 'keys-folder']);
        expect(receipt.data).toMatchObject({ targets: [{ targetId: 'keys-folder', targetKind: 'bus' }] });
    });

    it('renders an isolated target at the live context rate and reports the buffer rate', async () => {
        engine.renderTrackSubgraphOffline.mockResolvedValue(fourClicksBuffer(44_100));

        const { receipt } = await measureOnce({ scope: { kind: 'tracks', ids: ['vocal'] }, range: CHORUS });

        expect(engine.renderTrackSubgraphOffline.mock.calls[0]?.[0]).not.toHaveProperty('sampleRate');
        expect(receipt.data).toMatchObject({
            targets: [{ artifact: { sampleRate: 44_100, frameCount: 44_100 * 4 } }],
        });
    });

    it('reports measured and rendered seconds through the tempo map', async () => {
        transport.readSecondsAtBeat.mockImplementation(({ beat }: { beat: number }) =>
            beat <= 16 ? beat * 0.5 : 8 + (beat - 16) * 0.625
        );

        const { receipt } = await measureOnce({ scope: MASTER, range: CHORUS });

        expect(receipt.data).toMatchObject({ range: { measuredSeconds: 10, renderedSeconds: 18 } });
    });

    it.each([
        {
            label: 'an unknown section',
            args: { scope: MASTER, range: { sectionId: 'bridge' } },
            code: 'unknown-section',
        },
        {
            label: 'a start at its end',
            args: { scope: MASTER, range: { startBeat: 8, endBeat: 8 } },
            code: 'invalid-range',
        },
        {
            label: 'five target ids',
            args: { scope: { kind: 'tracks', ids: ['vocal', 'kick', 'snare', 'pad', 'plate'] }, range: CHORUS },
            code: 'invalid-arguments',
        },
        {
            label: 'more than 600 measured seconds',
            args: { scope: MASTER, range: { startBeat: 0, endBeat: 1300 } },
            code: 'range-exceeds-ceiling',
        },
        {
            label: 'more than 1200 rendered seconds',
            args: { scope: MASTER, range: { startBeat: 2000, endBeat: 2600 } },
            code: 'range-exceeds-ceiling',
        },
        {
            label: 'an id not in the project',
            args: { scope: { kind: 'tracks', ids: ['ghost'] }, range: CHORUS },
            code: 'unknown-target',
        },
        {
            label: 'a bus id under tracks',
            args: { scope: { kind: 'tracks', ids: ['drum-bus'] }, range: CHORUS },
            code: 'kind-mismatch',
        },
    ])('refuses $label without rendering', async ({ args, code }) => {
        const { receipt } = await measureOnce(args);

        expect(receipt).toMatchObject({ status: 'failure', data: null, error: { code } });
        expect(engine.renderOffline).not.toHaveBeenCalled();
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('refuses a project that changed before the render without rendering', async () => {
        crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockReturnValue(false);

        const { receipt } = await measureOnce({ scope: MASTER, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'stale-revision', retryable: true } });
        expect(engine.renderOffline).not.toHaveBeenCalled();
        expect(getAgentMeasurementArtifacts()).toEqual([]);
    });

    it('refuses a project that changed only during the render and retains nothing', async () => {
        crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockReturnValueOnce(true).mockReturnValue(false);

        const { receipt } = await measureOnce({ scope: MASTER, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'stale-revision', retryable: true } });
        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(getAgentMeasurementArtifacts()).toEqual([]);
    });

    it('refuses the mixdown while another export renders', async () => {
        engine.isExportActive.mockReturnValue(true);

        const { receipt } = await measureOnce({ scope: MASTER, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'render-busy', retryable: true } });
        expect(engine.renderOffline).not.toHaveBeenCalled();
    });

    it('refuses a target whose muted contributor the isolated render would unmute', async () => {
        setProject(projectTracks({ kick: { muted: true } }));

        const { receipt } = await measureOnce({ scope: { kind: 'buses', ids: ['drum-bus'] }, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'muted-contributor' } });
        expect(receipt.error?.safeMessage).toContain('kick');
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('measures a muted target that has no muted contributor and reports it muted', async () => {
        setProject(projectTracks({ vocal: { muted: true } }));

        const { receipt } = await measureOnce({ scope: { kind: 'tracks', ids: ['vocal'] }, range: CHORUS });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({
            targets: [{ targetId: 'vocal', liveAudibility: 'muted', soloActive: false }],
        });
    });

    it('refuses a target whose disabled contributor builds no live strip to isolate', async () => {
        setProject(projectTracks({ kick: { disabled: true } }));

        const { receipt } = await measureOnce({ scope: { kind: 'buses', ids: ['drum-bus'] }, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'disabled-contributor' } });
        expect(receipt.error?.safeMessage).toContain('kick');
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('does not exempt a disabled sidechain key source the way it exempts a muted one', async () => {
        setProject(
            projectTracks({
                kick: { disabled: true },
                'drum-bus': {
                    devices: [
                        {
                            id: 'sidechain-1',
                            name: 'Sidechain',
                            type: 'builtin-sidechain-compressor',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                },
            })
        );
        // This route and device are exactly the shape `collectSidechainKeySourceIds`
        // exempts for a muted key source, so the refusal below proves disabled
        // deliberately gets no such exemption rather than merely never reaching it.
        sidechainStore.set({
            routes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'kick',
                    targetTrackId: 'drum-bus',
                    targetDeviceId: 'sidechain-1',
                    targetParameterId: 'threshold',
                    gain: 1,
                },
            ],
        });

        const { receipt } = await measureOnce({ scope: { kind: 'buses', ids: ['drum-bus'] }, range: CHORUS });

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'disabled-contributor' } });
    });

    it('reports a disabled target as disabled even though it is also muted', async () => {
        setProject(projectTracks({ vocal: { disabled: true, muted: true } }));

        const { receipt } = await measureOnce({ scope: { kind: 'tracks', ids: ['vocal'] }, range: CHORUS });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({ targets: [{ targetId: 'vocal', liveAudibility: 'disabled' }] });
    });

    it('reports a soloed-out target as solo-suppressed', async () => {
        setProject(projectTracks({ kick: { soloed: true } }));

        const { receipt } = await measureOnce({ scope: { kind: 'tracks', ids: ['vocal'] }, range: CHORUS });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({
            targets: [{ targetId: 'vocal', liveAudibility: 'solo-suppressed', soloActive: true }],
        });
    });

    it('excludes a disabled track from the strip set solo derives audibility from', async () => {
        setProject(projectTracks({ kick: { disabled: true, soloed: true } }));

        const { receipt } = await measureOnce({ scope: { kind: 'tracks', ids: ['vocal'] }, range: CHORUS });

        // A disabled solo has no live strip and cannot suppress anything, exactly as
        // `readLiveStripTracks` excludes it live — unlike an ordinary soloed track,
        // which would otherwise suppress every other target.
        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({
            targets: [{ targetId: 'vocal', liveAudibility: 'audible', soloActive: false }],
        });
    });

    it('executes only the first measure call of a turn', async () => {
        const { result } = await runMeasureTurn([
            { scope: MASTER, range: CHORUS },
            { scope: MASTER, range: { startBeat: 0, endBeat: 16 } },
        ]);

        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(result.receipts.find((receipt) => receipt.callId === 'measure-1')?.status).toBe('success');
        expect(result.receipts.find((receipt) => receipt.callId === 'measure-2')).toMatchObject({
            status: 'failure',
            error: { code: 'measure-per-turn-limit', retryable: true },
        });
    });

    it('cancels the export and the loop when the run is aborted during the render', async () => {
        const controller = new AbortController();
        engine.renderOffline.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    engine.cancelExport.mockImplementation(() => reject(new Error('Export cancelled')));
                    controller.abort();
                })
        );

        const { result, requestTurn } = await runMeasureTurn([{ scope: MASTER, range: CHORUS }], {
            signal: controller.signal,
        });

        expect(engine.cancelExport).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: 'rejected', reason: 'Application-owned tool loop was cancelled.' });
        expect(requestTurn).toHaveBeenCalledTimes(1);
        expect(getAgentMeasurementArtifacts()).toEqual([]);
    });

    it('stays unavailable to a loop that was given no measurement', async () => {
        const { result } = await runMeasureTurn([{ scope: MASTER, range: CHORUS }], { withMeasurement: false });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
        });
        expect(engine.renderOffline).not.toHaveBeenCalled();
    });

    it('is executed by the production planner for a run bound to a revision', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [measureCall(1, { scope: MASTER, range: CHORUS })],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await parsePromptToActions('how loud is the chorus', PROJECT_CONTEXT, undefined, REVISION);

        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(result.applicationToolReceipts).toMatchObject([
            { callId: 'measure-1', toolName: 'analysis.measure', status: 'success', revision: REVISION },
        ]);
    });

    it('is unavailable to a production planner run without a revision', async () => {
        vi.mocked(generateToolPlanningOutcome).mockResolvedValue({
            status: 'complete',
            toolCalls: [measureCall(1, { scope: MASTER, range: CHORUS })],
        });

        const result = await parsePromptToActions('how loud is the chorus', PROJECT_CONTEXT);

        expect(result).toMatchObject({
            actions: [],
            rejectionReason: 'Provider planning rejected: Provider requested an unavailable application tool.',
        });
        expect(engine.renderOffline).not.toHaveBeenCalled();
        expect(crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint).not.toHaveBeenCalled();
    });

    it('passes a mono render unavailable low-frequency stereo reading through unchanged', async () => {
        // Render mono to ensure unavailable due to lacking stereo channels
        const monoClicks = clickChannel(
            SAMPLE_RATE * 4,
            [0.5, 1.5, 2.5, 3.5].map((second) => second * SAMPLE_RATE)
        );
        engine.renderOffline.mockResolvedValue(fakeBuffer([monoClicks]));

        const { receipt } = await measureOnce({
            scope: MASTER,
            range: CHORUS,
            metrics: ['lowFrequencyStereoContent'],
        });

        expect(receipt.data).toMatchObject({ metrics: ['lowFrequencyStereoContent'] });
        expect((receipt.data as { targets: { measurements: unknown }[] }).targets[0]?.measurements).toEqual({
            lowFrequencyStereoContent: { status: 'unavailable', reason: 'mono' },
        });
    });

    it('retains one artifact for the same audio measured twice', async () => {
        const buffer = fourClicksBuffer();
        engine.renderOffline.mockResolvedValue(buffer);

        const first = await measureOnce({ scope: MASTER, range: CHORUS });
        const second = await measureOnce({ scope: MASTER, range: CHORUS });

        const contentAddress = await getAudioBufferContentAddress(buffer);
        expect(first.receipt.data).toMatchObject({ targets: [{ artifact: { contentAddress } }] });
        expect(second.receipt.data).toMatchObject({ targets: [{ artifact: { contentAddress } }] });
        expect(getAgentMeasurementArtifacts().map((artifact) => artifact.contentAddress)).toEqual([contentAddress]);
    });
});
