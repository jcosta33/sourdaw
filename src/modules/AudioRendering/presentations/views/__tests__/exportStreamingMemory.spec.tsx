import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { type ReactNode } from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { type Track } from '#/modules/Arrangement/stores';
import {
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
} from '#/modules/AudioEngine/useCases';
import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';

import { ExportDialog } from '../ExportDialog';
import { loadExportSettings } from '../exportSettings';

const GC_CASE_NAME = 'observes sampled output ownership below 2B across 64 WAV/MP3/FLAC stems';
const GC_FULL_NAME = `connected stem export output ownership ${GC_CASE_NAME}`;
const GC_FILTER_NAME = `connected stem export output ownership > ${GC_CASE_NAME}`;
const GC_SPEC = 'src/modules/AudioRendering/presentations/views/__tests__/exportStreamingMemory.spec.tsx';
const GC_CHILD_MARKER = 'SOURDAW_EXPORT_STREAMING_GC_CHILD';
// An in-flight background Maglev/Turbofan job holds its closure, and so that closure's context, as a
// strong root that gc() does not drain. On a starved runner a job compiling a finished stem's encoder
// or PCM-reader closure keeps that stem's PCM live into the next render's checkpoint (#5924).
// Synchronous tiering removes those background-compile roots from the measurement.
const GC_SYNCHRONOUS_TIERING_FLAG = '--no-concurrent-recompilation';
// Synchronous tiering moves compile work onto the measuring thread: the admitted runner projects about
// 182 s for 64 stems with it, so 300 s keeps a 1.6x margin.
const GC_BODY_DEADLINE_MS = 300_000;
// Nested Vitest startup and child exit need time outside the measured GC body.
const GC_CHILD_BOOTSTRAP_AND_EXIT_ALLOWANCE_MS = 120_000;
const GC_CHILD_DEADLINE_MS = GC_BODY_DEADLINE_MS + GC_CHILD_BOOTSTRAP_AND_EXIT_ALLOWANCE_MS;
const GC_PARENT_CASE_DEADLINE_MS = GC_CHILD_DEADLINE_MS + 30_000;
const GC_CHILD_OUTPUT_LIMIT = 1024 * 1024;
const GC_CHILD_OUTPUT_TAIL_LIMIT = 8 * 1024;
const GC_ATTRIBUTION_LINE_LIMIT = 4096;
const GC_CASE_TIMEOUT_MS =
    process.env[GC_CHILD_MARKER] === '1' || typeof Reflect.get(globalThis, 'gc') === 'function'
        ? GC_BODY_DEADLINE_MS
        : GC_PARENT_CASE_DEADLINE_MS;

type BufferObservation = {
    origin: string;
    allocationBytes: number;
    format: string;
    renderGeneration: number;
    producerStack?: string;
};

type BufferBucket = { count: number; bytes: number };

type LiveBufferSample = {
    live: number;
    bySize: Map<number, BufferBucket>;
    byOrigin: Map<string, BufferBucket>;
    byGeneration: Map<string, BufferBucket>;
    byEightKiBStack: Map<string, BufferBucket>;
};

function addBufferBucket<Key>(buckets: Map<Key, BufferBucket>, key: Key, bytes: number): void {
    const bucket = buckets.get(key);
    if (bucket) {
        bucket.count++;
        bucket.bytes += bytes;
        return;
    }
    buckets.set(key, { count: 1, bytes });
}

function sampleLiveExportBytes(
    allocations: WeakRef<ArrayBufferLike>[],
    observations: WeakMap<ArrayBufferLike, BufferObservation>
): LiveBufferSample {
    const sample: LiveBufferSample = {
        live: 0,
        bySize: new Map(),
        byOrigin: new Map(),
        byGeneration: new Map(),
        byEightKiBStack: new Map(),
    };
    let live = 0;
    let retained = 0;
    for (const reference of allocations) {
        const buffer = reference.deref();
        if (buffer === undefined) {
            continue;
        }
        const bytes = buffer.byteLength;
        const observation = observations.get(buffer);
        live += bytes;
        addBufferBucket(sample.bySize, observation?.allocationBytes ?? bytes, bytes);
        addBufferBucket(sample.byOrigin, observation?.origin ?? 'unobserved', bytes);
        addBufferBucket(
            sample.byGeneration,
            observation ? `${observation.format}:render-${observation.renderGeneration}` : 'unobserved',
            bytes
        );
        if ((observation?.allocationBytes ?? bytes) === 8192) {
            addBufferBucket(sample.byEightKiBStack, observation?.producerStack ?? 'stack-unavailable', bytes);
        }
        allocations[retained] = reference;
        retained++;
    }
    allocations.length = retained;
    sample.live = live;
    return sample;
}

function topBufferBuckets<Key>(buckets: Map<Key, BufferBucket>, limit: number): Array<[Key, BufferBucket]> {
    return [...buckets.entries()].sort((left, right) => right[1].bytes - left[1].bytes).slice(0, limit);
}

function stopGcChild(pid: number | undefined): void {
    if (pid === undefined) {
        return;
    }
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, stdio: 'ignore' });
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return;
        }
        throw error;
    }
}

async function runGcChild(cwd: string, reportPath: string): Promise<string> {
    process.stdout.write(`GC_PHASE parent-spawn abs=${Date.now()} parent=true child=false\n`);
    const child = spawn(
        process.execPath,
        [
            join(cwd, 'node_modules/vitest/vitest.mjs'),
            'run',
            GC_SPEC,
            '--pool=forks',
            '--execArgv=--expose-gc',
            `--execArgv=${GC_SYNCHRONOUS_TIERING_FLAG}`,
            '--maxWorkers=1',
            `--testNamePattern=^${GC_FILTER_NAME}$`,
            '--reporter=default',
            '--reporter=json',
            `--outputFile=${reportPath}`,
        ],
        { cwd, env: { ...process.env, [GC_CHILD_MARKER]: '1' }, detached: process.platform !== 'win32' }
    );
    let stdout = '';
    let stderr = '';
    let stdoutLength = 0;
    let stderrLength = 0;
    let stdoutTail = '';
    let stderrTail = '';
    let failure: Error | undefined;
    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
        const content = chunk.toString();
        const captured = content.slice(0, Math.max(0, GC_CHILD_OUTPUT_LIMIT - stdout.length - stderr.length));
        if (stream === 'stdout') {
            stdoutLength += content.length;
            stdout += captured;
            stdoutTail = (stdoutTail + content).slice(-GC_CHILD_OUTPUT_TAIL_LIMIT);
        } else {
            stderrLength += content.length;
            stderr += captured;
            stderrTail = (stderrTail + content).slice(-GC_CHILD_OUTPUT_TAIL_LIMIT);
        }
        if (stdoutLength + stderrLength > GC_CHILD_OUTPUT_LIMIT && !failure) {
            failure = new Error('GC child output exceeded its limit.');
            stopGcChild(child.pid);
        }
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
    const timer = setTimeout(() => {
        if (!failure) {
            failure = new Error(`GC child exceeded its ${GC_CHILD_DEADLINE_MS / 1000}-second deadline.`);
            stopGcChild(child.pid);
        }
    }, GC_CHILD_DEADLINE_MS);
    try {
        await new Promise<void>((resolve, reject) => {
            child.once('error', (error) => {
                failure = error;
            });
            child.once('close', (code, signal) => {
                if (failure || code !== 0 || signal) {
                    stopGcChild(child.pid);
                    reject(
                        new Error(
                            `GC child failed (${String(code)}, ${String(signal)}): ${failure?.message ?? 'nonzero exit or signal'}. ` +
                                `stdout length=${stdoutLength}, tail=${JSON.stringify(stdoutTail)}; ` +
                                `stderr length=${stderrLength}, tail=${JSON.stringify(stderrTail)}`
                        )
                    );
                    return;
                }
                resolve();
            });
        });
    } finally {
        clearTimeout(timer);
    }
    return stdout;
}

function assertGcChildEvidence(cwd: string, reportPath: string, stdout: string): void {
    const report: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (report === null || typeof report !== 'object') {
        throw new TypeError('GC child returned no test report.');
    }
    const files: unknown = Reflect.get(report, 'testResults');
    if (
        Reflect.get(report, 'success') !== true ||
        Reflect.get(report, 'numPassedTests') !== 1 ||
        Reflect.get(report, 'numFailedTests') !== 0 ||
        !Array.isArray(files) ||
        files.length !== 1
    ) {
        throw new Error('GC child did not report one passed focused case.');
    }
    const file: unknown = files[0];
    const fileName: unknown = file !== null && typeof file === 'object' ? Reflect.get(file, 'name') : undefined;
    if (
        file === null ||
        typeof file !== 'object' ||
        typeof fileName !== 'string' ||
        realpathSync(fileName) !== realpathSync(resolvePath(cwd, GC_SPEC)) ||
        Reflect.get(file, 'status') !== 'passed'
    ) {
        throw new Error('GC child report did not come from the current spec.');
    }
    const assertions: unknown = Reflect.get(file, 'assertionResults');
    if (!Array.isArray(assertions)) {
        throw new TypeError('GC child report has no assertions.');
    }
    const passed = assertions.filter(
        (assertion: unknown) =>
            assertion !== null &&
            typeof assertion === 'object' &&
            Reflect.get(assertion, 'status') === 'passed' &&
            Reflect.get(assertion, 'fullName') === GC_FULL_NAME
    );
    if (
        passed.length !== 1 ||
        assertions.some(
            (assertion: unknown) =>
                assertion !== null && typeof assertion === 'object' && Reflect.get(assertion, 'status') === 'failed'
        )
    ) {
        throw new Error('GC child did not execute the named measurement case exactly once.');
    }
    const receiptLine = stdout.split('\n').find((line) => line.includes('"sampledLiveExportBytesPeak":'));
    const receipt: unknown = receiptLine && JSON.parse(receiptLine.slice(receiptLine.indexOf('{')));
    if (receipt === null || typeof receipt !== 'object') {
        throw new Error('GC child emitted no ownership receipt.');
    }
    const b = 44100 * 3 * 2 * Float32Array.BYTES_PER_ELEMENT;
    const peak = Reflect.get(receipt, 'sampledLiveExportBytesPeak');
    const writes = Reflect.get(receipt, 'sinkWrites');
    const samples = Reflect.get(receipt, 'ownershipCheckpoints');
    if (
        Reflect.get(receipt, 'pcmBytesB') !== b ||
        typeof peak !== 'number' ||
        !Number.isInteger(peak) ||
        peak <= b ||
        peak > 2 * b ||
        typeof writes !== 'number' ||
        !Number.isInteger(writes) ||
        writes <= 64 * 3 ||
        typeof samples !== 'number' ||
        !Number.isInteger(samples) ||
        samples <= 64
    ) {
        throw new Error('GC child ownership receipt violates the measurement bounds.');
    }
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

async function runGcMeasurementInChild(): Promise<void> {
    const cwd = process.cwd();
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-export-gc-'));
    try {
        const reportPath = join(directory, 'report.json');
        const stdout = await runGcChild(cwd, reportPath);
        assertGcChildEvidence(cwd, reportPath, stdout);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

type TrackStoreSubscribe = (typeof import('#/modules/Arrangement/stores'))['trackStore']['subscribe'];

type TestClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio';
    audioBufferId?: string;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
};

type TestTrack = {
    id: string;
    name: string;
    kind: 'audio' | 'midi';
    clips: TestClip[];
};

type TestTrackStoreState = {
    tracks: TestTrack[];
    selectedTrackId: string | null;
    ghostClips: TestClip[];
};

type TestStore<TData> = {
    value: TData;
};

type TestTrackStore = TestStore<TestTrackStoreState> & {
    subscribe: TrackStoreSubscribe;
};

type TestTransportState = {
    loopStart: number;
    loopEnd: number;
};

type TestClipSelectionState = {
    marqueeSelection: null;
};

type TestAutomationState = {
    lanes: Array<{ trackId: string; parameterId: string; enabled: boolean }>;
};

type TestWorkspaceState = {
    soloMode: 'sip' | 'pfl';
};

type TestMidiNote = { id: string };

type TestMidiState = {
    notesByClipId: Record<string, TestMidiNote[]>;
};

type TestToasterPatternOutsideArrangement = { trackId: string; trackName: string; deviceName: string };

type EncodeWav = (
    buffer: unknown,
    depth: unknown,
    onProgress: ((fraction: number) => void) | undefined,
    dither: unknown
) => Promise<Uint8Array>;

type ExportDialogMocks = {
    audioContext: BaseAudioContext | null;
    encodeWav: ReturnType<typeof vi.fn<EncodeWav>>;
    getAudioContext: ReturnType<typeof vi.fn<() => BaseAudioContext | null>>;
    getAutoDetectedTailSeconds: ReturnType<typeof vi.fn>;
    isExportActive: ReturnType<typeof vi.fn<() => boolean>>;
    listToasterPatternsOutsideArrangement: ReturnType<
        typeof vi.fn<(input: unknown) => TestToasterPatternOutsideArrangement[]>
    >;
    loggerError: ReturnType<typeof vi.fn>;
    loggerWarn: ReturnType<typeof vi.fn>;
    midiStore: TestStore<TestMidiState>;
    notifyUser: ReturnType<typeof vi.fn>;
    renderOffline: ReturnType<typeof vi.fn>;
    restoreCachedAudioBuffersFromIdb: ReturnType<typeof vi.fn<() => Promise<number>>>;
    selectNativeAudioExportFile: ReturnType<typeof vi.fn>;
    trackStore: TestTrackStore;
    transportStore: TestStore<TestTransportState>;
    useStore: ReturnType<typeof vi.fn<(store: TestStore<unknown>, defaultValue?: unknown) => unknown>>;
    clipSelectionStore: TestStore<TestClipSelectionState>;
    automationStore: TestStore<TestAutomationState>;
    workspaceStore: TestStore<TestWorkspaceState>;
    writeNativeAudioMixdownFile: ReturnType<
        typeof vi.fn<(input: { bytes: Uint8Array; format: string; selectedFilePath: string }) => Promise<void>>
    >;
    exportStems: ReturnType<typeof vi.fn>;
    selectNativeAudioExportDirectory: ReturnType<typeof vi.fn>;
    writeNativeAudioStemFile: ReturnType<
        typeof vi.fn<(input: { bytes: Uint8Array; directoryPath: string; fileName: string }) => Promise<void>>
    >;
};

const mocks = vi.hoisted((): ExportDialogMocks => {
    const trackStore: TestTrackStore = {
        value: { tracks: [], selectedTrackId: null, ghostClips: [] },
        subscribe: vi.fn<TrackStoreSubscribe>((_callback) => () => {}),
    };
    const transportStore: TestStore<TestTransportState> = {
        value: { loopStart: 0, loopEnd: 0 },
    };
    const clipSelectionStore: TestStore<TestClipSelectionState> = {
        value: { marqueeSelection: null },
    };
    const automationStore: TestStore<TestAutomationState> = { value: { lanes: [] } };
    const workspaceStore: TestStore<TestWorkspaceState> = { value: { soloMode: 'sip' } };
    const midiStore: TestStore<TestMidiState> = { value: { notesByClipId: {} } };

    return {
        audioContext: null,
        encodeWav: vi.fn<EncodeWav>(),
        getAudioContext: vi.fn<() => BaseAudioContext | null>(() => null),
        getAutoDetectedTailSeconds: vi.fn(() => ({ seconds: 2, uncappedSeconds: 2, clamped: false })),
        isExportActive: vi.fn(() => false),
        listToasterPatternsOutsideArrangement: vi.fn<(input: unknown) => TestToasterPatternOutsideArrangement[]>(
            () => []
        ),
        loggerError: vi.fn(),
        loggerWarn: vi.fn(),
        midiStore,
        notifyUser: vi.fn(),
        renderOffline: vi.fn(),
        restoreCachedAudioBuffersFromIdb: vi.fn<() => Promise<number>>(),
        selectNativeAudioExportFile: vi.fn(),
        trackStore,
        transportStore,
        useStore: vi.fn((store: TestStore<unknown>, defaultValue?: unknown) => store.value ?? defaultValue),
        clipSelectionStore,
        automationStore,
        workspaceStore,
        writeNativeAudioMixdownFile: vi.fn(),
        exportStems: vi.fn(),
        selectNativeAudioExportDirectory: vi.fn(),
        writeNativeAudioStemFile:
            vi.fn<(input: { bytes: Uint8Array; directoryPath: string; fileName: string }) => Promise<void>>(),
    };
});

vi.mock('#/components/ui/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        error: mocks.loggerError,
        warn: mocks.loggerWarn,
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    readMusicalRangeInputs: vi.fn(() => []),
    defaultTrackState: { tracks: [], selectedTrackId: null, ghostClips: [] },
    trackStore: mocks.trackStore,
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
    clipSelectionStore: mocks.clipSelectionStore,
    // Not exercised by this spec — stubbed only because this spec's module graph
    // reaches these transitively (through unrelated use cases that share the
    // barrel) and the widened barrel-mock-coverage gate (`stores`) treats every
    // reachable import as required, even one only read inside a function body
    // this spec's tests never call.
    persistDeviceParam: vi.fn(),
    readMusicalRange: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),

    gainEnvelopeStore: { value: null },
    warpStateStore: { value: null },
    markerStore: { value: null },
    resolveEligibleClipWriteTarget: vi.fn(),
    updateClipInStore: vi.fn(),
    appendClipToTrack: vi.fn(),
    takeLaneStore: { value: null },
    vcaGroupStore: { value: null },
    adjustmentLayerStore: { value: null },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const { isValidMidiNoteExpression, sanitizeMidiStoreState } =
        await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        isValidMidiNoteExpression,
        sanitizeMidiStoreState,
        defaultMidiStoreState: { notesByClipId: {} },
        midiStore: mocks.midiStore,
        // Not exercised by this spec — stubbed only because this spec's module graph
        // reaches these transitively (through unrelated use cases that share the
        // barrel), same reasoning as the Arrangement/stores stubs above.
        isValidMidiProbabilitySeed: vi.fn(),
        chordTrackStore: { value: null },
        grooveTemplateStore: { value: null },
    };
});

// Fully mocked (not spread from importOriginal): the real barrel reaches
// toasterSubscriber → AudioEngine/useCases (already exhaustively mocked
// above), so loading it for real here would require widening that mock too.
vi.mock('#/modules/Toaster/useCases', () => ({
    compileToasterTrackStackActions: vi.fn(),
    getDefaultPadNames: vi.fn(),
    getToasterPresetDeviceState: vi.fn(),
    prepareOfflineToaster: vi.fn(),
    projectToasterKitToNativePatch: vi.fn(),
    setToasterEventBus: vi.fn(),
    initToasterSubscribers: vi.fn(),
    initToasterKitPersistence: vi.fn(),
    getToasterPresets: vi.fn(),
    setToasterGrooveAssignmentExecutor: vi.fn(),
    listToasterPatternsOutsideArrangement: mocks.listToasterPatternsOutsideArrangement,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: mocks.automationStore,
    // Not exercised by this spec — stubbed for the same reason as above.
    modulationStore: { value: null },
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    defaultWorkspaceState: { soloMode: 'sip' },
    workspaceStore: mocks.workspaceStore,
}));

// Export assertions spy through the `mocks.*` bindings below; every other
// AudioEngine key in this factory is an unread graph-coverage stub (`vi.fn()`
// and `audioEngine: {}`).
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        configureOfflineMidiEventProjection: actual.configureOfflineMidiEventProjection,
        configureOfflinePpqEndpointProjection: actual.configureOfflinePpqEndpointProjection,
        rearmCommittedTrackInputMonitoring: vi.fn(async () => undefined),
        reconcileAutoInputMonitoring: vi.fn(),
        stopTrackInputMonitoring: vi.fn(),

        startFaustNote: vi.fn(),
        soundsNativeNotes: vi.fn(() => false),
        writeNativeBuiltinParameters: vi.fn(),
        mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
        projectsToDifferentNativeBank: vi.fn(() => false),
        nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
        discardDecodedAudioFile: vi.fn(),
        cancelExport: vi.fn(),
        exportStems: async (options: Parameters<typeof actual.exportStems>[0]) => {
            if (typeof options === 'number') {
                throw new TypeError('Expected options');
            }
            const consume = options.onStem;
            if (!consume) {
                return actual.exportStems(options);
            }
            return actual.exportStems({
                ...options,
                onStem: async (...args: Parameters<typeof consume>) => {
                    await consume(...args);
                    ownership.consumed++;
                },
            });
        },
        getAudioContext: mocks.getAudioContext,
        getAutoDetectedTailSeconds: mocks.getAutoDetectedTailSeconds,
        isExportActive: mocks.isExportActive,
        renderOffline: mocks.renderOffline,
        restoreCachedAudioBuffersFromIdb: mocks.restoreCachedAudioBuffersFromIdb,
        addMidiFxToStrip: vi.fn(),
        analyzePitchForClip: vi.fn(),
        applyNoteExpression: vi.fn(),
        applyRuntimeGraphDelta: vi.fn(),
        audioEngine: {},
        cacheAudioBuffer: vi.fn(),
        clearReportedLatency: vi.fn(),
        createRuntimeGraphTopologyFingerprint: vi.fn(),
        decodeAudioFile: vi.fn(),
        ensureBusStrip: vi.fn(),
        garbageCollectCachedAudioBuffersByAge: vi.fn(),
        garbageCollectCachedAudioBuffersBySize: vi.fn(),
        garbageCollectFreezeAudioBuffers: vi.fn(),
        getCachedAudioBuffer: vi.fn(),
        getCompensationDelay: vi.fn(),
        getDefaultBendRangeSemitones: vi.fn(),
        getDeviceChainTailSeconds: vi.fn(),
        getEngineState: vi.fn(),
        getFactoryDrumKitByIndex: vi.fn(),
        getRuntimeGraphRevision: vi.fn(),
        getTrackStrip: vi.fn(),
        initializeTrackStripFromSnapshot: vi.fn(),
        matchesRuntimeDeviceChainTopology: vi.fn(),
        removeBusStrip: vi.fn(),
        removeMidiFxFromStrip: vi.fn(),
        removeSend: vi.fn(),
        removeTrackStrip: vi.fn(),
        deactivateTrackStrip: vi.fn(),
        renderTrackSubgraphOffline: vi.fn(),
        reportLatency: vi.fn(),
        resolveToasterPadBinding: vi.fn(),
        setBusGain: vi.fn(),
        setSend: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackMute: vi.fn(),
        setTrackOutput: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackSoloGate: vi.fn(),
        startInputMonitoring: vi.fn(),
        stopInputMonitoring: vi.fn(),
        unwireSidechainRoute: vi.fn(),
        updateDeviceBypass: vi.fn(),
        updateDeviceParam: vi.fn(),
        updateMidiFxBypass: vi.fn(),
        updateMidiFxParam: vi.fn(),
        wireSidechainRoute: vi.fn(),
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiControl: () => Promise.resolve(true),
        sendNativeLiveMidiNote: () => Promise.resolve(true),
    };
});

// Partial mock: the dialog now also reaches Arrangement's use-case barrel for
// device tail declarations, which pulls in MIDI/Transport consumers that need
// the real module's other exports.
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: mocks.transportStore,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../../useCases/audioExport/selectNativeAudioExportDirectory', () => ({
    selectNativeAudioExportDirectory: mocks.selectNativeAudioExportDirectory,
}));

vi.mock('../../../useCases/audioExport/selectNativeAudioExportFile', () => ({
    selectNativeAudioExportFile: mocks.selectNativeAudioExportFile,
}));

vi.mock('../../../useCases/audioExport/writeNativeAudioMixdownFile', () => ({
    writeNativeAudioMixdownFile: mocks.writeNativeAudioMixdownFile,
}));

vi.mock('../../../useCases/audioExport/writeNativeAudioStemFile', () => ({
    writeNativeAudioStemFile: mocks.writeNativeAudioStemFile,
}));

vi.mock('../../../useCases/renderToClip', () => ({
    renderToClip: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    isNativeProjectRuntimeAvailable: vi.fn(() => false),
}));

// Partial mock: only the load/save pair is stubbed. The module also exports the
// export-format constants the dialog renders, and replacing it wholesale meant
// every new constant silently arrived as undefined.
vi.mock('../exportSettings', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../exportSettings')>()),
    loadExportSettings: vi.fn(() => ({
        formats: ['wav'],
        sampleRate: 44100,
        bitDepth: 24,
        mp3BitRate: 128,
        dither: 'random',
        normalization: 'off',
    })),
    saveExportSettings: vi.fn(),
}));

const zipAllocation = vi.hoisted(() => ({
    observe: (_bytes: Uint8Array) => {},
    onEntry: (_filename: string) => {},
}));
vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>();
    return {
        ...actual,
        Zip: class extends actual.Zip {
            constructor(handler: ConstructorParameters<typeof actual.Zip>[0]) {
                super((error, bytes, final) => {
                    zipAllocation.observe(bytes);
                    handler?.(error, bytes, final);
                });
            }

            add(file: Parameters<typeof actual.Zip.prototype.add>[0]) {
                zipAllocation.onEntry(file.filename);
                super.add(file);
            }
        },
    };
});

const ownership = vi.hoisted(() => ({ rendered: 0, consumed: 0, peakRetained: 0, unexpectedDecodeCalls: 0 }));
let reportFirstGcRender = () => {};
const stemRender = vi.hoisted(() => ({
    frames: 44100,
    tracks: Array.from(
        { length: 64 },
        (_, index) =>
            ({
                id: `track-${index}`,
                name: `Track ${index}`,
                kind: 'midi',
                disabled: false,
                devices: [],
                clips: [],
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: '#ffffff',
                sends: [],
                midiFx: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: null,
                collapsed: false,
                inputMonitoring: 'off',
                hidden: false,
                height: 80,
                outputId: 'master',
                automationMode: 'read',
                groupId: null,
                soloSafe: false,
                notes: '',
                inputId: null,
                activeAlternativeId: `alt-${index}`,
                alternatives: [{ id: `alt-${index}`, name: 'Alternative 1', clips: [] }],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            }) satisfies Track
    ),
}));
// This observes production render admission and awaited consumer completion. It is an ownership
// bound, not process RSS. Codec/sink bytes are also observed; Chrome RSS remains a separate gate.
describe('connected stem export output ownership', () => {
    beforeEach(() => {
        ownership.rendered = 0;
        ownership.consumed = 0;
        ownership.peakRetained = 0;
        ownership.unexpectedDecodeCalls = 0;
        reportFirstGcRender = () => {};
        zipAllocation.onEntry = () => {};
        stemRender.frames = 44100;
        mocks.trackStore.value = { tracks: stemRender.tracks, selectedTrackId: null, ghostClips: [] };
        vi.clearAllMocks();
        mocks.audioContext = asBaseAudioContext(createMockAudioContext());
        mocks.getAudioContext.mockImplementation(() => mocks.audioContext);
        mocks.restoreCachedAudioBuffersFromIdb.mockResolvedValue(0);
        mocks.automationStore.value = { lanes: [] };
        mocks.midiStore.value = { notesByClipId: {} };
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        configureOfflinePpqEndpointProjection({
            project: ({ startPpq, endPpq, defaultTempo, sampleRate }) => {
                const startSeconds = (startPpq * 60) / defaultTempo;
                const endSeconds = (endPpq * 60) / defaultTempo;
                return {
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                    startSamples: Math.round(startSeconds * sampleRate),
                    endSamples: Math.round(endSeconds * sampleRate),
                    durationSamples: Math.round((endSeconds - startSeconds) * sampleRate),
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
        });
        configureOfflineMidiEventProjection({
            createProjector:
                () =>
                ({ events }) =>
                    events,
            selectProbability: () => true,
            createChordPitchProjector:
                () =>
                ({ pitch }) =>
                    pitch,
            evaluateAutomationValue: () => null,
        });
        // Only the Web Audio platform is synthetic. The actual context/strip/scheduler and
        // public exportStems consumer run; no private AudioEngine route is substituted.
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function () {
                const context = createMockAudioContext();
                // The shared helper's eager decoder sample is outside this MIDI-only export budget.
                context.decodeAudioData = vi.fn(async () => {
                    ownership.unexpectedDecodeCalls++;
                    throw new Error('Offline decoding is not configured for this MIDI-only export fixture.');
                });
                return {
                    ...context,
                    sampleRate: 44100,
                    suspend: undefined,
                    resume: undefined,
                    async startRendering() {
                        ownership.rendered++;
                        if (ownership.rendered === 1) {
                            reportFirstGcRender();
                        }
                        ownership.peakRetained = Math.max(
                            ownership.peakRetained,
                            ownership.rendered - ownership.consumed
                        );
                        const channels = [
                            new Float32Array(stemRender.frames).fill(0.125),
                            new Float32Array(stemRender.frames).fill(-0.125),
                        ];
                        return {
                            sampleRate: 44100,
                            numberOfChannels: 2,
                            length: stemRender.frames,
                            getChannelData: (channel: number) => channels[channel]!,
                        };
                    },
                };
            })
        );
    });
    it('drains 64 real stem renders through WAV and ZIP before admitting the next render', async () => {
        const chunks: Uint8Array[] = [];
        let maxWrite = 0;
        let closed = false;
        vi.stubGlobal('showSaveFilePicker', async () => ({
            createWritable: async () => ({
                write: async (bytes: Uint8Array) => {
                    maxWrite = Math.max(maxWrite, bytes.byteLength);
                    chunks.push(bytes.slice());
                },
                close: async () => {
                    closed = true;
                },
                abort: async () => {},
            }),
        }));
        render(<ExportDialog open onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('export-mode-stems'));
        fireEvent.click(screen.getByTestId('export-start'));
        await waitFor(() => expect(closed).toBe(true), { timeout: 15000 });
        expect(ownership.rendered).toBe(64);
        expect(ownership.unexpectedDecodeCalls).toBe(0);
        expect(ownership.peakRetained).toBeLessThanOrEqual(1);
        expect(maxWrite).toBeLessThanOrEqual(1024 * 1024);
        const size = chunks.reduce((sum, bytes) => sum + bytes.length, 0);
        const archive = new Uint8Array(size);
        let offset = 0;
        for (const bytes of chunks) {
            archive.set(bytes, offset);
            offset += bytes.length;
        }
        const entries = unzipSync(archive);
        expect(Object.keys(entries)).toHaveLength(64);
        for (const bytes of Object.values(entries)) {
            expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
            const wav = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            expect(wav.getUint32(24, true)).toBe(44100);
            expect(wav.getUint16(22, true)).toBe(2);
            expect(wav.getUint16(34, true)).toBe(24);
            expect(bytes.byteLength).toBe(44 + 44100 * 2 * 3);
        }
        vi.unstubAllGlobals();
    }, 20000);
    it(
        GC_CASE_NAME,
        async () => {
            const phaseStartedAt = Date.now();
            const gc: unknown = Reflect.get(globalThis, 'gc');
            const isGcChild = process.env[GC_CHILD_MARKER] === '1';
            process.stdout.write(
                `GC_PHASE entry abs=${phaseStartedAt} ms=0 gc=${typeof gc} parent=${!isGcChild} child=${isGcChild}\n`
            );
            if (typeof gc !== 'function') {
                if (process.env[GC_CHILD_MARKER] === '1') {
                    throw new TypeError('Run this ownership probe with node --expose-gc.');
                }
                await runGcMeasurementInChild();
                return;
            }
            if (!process.execArgv.includes(GC_SYNCHRONOUS_TIERING_FLAG)) {
                throw new TypeError(`Run this ownership probe with node ${GC_SYNCHRONOUS_TIERING_FLAG}.`);
            }
            stemRender.frames = 44100 * 3;
            const b = stemRender.frames * 2 * Float32Array.BYTES_PER_ELEMENT;
            vi.mocked(loadExportSettings).mockReturnValueOnce({
                formats: ['wav', 'mp3', 'flac'],
                sampleRate: 44100,
                bitDepth: 24,
                mp3BitRate: 128,
                dither: 'seeded',
                normalization: 'off',
            });
            const observed = new WeakSet<ArrayBufferLike>();
            const observations = new WeakMap<ArrayBufferLike, BufferObservation>();
            const allocations: WeakRef<ArrayBufferLike>[] = [];
            let currentFormat: 'wav' | 'mp3' | 'flac' | '-' = '-';
            const track = (buffer: ArrayBufferLike, origin: string) => {
                if (!observed.has(buffer)) {
                    observed.add(buffer);
                    allocations.push(new WeakRef(buffer));
                    const allocationBytes = buffer.byteLength;
                    let producerStack: string | undefined;
                    if (allocationBytes === 8192) {
                        producerStack = new Error('Export buffer allocation').stack
                            ?.split('\n')
                            .slice(3, 7)
                            .join(' | ')
                            .replaceAll(process.cwd(), '.')
                            .slice(0, 320);
                    }
                    observations.set(buffer, {
                        origin,
                        allocationBytes,
                        format: currentFormat,
                        renderGeneration: ownership.rendered,
                        producerStack,
                    });
                }
            };
            let collecting = true;
            let peak = 0;
            const constructors = [
                'ArrayBuffer',
                'Float32Array',
                'Int32Array',
                'Int16Array',
                'Int8Array',
                'Uint8Array',
                'Uint16Array',
                'Uint32Array',
            ] as const;
            for (const name of constructors) {
                const Original = globalThis[name];
                vi.stubGlobal(
                    name,
                    new Proxy(Original, {
                        construct(target, args) {
                            const value = Reflect.construct(target, args);
                            if (collecting) {
                                if (ArrayBuffer.isView(value)) {
                                    track(value.buffer, `ctor:${name}`);
                                } else if (value instanceof ArrayBuffer) {
                                    track(value, `ctor:${name}`);
                                }
                            }
                            return value;
                        },
                    })
                );
            }
            zipAllocation.observe = (bytes) => {
                if (collecting) {
                    track(bytes.buffer, 'zip-output');
                }
            };
            let closed = false;
            let writes = 0;
            let samples = 0;
            let entryWrites = 0;
            let entryBytes = 0;
            let lastWorkPhase = 'entry';
            let lastSampledLive: number | undefined;
            let lastSampledAt: number | undefined;
            let reportedNearBound = false;
            let heartbeat: ReturnType<typeof setInterval> | undefined;
            let resolveFinished: () => void = () => {};
            let rejectFinished: (reason: unknown) => void = () => {};
            const finished = new Promise<void>((resolve, reject) => {
                resolveFinished = resolve;
                rejectFinished = reject;
            });
            const reportGcPhase = (phase: string, live?: number) => {
                // Diagnostic output must not enter the buffers measured by the next checkpoint.
                const wasCollecting = collecting;
                collecting = false;
                try {
                    lastWorkPhase = phase;
                    const now = Date.now();
                    process.stdout.write(
                        `GC_PHASE ${phase} abs=${now} ms=${now - phaseStartedAt} fmt=${currentFormat} ew=${entryWrites} eb=${entryBytes} r=${ownership.rendered} c=${ownership.consumed} dc=${ownership.unexpectedDecodeCalls} w=${writes} s=${samples} refs=${allocations.length} live=${live ?? '-'} peak=${peak}\n`
                    );
                } finally {
                    collecting = wasCollecting;
                }
            };
            const reportGcHeartbeat = () => {
                const wasCollecting = collecting;
                collecting = false;
                try {
                    const now = Date.now();
                    const memory = process.memoryUsage();
                    process.stdout.write(
                        `GC_HEARTBEAT abs=${now} ms=${now - phaseStartedAt} parent=${!isGcChild} child=${isGcChild} gc=${typeof gc} fmt=${currentFormat} ew=${entryWrites} eb=${entryBytes} r=${ownership.rendered} c=${ownership.consumed} w=${writes} s=${samples} last=${lastWorkPhase} staleLive=${lastSampledLive ?? '-'} stalePeak=${peak} sampleAgeMs=${lastSampledAt === undefined ? '-' : now - lastSampledAt} advisoryRss=${memory.rss} advisoryHeap=${memory.heapUsed} advisoryArrayBuffers=${memory.arrayBuffers}\n`
                    );
                } finally {
                    collecting = wasCollecting;
                }
            };
            const reportBufferAttribution = (phase: 'near-bound' | 'over-bound', sample: LiveBufferSample) => {
                const wasCollecting = collecting;
                collecting = false;
                try {
                    const payload = {
                        phase,
                        sample: samples,
                        live: sample.live,
                        bySize: topBufferBuckets(sample.bySize, 12),
                        byOrigin: topBufferBuckets(sample.byOrigin, 12),
                        byGeneration: topBufferBuckets(sample.byGeneration, 12),
                        eightKiBStacks: topBufferBuckets(sample.byEightKiBStack, 8),
                    };
                    const line = `GC_ATTRIBUTION ${JSON.stringify(payload)}`;
                    if (Buffer.byteLength(line, 'utf8') < GC_ATTRIBUTION_LINE_LIMIT) {
                        process.stdout.write(`${line}\n`);
                        return;
                    }
                    const eightKiBStacks = topBufferBuckets(sample.byEightKiBStack, 2).map(
                        ([stack, bucket]) => [stack.slice(0, 160), bucket] as const
                    );
                    process.stdout.write(
                        `GC_ATTRIBUTION ${JSON.stringify({ phase, sample: samples, live: sample.live, bySize: topBufferBuckets(sample.bySize, 6), byOrigin: topBufferBuckets(sample.byOrigin, 6), byGeneration: topBufferBuckets(sample.byGeneration, 4), eightKiBStacks, truncated: true })}\n`
                    );
                } finally {
                    collecting = wasCollecting;
                }
            };
            reportFirstGcRender = () => reportGcPhase('render');
            zipAllocation.onEntry = (filename) => {
                if (filename.endsWith('.wav')) {
                    currentFormat = 'wav';
                } else if (filename.endsWith('.mp3')) {
                    currentFormat = 'mp3';
                } else if (filename.endsWith('.flac')) {
                    currentFormat = 'flac';
                } else {
                    currentFormat = '-';
                }
                entryWrites = 0;
                entryBytes = 0;
            };
            vi.stubGlobal('showSaveFilePicker', async () => ({
                createWritable: async () => ({
                    write: async (bytes: Uint8Array) => {
                        track(bytes.buffer, 'sink-write');
                        writes++;
                        entryWrites++;
                        entryBytes += bytes.byteLength;
                        if (writes === 1) {
                            reportGcPhase('first-write');
                        }
                        // Sample at fixed ownership checkpoints. Full collections for every small MPEG
                        // packet dominated the test itself; each checkpoint still includes every observed buffer.
                        if (writes % 32 !== 1) {
                            return;
                        }
                        samples++;
                        reportGcPhase('before-turn');
                        // WeakRef targets are kept alive for the job that observed them. Advance a real
                        // turn before GC; no fixed microtask count stands in for collection completion.
                        await new Promise<void>((resolve) => setTimeout(resolve, 0));
                        reportGcPhase('before-gc');
                        gc();
                        reportGcPhase('before-scan');
                        const sample = sampleLiveExportBytes(allocations, observations);
                        const live = sample.live;
                        peak = Math.max(peak, live);
                        lastSampledLive = live;
                        lastSampledAt = Date.now();
                        reportGcPhase('before-bound', live);
                        if (live > 2 * b) {
                            reportBufferAttribution('over-bound', sample);
                        } else if (!reportedNearBound && live >= 2 * b - 16 * 1024) {
                            reportedNearBound = true;
                            reportBufferAttribution('near-bound', sample);
                        }
                        expect(live).toBeLessThanOrEqual(2 * b);
                        reportGcPhase('after-bound', live);
                    },
                    close: async () => {
                        closed = true;
                        reportGcPhase('close');
                        resolveFinished();
                    },
                    abort: async () => {
                        reportGcPhase('abort');
                        rejectFinished(
                            mocks.loggerError.mock.calls.at(-1)?.[0] ??
                                new Error('Streaming export aborted before commit.')
                        );
                        reportGcPhase('finished-rejected');
                    },
                }),
            }));
            try {
                heartbeat = setInterval(reportGcHeartbeat, 1000);
                render(<ExportDialog open onClose={() => {}} />);
                fireEvent.click(screen.getByTestId('export-mode-stems'));
                try {
                    await act(async () => {
                        fireEvent.click(screen.getByTestId('export-start'));
                        await finished;
                    });
                } catch (error) {
                    reportGcPhase('act-rejected');
                    throw error;
                }
                reportGcPhase('act-resolved');
                expect(closed).toBe(true);
                expect(ownership.rendered).toBe(64);
                expect(ownership.unexpectedDecodeCalls).toBe(0);
                expect(ownership.peakRetained).toBe(1);
                expect(writes).toBeGreaterThan(64 * 3);
                expect(samples).toBeGreaterThan(64);
                process.stdout.write(
                    `${JSON.stringify({
                        pcmBytesB: b,
                        sampledLiveExportBytesPeak: peak,
                        sinkWrites: writes,
                        ownershipCheckpoints: samples,
                    })}\n`
                );
                expect(peak).toBeGreaterThan(b);
                expect(peak).toBeLessThanOrEqual(2 * b);
            } finally {
                if (heartbeat !== undefined) {
                    clearInterval(heartbeat);
                }
                reportGcPhase('finally');
                collecting = false;
                reportFirstGcRender = () => {};
                zipAllocation.observe = () => {};
                zipAllocation.onEntry = () => {};
                vi.unstubAllGlobals();
            }
        },
        GC_CASE_TIMEOUT_MS
    );
});

it('keeps only live observed export buffers after sampling', () => {
    const firstBuffer = new ArrayBuffer(8);
    const secondBuffer = new ArrayBuffer(13);
    const first = { [Symbol.toStringTag]: 'WeakRef', deref: vi.fn(() => firstBuffer) } as const;
    const collected = { [Symbol.toStringTag]: 'WeakRef', deref: vi.fn(() => undefined) } as const;
    const second = { [Symbol.toStringTag]: 'WeakRef', deref: vi.fn(() => secondBuffer) } as const;
    const allocations: WeakRef<ArrayBufferLike>[] = [first, collected, second];
    const observations = new WeakMap<ArrayBufferLike, BufferObservation>([
        [firstBuffer, { origin: 'ctor:Uint8Array', allocationBytes: 8, format: 'mp3', renderGeneration: 2 }],
        [secondBuffer, { origin: 'sink-write', allocationBytes: 13, format: 'wav', renderGeneration: 3 }],
    ]);

    const sample = sampleLiveExportBytes(allocations, observations);
    expect(sample.live).toBe(21);
    expect([...sample.bySize]).toEqual([
        [8, { count: 1, bytes: 8 }],
        [13, { count: 1, bytes: 13 }],
    ]);
    expect([...sample.byOrigin]).toEqual([
        ['ctor:Uint8Array', { count: 1, bytes: 8 }],
        ['sink-write', { count: 1, bytes: 13 }],
    ]);
    expect([...sample.byGeneration]).toEqual([
        ['mp3:render-2', { count: 1, bytes: 8 }],
        ['wav:render-3', { count: 1, bytes: 13 }],
    ]);
    expect([...sample.bySize.values()].reduce((sum, bucket) => sum + bucket.bytes, 0)).toBe(sample.live);
    expect(allocations).toEqual([first, second]);
    expect(first.deref).toHaveBeenCalledTimes(1);
    expect(collected.deref).toHaveBeenCalledTimes(1);
    expect(second.deref).toHaveBeenCalledTimes(1);
});

it('attributes a live 8192-byte export buffer without retaining dead references', () => {
    const codecBuffer = new ArrayBuffer(8192);
    const sinkBuffer = new ArrayBuffer(13);
    const codec = { [Symbol.toStringTag]: 'WeakRef', deref: vi.fn(() => codecBuffer) } as const;
    const collected = { [Symbol.toStringTag]: 'WeakRef', deref: vi.fn(() => undefined) } as const;
    const sink = { [Symbol.toStringTag]: 'WeakRef', deref: vi.fn(() => sinkBuffer) } as const;
    const allocations: WeakRef<ArrayBufferLike>[] = [codec, collected, sink];
    const observations = new WeakMap<ArrayBufferLike, BufferObservation>([
        [
            codecBuffer,
            {
                origin: 'ctor:Uint8Array',
                allocationBytes: 8192,
                format: 'mp3',
                renderGeneration: 56,
                producerStack: 'mp3Encoder.ts:45',
            },
        ],
        [sinkBuffer, { origin: 'sink-write', allocationBytes: 13, format: 'mp3', renderGeneration: 56 }],
    ]);

    const sample = sampleLiveExportBytes(allocations, observations);
    expect(sample.live).toBe(8192 + 13);
    expect([...sample.bySize]).toEqual([
        [8192, { count: 1, bytes: 8192 }],
        [13, { count: 1, bytes: 13 }],
    ]);
    expect([...sample.byEightKiBStack]).toEqual([['mp3Encoder.ts:45', { count: 1, bytes: 8192 }]]);
    expect([...sample.bySize.values()].reduce((sum, bucket) => sum + bucket.bytes, 0)).toBe(sample.live);
    expect(allocations).toEqual([codec, sink]);
    expect(codec.deref).toHaveBeenCalledTimes(1);
    expect(collected.deref).toHaveBeenCalledTimes(1);
    expect(sink.deref).toHaveBeenCalledTimes(1);
});
