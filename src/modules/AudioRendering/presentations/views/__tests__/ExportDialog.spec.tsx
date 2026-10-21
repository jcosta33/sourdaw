import { type ReactNode } from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';
import { measureIntegratedLoudness } from '#/utils/audioMetering/measureIntegratedLoudness';
import { measureTruePeak } from '#/utils/audioMetering/measureTruePeak';

import * as normalizationUseCase from '../../../useCases/normalizeExportBuffer';
import { renderToClip } from '../../../useCases/renderToClip';
import { ExportDialog } from '../ExportDialog';
import { loadExportSettings, saveExportSettings } from '../exportSettings';

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
    kind: 'audio';
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
    encodeMp3: ReturnType<typeof vi.fn>;
    encodeFlac: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
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
        encodeMp3: vi.fn(),
        encodeFlac: vi.fn(),
        commit: vi.fn(async () => {}),
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

const audioBufferToMp3 = mocks.encodeMp3;
const audioBufferToFlac = mocks.encodeFlac;

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

vi.mock('#/modules/Arrangement/stores', () => ({
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
    getTrackEligibility: vi.fn(),
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
vi.mock('#/modules/AudioEngine/useCases', () => ({
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
    exportStems: async (options: {
        onStemPlan?: (ids: string[]) => void;
        onStem?: (id: string, buffer: AudioBuffer, index: number, total: number) => Promise<void>;
    }) => {
        const stems: Map<string, AudioBuffer> = await mocks.exportStems(options);
        options.onStemPlan?.([...stems.keys()]);
        let index = 0;
        for (const [id, buffer] of stems) {
            await options.onStem?.(id, buffer, index++, stems.size);
        }
        return new Map();
    },
    getAudioContext: mocks.getAudioContext,
    getAutoDetectedTailSeconds: mocks.getAutoDetectedTailSeconds,
    isExportActive: mocks.isExportActive,
    renderOffline: async (options: { onRendered?: (source: AudioBuffer) => Promise<void> }) => {
        const buffer = await mocks.renderOffline(options);
        await options.onRendered?.(buffer);
        return buffer;
    },
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
}));

// UI controllers retain their encoding pause points. The connected memory and codec specs own
// real streaming allocations, packet boundaries and bytes; these controllers teach each UI outcome.
vi.mock('../../../repositories/audioEncoders/wavEncoder', () => ({
    audioBufferToWav: async (
        buffer: AudioBuffer,
        depth: number,
        onProgress: ((fraction: number) => void) | undefined,
        dither: unknown,
        writer?: { write: (bytes: Uint8Array) => Promise<void>; checkCancelled?: () => void }
    ) => {
        const bytes = await mocks.encodeWav(buffer, depth, onProgress, dither);
        writer?.checkCancelled?.();
        if (writer) await writer.write(bytes);
        return bytes.buffer;
    },
}));
vi.mock('../../../useCases/audioBufferToMp3', () => ({
    audioBufferToMp3: async (
        buffer: AudioBuffer,
        rate: number,
        progress: unknown,
        dither: unknown,
        metadata: unknown,
        writer?: { write: (bytes: Uint8Array) => Promise<void>; checkCancelled?: () => void }
    ) => {
        const bytes: Uint8Array = await mocks.encodeMp3(buffer, rate, progress, dither, metadata);
        writer?.checkCancelled?.();
        if (writer) await writer.write(bytes);
        return bytes;
    },
}));
vi.mock('../../../repositories/audioEncoders/flacEncoder', () => ({
    audioBufferToFlac: async (
        buffer: AudioBuffer,
        depth: number,
        progress: unknown,
        dither: unknown,
        writer?: { write: (bytes: Uint8Array) => Promise<void>; checkCancelled?: () => void }
    ) => {
        const bytes: Uint8Array = await mocks.encodeFlac(buffer, depth, progress, dither);
        writer?.checkCancelled?.();
        if (writer) await writer.write(bytes);
        return bytes;
    },
}));
vi.mock('../../../repositories/audioExport/streamExportToNative', () => ({
    streamExportToNative: async (input: {
        directoryPath?: string;
        selectedFilePath?: string;
        checkCancelled: () => void;
    }) => ({
        async beginFile(name: string) {
            let bytes = new Uint8Array();
            return {
                writer: {
                    checkCancelled: input.checkCancelled,
                    write: async (chunk: Uint8Array) => {
                        bytes = chunk.slice();
                    },
                },
                finish: async () => {
                    input.checkCancelled();
                    if (input.directoryPath)
                        await mocks.writeNativeAudioStemFile({
                            bytes,
                            directoryPath: input.directoryPath,
                            fileName: name,
                        });
                    else
                        await mocks.writeNativeAudioMixdownFile({
                            bytes,
                            selectedFilePath: input.selectedFilePath,
                            format: name.split('.').pop(),
                        });
                    input.checkCancelled();
                },
            };
        },
        commit: async (begin: () => void) => {
            input.checkCancelled();
            begin();
            await mocks.commit();
        },
        abort: async () => {},
    }),
}));

// Partial mock: the dialog now also reaches Arrangement's use-case barrel for
// device tail declarations, which pulls in MIDI/Transport consumers that need
// the real module's other exports.
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    defaultTransportState: { loopStart: 0, loopEnd: 0 },
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
    isNativeProjectRuntimeAvailable: vi.fn(() => true),
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

function createClip(input: { id: string; audioBufferId?: string; startBeat?: number; endBeat?: number }): TestClip {
    return {
        id: input.id,
        trackId: 'track-1',
        name: input.id,
        startBeat: input.startBeat ?? 0,
        endBeat: input.endBeat ?? 4,
        type: 'audio',
        audioBufferId: input.audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

function setProjectClips(clips: TestClip[]): void {
    mocks.trackStore.value = {
        tracks: [
            {
                id: 'track-1',
                name: 'Track 1',
                kind: 'audio',
                clips,
            },
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

function setProjectTracks(tracks: TestTrack[]): void {
    mocks.trackStore.value = {
        tracks,
        selectedTrackId: tracks[0]?.id ?? null,
        ghostClips: [],
    };
}

async function startRenderToClip(): Promise<number> {
    vi.mocked(renderToClip).mockReturnValue({ trackId: 'track-1', clipId: 'clip-new', audioBufferId: 'rendered-1' });
    fireEvent.click(screen.getByRole('button', { name: /to clip/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Render to Clip' }));

    await waitFor(() => {
        expect(renderToClip).toHaveBeenCalledTimes(1);
    });
    const renderedWith: { tailSeconds?: unknown } | undefined = mocks.renderOffline.mock.calls[0]?.[0];
    const renderedTail = renderedWith?.tailSeconds;
    if (typeof renderedTail !== 'number') {
        throw new TypeError('expected renderOffline to receive a numeric tailSeconds');
    }
    return renderedTail;
}

function createDeferred<TValue>(): {
    promise: Promise<TValue>;
    resolve: (value: TValue) => void;
    reject: (error: Error) => void;
} {
    let settle: (value: TValue) => void = () => {
        throw new Error('Deferred was not initialised');
    };
    let fail: (error: Error) => void = () => {
        throw new Error('Deferred was not initialised');
    };
    const promise = new Promise<TValue>((resolve, reject) => {
        settle = resolve;
        fail = reject;
    });
    return { promise, resolve: settle, reject: fail };
}

type RenderCallbacks = {
    onProgress: (fraction: number) => void;
    onWarning: (message: string) => void;
};

/** A committed export reads finished, once, and nothing re-reports it as cancelled. */
async function expectSucceededExportState(): Promise<void> {
    await waitFor(() => {
        expect(screen.getByText(/Baking Complete/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Oven turned off.')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('button', { name: /close bakery/i })).toBeInTheDocument();
    expect(mocks.notifyUser.mock.calls.filter((call) => call[1] === 'success')).toHaveLength(1);
    // Outlast the cancelled-state unlock delay: a late reset would land here.
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(screen.queryByText('Oven turned off.')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
}

/** A WAV encoder that finishes its pass: real encoders end by reporting progress 1. */
function encodeWavReportingDone(): void {
    mocks.encodeWav.mockImplementation((_buffer, _depth, onProgress) => {
        onProgress?.(1);
        return Promise.resolve(new Uint8Array([1, 2, 3]));
    });
}

/** A cancelled export reads cancelled, never finished, and hands the dialog back for a new export. */
async function expectCancelledExportState(startButtonName: string | RegExp = /start baking/i): Promise<void> {
    await waitFor(() => {
        expect(screen.getByText('Oven turned off.')).toBeInTheDocument();
    });
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100);
    await waitFor(
        () => {
            expect(screen.getByRole('button', { name: startButtonName })).toBeEnabled();
        },
        { timeout: 4000 }
    );
    expect(screen.queryByRole('button', { name: /close bakery/i })).not.toBeInTheDocument();
}

async function startMixdownExport(): Promise<void> {
    render(<ExportDialog open={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

    await waitFor(() => {
        expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
    });
}

const podcastEpisode = { title: 'Épisode 🌊', artist: 'José', description: '音楽 et voix' };

function createPodcastFixture(sampleRate = 44100): AudioBuffer {
    const buffer = MockAudioBuffer.create(2, sampleRate, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < data.length; index++) {
            data[index] = 0.03 * Math.sin((2 * Math.PI * (channel === 0 ? 1000 : 500) * index) / sampleRate);
        }
    }
    return buffer;
}

function selectPodcastEpisode(): void {
    fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
        target: { value: 'podcast-rss-mp3' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Episode title' }), {
        target: { value: podcastEpisode.title },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Artist' }), { target: { value: podcastEpisode.artist } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
        target: { value: podcastEpisode.description },
    });
}

function expectPodcastBytes(bytes: Uint8Array, metadata: { title: string; artist: string; description: string }): void {
    const decoder = new TextDecoder();
    expect(Array.from(bytes.subarray(0, 6))).toEqual([73, 68, 51, 4, 0, 0]);
    const sizeAt = (offset: number): number => {
        const values = Array.from(bytes.subarray(offset, offset + 4));
        expect(values.every((value) => value < 128)).toBe(true);
        return values.reduce((size, value) => size * 128 + value, 0);
    };
    const end = 10 + sizeAt(6);
    let offset = 10;
    const frames: Record<string, Uint8Array> = {};
    while (offset < end) {
        const id = decoder.decode(bytes.subarray(offset, offset + 4));
        const size = sizeAt(offset + 4);
        expect(Array.from(bytes.subarray(offset + 8, offset + 10))).toEqual([0, 0]);
        frames[id] = bytes.subarray(offset + 10, offset + 10 + size);
        offset += 10 + size;
    }
    expect(offset).toBe(end);
    expect(Object.keys(frames)).toEqual(['TIT2', 'TPE1', 'COMM']);
    expect(frames.TIT2![0]).toBe(3);
    expect(decoder.decode(frames.TIT2!.subarray(1))).toBe(metadata.title);
    expect(frames.TPE1![0]).toBe(3);
    expect(decoder.decode(frames.TPE1!.subarray(1))).toBe(metadata.artist);
    expect(Array.from(frames.COMM!.subarray(0, 5))).toEqual([3, 117, 110, 100, 0]);
    expect(decoder.decode(frames.COMM!.subarray(5))).toBe(metadata.description);
    expect(bytes.length - end).toBeGreaterThan(1000);
    expect(bytes[end]).toBe(255);
    expect(bytes[end + 1]! & 0xe0).toBe(0xe0);
}

describe('ExportDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioContext = asBaseAudioContext(createMockAudioContext());
        mocks.getAudioContext.mockImplementation(() => mocks.audioContext);
        mocks.getAutoDetectedTailSeconds.mockReturnValue({ seconds: 2, uncappedSeconds: 2, clamped: false });
        mocks.restoreCachedAudioBuffersFromIdb.mockResolvedValue(0);
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.wav');
        mocks.renderOffline.mockResolvedValue(MockAudioBuffer.create(2, 128, 44100));
        mocks.encodeWav.mockResolvedValue(new Uint8Array([1, 2, 3]));
        mocks.encodeMp3.mockResolvedValue(new Uint8Array([4, 5, 6]));
        mocks.encodeFlac.mockResolvedValue(new Uint8Array([7, 8, 9]));
        mocks.commit.mockResolvedValue(undefined);
        mocks.writeNativeAudioMixdownFile.mockResolvedValue(undefined);
        mocks.selectNativeAudioExportDirectory.mockResolvedValue('/tmp/sourdaw-stems');
        mocks.writeNativeAudioStemFile.mockResolvedValue(undefined);
        mocks.automationStore.value = { lanes: [] };
        mocks.workspaceStore.value = { soloMode: 'sip' };
        mocks.midiStore.value = { notesByClipId: {} };
        mocks.listToasterPatternsOutsideArrangement.mockReturnValue([]);
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
        setProjectClips([
            createClip({ id: 'clip-1', audioBufferId: 'buffer-1' }),
            createClip({ id: 'clip-2', audioBufferId: 'buffer-2' }),
        ]);
    });

    it('exports Podcast RSS MP3 with real audio and Unicode tags to the native file', async () => {
        const real = await vi.importActual<typeof import('../../../useCases/audioBufferToMp3')>(
            '../../../useCases/audioBufferToMp3'
        );
        vi.mocked(audioBufferToMp3).mockImplementationOnce(real.audioBufferToMp3);
        const buffer = MockAudioBuffer.create(2, 44100, 44100);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let index = 0; index < data.length; index++) {
                data[index] = 0.03 * Math.sin((2 * Math.PI * (channel === 0 ? 1000 : 500) * index) / 44100);
            }
        }
        const originalSample = buffer.getChannelData(0)[11]!;
        mocks.renderOffline.mockResolvedValueOnce(buffer);
        const normalize = vi.spyOn(normalizationUseCase, 'normalizeExportBuffer');
        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
            target: { value: 'podcast-rss-mp3' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: 'Episode title' }), { target: { value: 'Épisode 🌊' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Artist' }), { target: { value: 'José' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: '音楽 et voix' } });
        expect(screen.getByRole('spinbutton', { name: 'Target loudness' })).toHaveValue(-16);
        expect(screen.getByText('Stereo (2 channels)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Repeatable' }));
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(1));
        expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
        expect(mocks.renderOffline).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100 }));
        expect(normalize).toHaveBeenCalledWith(
            expect.objectContaining({
                buffer,
                targetLufs: -16,
                ceilingDbTp: -1,
                apply: false,
                measurements: expect.objectContaining({
                    integratedLufs: expect.any(Number),
                    truePeak: expect.any(Number),
                }),
            })
        );
        expect(audioBufferToMp3).toHaveBeenCalledWith(
            expect.objectContaining({ length: buffer.length, gain: expect.any(Number) }),
            192,
            expect.any(Function),
            expect.objectContaining({ mode: 'tpdf', seed: expect.any(Number) }),
            { title: 'Épisode 🌊', artist: 'José', description: '音楽 et voix' }
        );
        expect(buffer.getChannelData(0)[11]).toBe(originalSample);
        const encodedSource = mocks.encodeMp3.mock.calls[0]![0];
        const channels = [0, 1].map((channel) =>
            Float32Array.from(buffer.getChannelData(channel), (sample) => sample * encodedSource.gain)
        );
        expect(measureIntegratedLoudness({ channels, length: buffer.length, sampleRate: 44100 })).toBeCloseTo(-16, 1);
        expect(20 * Math.log10(measureTruePeak({ channels, length: buffer.length }))).toBeLessThanOrEqual(-1);
        const { bytes, format } = mocks.writeNativeAudioMixdownFile.mock.calls[0]![0];
        expect(format).toBe('mp3');
        expect(bytes).toEqual(await vi.mocked(audioBufferToMp3).mock.results[0]!.value);
        expectPodcastBytes(bytes, { title: 'Épisode 🌊', artist: 'José', description: '音楽 et voix' });
        normalize.mockRestore();
    });

    it.each(['picker'] as const)('delivers the real Podcast MP3 bytes through browser %s', async (route) => {
        const real = await vi.importActual<typeof import('../../../useCases/audioBufferToMp3')>(
            '../../../useCases/audioBufferToMp3'
        );
        vi.mocked(audioBufferToMp3).mockImplementationOnce(real.audioBufferToMp3);
        mocks.renderOffline.mockResolvedValueOnce(createPodcastFixture());
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        const write = vi.fn<(bytes: Uint8Array) => Promise<void>>().mockResolvedValue(undefined);
        const close = vi.fn().mockResolvedValue(undefined);
        const abort = vi.fn().mockResolvedValue(undefined);
        if (route === 'picker') {
            vi.stubGlobal(
                'showSaveFilePicker',
                vi.fn().mockResolvedValue({
                    createWritable: () => Promise.resolve({ write, close, abort }),
                })
            );
        } else {
            vi.stubGlobal('showSaveFilePicker', undefined);
        }
        const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:podcast');
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        try {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            selectPodcastEpisode();
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => expect(screen.getByText(/Baking Complete/)).toBeInTheDocument());
            if (route === 'picker') {
                expect(write).toHaveBeenCalledTimes(1);
                expect(write.mock.calls[0]![0]).toEqual(await vi.mocked(audioBufferToMp3).mock.results[0]!.value);
                expectPodcastBytes(write.mock.calls[0]![0], podcastEpisode);
                expect(close).toHaveBeenCalledTimes(1);
                expect(abort).not.toHaveBeenCalled();
                expect(createUrl).not.toHaveBeenCalled();
            } else {
                expect(createUrl).toHaveBeenCalledTimes(1);
                const blob = createUrl.mock.calls[0]![0];
                if (!(blob instanceof Blob)) {
                    throw new Error('Expected downloadable MP3 Blob');
                }
                expect(blob.type).toBe('audio/mpeg');
                const downloadedBytes = new Uint8Array(await blob.arrayBuffer());
                expect(downloadedBytes).toEqual(await vi.mocked(audioBufferToMp3).mock.results[0]!.value);
                expectPodcastBytes(downloadedBytes, podcastEpisode);
                expect(click).toHaveBeenCalledTimes(1);
                expect(write).not.toHaveBeenCalled();
            }
            expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
            expect(mocks.writeNativeAudioMixdownFile).not.toHaveBeenCalled();
        } finally {
            createUrl.mockRestore();
            click.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('keeps individual Podcast overrides and snapshots metadata and loudness before the destination await', async () => {
        const real = await vi.importActual<typeof import('../../../useCases/audioBufferToMp3')>(
            '../../../useCases/audioBufferToMp3'
        );
        vi.mocked(audioBufferToMp3).mockImplementationOnce(real.audioBufferToMp3);
        const buffer = createPodcastFixture(48000);
        mocks.renderOffline.mockResolvedValueOnce(buffer);
        const destination = createDeferred<string>();
        mocks.selectNativeAudioExportFile.mockReturnValueOnce(destination.promise);
        const normalize = vi.spyOn(normalizationUseCase, 'normalizeExportBuffer');
        try {
            const view = render(<ExportDialog open={true} onClose={vi.fn()} />);
            selectPodcastEpisode();
            fireEvent.click(screen.getByRole('button', { name: '48.0k' }));
            fireEvent.click(screen.getByRole('button', { name: '320k' }));
            fireEvent.click(screen.getByRole('button', { name: 'Off', exact: true }));
            fireEvent.change(screen.getByRole('spinbutton', { name: 'Target loudness' }), { target: { value: '-20' } });
            view.rerender(<ExportDialog open={true} onClose={vi.fn()} />);
            expect(screen.getByRole('spinbutton', { name: 'Target loudness' })).toHaveValue(-20);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            expect(mocks.selectNativeAudioExportFile).toHaveBeenCalledTimes(1);
            fireEvent.change(screen.getByRole('textbox', { name: 'Episode title' }), {
                target: { value: 'Later edit' },
            });
            fireEvent.change(screen.getByRole('spinbutton', { name: 'Target loudness' }), { target: { value: '-24' } });
            act(() => destination.resolve('/tmp/podcast-snapshot.mp3'));
            await waitFor(() => expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(1));
            expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
            expect(mocks.renderOffline).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 48000 }));
            expect(normalize).toHaveBeenCalledWith(
                expect.objectContaining({
                    buffer,
                    targetLufs: -20,
                    ceilingDbTp: -1,
                    apply: false,
                    measurements: expect.objectContaining({
                        integratedLufs: expect.any(Number),
                        truePeak: expect.any(Number),
                    }),
                })
            );
            expect(audioBufferToMp3).toHaveBeenCalledWith(
                expect.objectContaining({ length: buffer.length, gain: expect.any(Number) }),
                320,
                expect.any(Function),
                { mode: 'none' },
                podcastEpisode
            );
            expectPodcastBytes(mocks.writeNativeAudioMixdownFile.mock.calls[0]![0].bytes, podcastEpisode);
            expect(
                measureIntegratedLoudness({
                    channels: [0, 1].map((channel) =>
                        Float32Array.from(
                            buffer.getChannelData(channel),
                            (sample) => sample * mocks.encodeMp3.mock.calls[0]![0].gain
                        )
                    ),
                    length: buffer.length,
                    sampleRate: 48000,
                })
            ).toBeCloseTo(-20, 1);
        } finally {
            normalize.mockRestore();
        }
    });

    it('does not tag a non-MP3 override and offers targets for stems but not Render to Clip', async () => {
        render(<ExportDialog open={true} onClose={vi.fn()} />);
        selectPodcastEpisode();
        fireEvent.click(screen.getByTestId('export-format-wav'));
        fireEvent.click(screen.getByTestId('export-format-mp3'));
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(1));
        expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledWith(
            expect.objectContaining({ format: 'wav', bytes: new Uint8Array([1, 2, 3]) })
        );
        expect(audioBufferToMp3).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('export-mode-stems'));
        expect(screen.getByRole('combobox', { name: 'Delivery preset' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /to clip/i }));
        expect(screen.queryByRole('combobox', { name: 'Delivery preset' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Episode title' })).not.toBeInTheDocument();
    });

    it('rejects oversized Unicode metadata before selecting a file, rendering or encoding', async () => {
        render(<ExportDialog open={true} onClose={vi.fn()} />);
        selectPodcastEpisode();
        fireEvent.change(screen.getByRole('textbox', { name: 'Episode title' }), {
            target: { value: '🌊'.repeat(1025) },
        });
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        expect(await screen.findByText('Episode title must be at most 4096 UTF-8 bytes.')).toBeInTheDocument();
        expect(mocks.selectNativeAudioExportFile).not.toHaveBeenCalled();
        expect(mocks.renderOffline).not.toHaveBeenCalled();
        expect(audioBufferToMp3).not.toHaveBeenCalled();
        expect(mocks.writeNativeAudioMixdownFile).not.toHaveBeenCalled();
    });

    it('does not commit a completed real Podcast encoding after cancellation', async () => {
        const real = await vi.importActual<typeof import('../../../useCases/audioBufferToMp3')>(
            '../../../useCases/audioBufferToMp3'
        );
        const encoded = createDeferred<void>();
        const release = createDeferred<void>();
        vi.mocked(audioBufferToMp3).mockImplementationOnce(async (...args) => {
            const bytes = await real.audioBufferToMp3(...args);
            expectPodcastBytes(bytes, podcastEpisode);
            encoded.resolve();
            await release.promise;
            return bytes;
        });
        mocks.renderOffline.mockResolvedValueOnce(createPodcastFixture());
        render(<ExportDialog open={true} onClose={vi.fn()} />);
        selectPodcastEpisode();
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await act(async () => encoded.promise);
        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        act(() => release.resolve());
        await waitFor(() => expect(screen.getByText('Oven turned off.')).toBeInTheDocument());
        expect(mocks.writeNativeAudioMixdownFile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
    });

    it('should restore referenced clip buffers through the AudioEngine owner use case before mixdown export', async () => {
        await startMixdownExport();

        expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext: mocks.audioContext,
            bufferIds: ['buffer-1', 'buffer-2'],
        });
    });

    it('uses the detected project tail for a default mixdown export', async () => {
        mocks.getAutoDetectedTailSeconds.mockReturnValue({
            seconds: 9.25,
            uncappedSeconds: 9.25,
            clamped: false,
        });

        await startMixdownExport();

        expect(screen.getByRole('checkbox', { name: /auto-detect/i })).toBeChecked();
        expect(mocks.renderOffline).toHaveBeenCalledWith(expect.objectContaining({ tailSeconds: 9.25 }));
        expect(mocks.getAutoDetectedTailSeconds).toHaveBeenCalledTimes(2);
    });

    it('re-reads the project snapshot for tail detection after async export preparation', async () => {
        let finishRestore: (() => void) | undefined;
        mocks.restoreCachedAudioBuffersFromIdb.mockImplementation(
            () =>
                new Promise<number>((resolve) => {
                    finishRestore = () => resolve(0);
                })
        );
        mocks.getAutoDetectedTailSeconds.mockImplementation((input: { tracks?: readonly TestTrack[] }) => {
            const isUpdated = input.tracks?.some((track) => track.id === 'late-track') ?? false;
            const seconds = isUpdated ? 11 : 2;
            return { seconds, uncappedSeconds: seconds, clamped: false };
        });

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1));

        setProjectTracks([
            {
                id: 'late-track',
                name: 'Late Track',
                kind: 'audio',
                clips: [createClip({ id: 'late-clip', endBeat: 64 })],
            },
        ]);
        mocks.workspaceStore.value = { soloMode: 'pfl' };
        mocks.automationStore.value = {
            lanes: [{ trackId: 'late-track', parameterId: 'delay-1:delayMix', enabled: true }],
        };
        finishRestore?.();

        await waitFor(() => expect(mocks.renderOffline).toHaveBeenCalledTimes(1));
        expect(mocks.getAutoDetectedTailSeconds).toHaveBeenLastCalledWith(
            expect.objectContaining({
                tracks: mocks.trackStore.value.tracks,
                soloMode: 'pfl',
                automationLanes: mocks.automationStore.value.lanes,
            })
        );
        expect(mocks.renderOffline).toHaveBeenCalledWith(
            expect.objectContaining({ durationBeats: 64, tailSeconds: 11 })
        );
    });

    it('preserves the previous two-second safety floor when detection returns zero', async () => {
        mocks.getAutoDetectedTailSeconds.mockReturnValue({ seconds: 0, uncappedSeconds: 0, clamped: false });

        await startMixdownExport();

        expect(screen.getByText('2.00s minimum (0.00s detected)')).toBeInTheDocument();
        expect(mocks.renderOffline).toHaveBeenCalledWith(expect.objectContaining({ tailSeconds: 2 }));
    });

    it('allows a manual tail up to the declared 60-second limit when auto-detect is disabled', async () => {
        render(<ExportDialog open={true} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /auto-detect/i }));
        fireEvent.change(screen.getByRole('spinbutton', { name: /tail seconds/i }), { target: { value: '60' } });
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.renderOffline).toHaveBeenCalledWith(expect.objectContaining({ tailSeconds: 60 }));
        });
    });

    it('hands Render to Clip the manual tail the render carried', async () => {
        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: /auto-detect/i }));
        fireEvent.change(screen.getByRole('spinbutton', { name: /tail seconds/i }), { target: { value: '7.5' } });

        const renderedTail = await startRenderToClip();

        expect(renderedTail).toBeGreaterThan(0);
        expect(renderToClip).toHaveBeenCalledWith(expect.objectContaining({ tailSeconds: renderedTail }));
    });

    it('hands Render to Clip the auto-detected tail the render carried', async () => {
        mocks.getAutoDetectedTailSeconds.mockReturnValue({ seconds: 9.25, uncappedSeconds: 9.25, clamped: false });
        render(<ExportDialog open={true} onClose={vi.fn()} />);

        const renderedTail = await startRenderToClip();

        expect(renderedTail).toBeGreaterThan(0);
        expect(renderToClip).toHaveBeenCalledWith(expect.objectContaining({ tailSeconds: renderedTail }));
    });

    it('should pass undefined buffer ids when no clips reference audio buffers', async () => {
        setProjectClips([createClip({ id: 'clip-without-buffer' })]);

        await startMixdownExport();

        expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext: mocks.audioContext,
            bufferIds: undefined,
        });
    });

    it('should write two same-named stems to distinct filenames instead of overwriting one (OE-2 wiring guard)', async () => {
        setProjectTracks([
            { id: 'track-bass-a', name: 'Bass', kind: 'audio', clips: [] },
            { id: 'track-bass-b', name: 'Bass', kind: 'audio', clips: [] },
        ]);
        const stemBuffer = MockAudioBuffer.create(2, 128, 44100);
        mocks.exportStems.mockResolvedValue(
            new Map([
                ['track-bass-a', stemBuffer],
                ['track-bass-b', stemBuffer],
            ])
        );

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /slices/i }));
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(2);
        });

        const fileNames = mocks.writeNativeAudioStemFile.mock.calls.map((call) => call[0].fileName);
        // Both stems must land on disk under distinct names — the collision would otherwise
        // overwrite the first 'Bass.wav' with the second.
        expect(new Set(fileNames).size).toBe(2);
        expect(fileNames).toContain('Bass.wav');
    });

    it('writes nothing for the format being encoded, or any later format, when Cancel is pressed during encoding', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav', 'mp3'],
            sampleRate: 44100,
            bitDepth: 24,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });
        const encoding = createDeferred<Uint8Array>();
        mocks.encodeWav.mockReturnValue(encoding.promise);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        await act(async () => {
            encoding.resolve(new Uint8Array([1, 2, 3]));
        });

        // A cancelled export unlocks the dialog after a short readable delay.
        await waitFor(
            () => {
                expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
            },
            { timeout: 4000 }
        );
        expect(mocks.writeNativeAudioMixdownFile).not.toHaveBeenCalled();
        expect(audioBufferToMp3).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
    });

    it('writes no further stem file when Cancel is pressed while a stem is encoding', async () => {
        setProjectTracks([
            { id: 'track-bass', name: 'Bass', kind: 'audio', clips: [] },
            { id: 'track-lead', name: 'Lead', kind: 'audio', clips: [] },
        ]);
        const stemBuffer = MockAudioBuffer.create(2, 128, 44100);
        mocks.exportStems.mockResolvedValue(
            new Map([
                ['track-bass', stemBuffer],
                ['track-lead', stemBuffer],
            ])
        );
        const encoding = createDeferred<Uint8Array>();
        mocks.encodeWav.mockReturnValue(encoding.promise);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /slices/i }));
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        await act(async () => {
            encoding.resolve(new Uint8Array([1, 2, 3]));
        });

        await waitFor(
            () => {
                expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
            },
            { timeout: 4000 }
        );
        expect(mocks.writeNativeAudioStemFile).not.toHaveBeenCalled();
        expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
    });

    it('encodes no later format when Cancel is pressed while an earlier format is being written', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav', 'mp3'],
            sampleRate: 44100,
            bitDepth: 24,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });
        const writing = createDeferred<void>();
        mocks.writeNativeAudioMixdownFile.mockReturnValueOnce(writing.promise);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        await act(async () => {
            writing.resolve();
        });

        await waitFor(
            () => {
                expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
            },
            { timeout: 4000 }
        );
        expect(audioBufferToMp3).not.toHaveBeenCalled();
        expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(1);
    });

    it('aborts the browser save instead of committing it when Cancel is pressed while the file is being opened', async () => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        encodeWavReportingDone();
        const opening = createDeferred<void>();
        const writable = {
            write: vi.fn(() => Promise.resolve()),
            close: vi.fn(() => Promise.resolve()),
            abort: vi.fn(() => Promise.resolve()),
        };
        const createWritable = vi.fn(async () => {
            await opening.promise;
            return writable;
        });
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable }));

        try {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(createWritable).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                opening.resolve();
            });

            await expectCancelledExportState();
            expect(writable.abort).toHaveBeenCalledTimes(1);
            expect(writable.write).not.toHaveBeenCalled();
            expect(writable.close).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
            expect(screen.queryByText(/Baking Complete/)).not.toBeInTheDocument();
        } finally {
            vi.unstubAllGlobals();
            vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
        }
    });

    it('aborts the browser save instead of closing it when Cancel is pressed while the file is being written', async () => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        encodeWavReportingDone();
        const writing = createDeferred<void>();
        const writable = {
            write: vi.fn(() => writing.promise),
            close: vi.fn(() => Promise.resolve()),
            abort: vi.fn(() => Promise.resolve()),
        };
        vi.stubGlobal(
            'showSaveFilePicker',
            vi.fn().mockResolvedValue({ createWritable: vi.fn(() => Promise.resolve(writable)) })
        );

        try {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(writable.write).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                writing.resolve();
            });

            await expectCancelledExportState();
            expect(writable.abort).toHaveBeenCalledTimes(1);
            expect(writable.close).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
            expect(screen.queryByText(/Baking Complete/)).not.toBeInTheDocument();
        } finally {
            vi.unstubAllGlobals();
            vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
        }
    });

    it('ends succeeded, and only succeeded, when Cancel is pressed while the browser save is closing', async () => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        encodeWavReportingDone();
        const closing = createDeferred<void>();
        const writable = {
            write: vi.fn(() => Promise.resolve()),
            close: vi.fn(() => closing.promise),
            abort: vi.fn(() => Promise.resolve()),
        };
        vi.stubGlobal(
            'showSaveFilePicker',
            vi.fn().mockResolvedValue({ createWritable: vi.fn(() => Promise.resolve(writable)) })
        );

        try {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(writable.close).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                closing.resolve();
            });

            await waitFor(() => {
                expect(screen.getByText(/Baking Complete/)).toBeInTheDocument();
            });
            // The file was committed, so the export is finished and nothing re-reports it as cancelled.
            expect(screen.queryByText('Oven turned off.')).not.toBeInTheDocument();
            expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
            expect(screen.getByRole('button', { name: /close bakery/i })).toBeInTheDocument();
            expect(mocks.notifyUser.mock.calls.filter((call) => call[1] === 'success')).toHaveLength(1);
            expect(writable.abort).not.toHaveBeenCalled();
            // Outlast the cancelled-state unlock delay: a reset would land here.
            await new Promise((resolve) => setTimeout(resolve, 1700));
            expect(screen.queryByText('Oven turned off.')).not.toBeInTheDocument();
            expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
        } finally {
            vi.unstubAllGlobals();
            vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
        }
    });

    it('expects no render started and no notification when browser save-picker rejects with AbortError', async () => {
        vi.useFakeTimers();
        try {
            vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
            const abortError = new Error('The user aborted the save dialog.');
            abortError.name = 'AbortError';
            const picker = vi.fn().mockRejectedValue(abortError);
            vi.stubGlobal('showSaveFilePicker', picker);

            try {
                render(<ExportDialog open={true} onClose={vi.fn()} />);
                fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

                // Wait for the picker to be called and drain all timers to completion.
                await act(async () => {
                    await vi.runAllTimersAsync();
                });

                // Verify the picker was called once.
                expect(picker).toHaveBeenCalledTimes(1);

                // No render started, so renderOffline should not have been called.
                expect(mocks.renderOffline).not.toHaveBeenCalled();
                // No notification should be sent.
                expect(mocks.notifyUser).not.toHaveBeenCalled();
                // Dialog should remain ready for a new export.
                expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
            } finally {
                vi.unstubAllGlobals();
                vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    // A native write cannot be recalled: the file lands at the chosen path, so the export succeeded.
    it('ends succeeded when Cancel arrives after native batch commit initiation', async () => {
        encodeWavReportingDone();
        const committing = createDeferred<void>();
        mocks.commit.mockReturnValueOnce(committing.promise);
        render(<ExportDialog open onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        await act(async () => {
            committing.resolve();
        });
        await expectSucceededExportState();
    });

    it('ends cancelled before the native batch commit when Cancel is pressed during the final staging write', async () => {
        encodeWavReportingDone();
        const writing = createDeferred<void>();
        mocks.writeNativeAudioMixdownFile.mockReturnValueOnce(writing.promise);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        await act(async () => {
            writing.resolve();
        });

        await expectCancelledExportState();
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    describe('stem export Cancel during a native write', () => {
        const startTwoStemExport = async (): Promise<void> => {
            encodeWavReportingDone();
            setProjectTracks([
                { id: 'track-bass', name: 'Bass', kind: 'audio', clips: [] },
                { id: 'track-lead', name: 'Lead', kind: 'audio', clips: [] },
            ]);
            const stemBuffer = MockAudioBuffer.create(2, 128, 44100);
            mocks.exportStems.mockResolvedValue(
                new Map([
                    ['track-bass', stemBuffer],
                    ['track-lead', stemBuffer],
                ])
            );
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /slices/i }));
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        };

        it('ends cancelled when it lands during the last staged stem file', async () => {
            const writingLast = createDeferred<void>();
            mocks.writeNativeAudioStemFile.mockResolvedValueOnce(undefined).mockReturnValueOnce(writingLast.promise);
            await startTwoStemExport();
            await waitFor(() => {
                expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(2);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                writingLast.resolve();
            });

            await expectCancelledExportState();
            expect(mocks.commit).not.toHaveBeenCalled();
        });

        // The final file is the last format of the last stem, not the last stem's first format.
        const useWavAndMp3 = (): void => {
            vi.mocked(loadExportSettings).mockReturnValueOnce({
                formats: ['wav', 'mp3'],
                sampleRate: 44100,
                bitDepth: 24,
                mp3BitRate: 128,
                dither: 'random',
                normalization: 'off',
            });
            vi.mocked(audioBufferToMp3).mockResolvedValue(new Uint8Array([4, 5, 6]));
        };

        it('ends cancelled when it lands during the last stem WAV and its MP3 is still to come', async () => {
            useWavAndMp3();
            const writingLastWav = createDeferred<void>();
            mocks.writeNativeAudioStemFile
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockReturnValueOnce(writingLastWav.promise);
            await startTwoStemExport();
            await waitFor(() => {
                expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(3);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                writingLastWav.resolve();
            });

            await expectCancelledExportState();
            // Only the first stem's MP3 was encoded, and the last stem's MP3 was never written.
            expect(audioBufferToMp3).toHaveBeenCalledTimes(1);
            expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(3);
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
        });

        it('ends cancelled when it lands during the last staged stem MP3', async () => {
            useWavAndMp3();
            const writingLastMp3 = createDeferred<void>();
            mocks.writeNativeAudioStemFile
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockReturnValueOnce(writingLastMp3.promise);
            await startTwoStemExport();
            await waitFor(() => {
                expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(4);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                writingLastMp3.resolve();
            });

            await expectCancelledExportState();
            expect(mocks.commit).not.toHaveBeenCalled();
            expect(audioBufferToMp3).toHaveBeenCalledTimes(2);
        });

        it('stops the later stems and ends cancelled when it lands during an earlier stem file', async () => {
            const writingFirst = createDeferred<void>();
            mocks.writeNativeAudioStemFile.mockReturnValueOnce(writingFirst.promise);
            await startTwoStemExport();
            await waitFor(() => {
                expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                writingFirst.resolve();
            });

            await expectCancelledExportState();
            expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
        });
    });

    it('reports a render stopped by the Cancel as cancelled, not as a failed export', async () => {
        const rendering = createDeferred<AudioBuffer>();
        mocks.renderOffline.mockReturnValue(rendering.promise);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
        await act(async () => {
            rendering.reject(new Error('Export cancelled'));
        });

        await expectCancelledExportState();
        expect(screen.queryByText('Export cancelled')).not.toBeInTheDocument();
        expect(screen.queryByText('The bread burned...')).not.toBeInTheDocument();
        expect(mocks.loggerError).not.toHaveBeenCalled();
    });

    describe('a Cancel that has ended the export', () => {
        const stemTracks: TestTrack[] = [
            { id: 'track-bass', name: 'Bass', kind: 'audio', clips: [] },
            { id: 'track-lead', name: 'Lead', kind: 'audio', clips: [] },
        ];

        const startStemExport = (): void => {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /slices/i }));
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        };

        const holdRender = <TValue,>(renderMock: typeof mocks.renderOffline) => {
            const rendering = createDeferred<TValue>();
            renderMock.mockReturnValue(rendering.promise);
            return rendering;
        };

        // The callbacks the dialog really handed the render: a late report goes through these.
        const renderCallbacks = (renderMock: typeof mocks.renderOffline): RenderCallbacks => {
            const renderedWith: RenderCallbacks | undefined = renderMock.mock.calls[0]?.[0];
            const { onProgress, onWarning } = renderedWith ?? {};
            if (!onProgress || !onWarning) {
                throw new TypeError('expected the render to receive onProgress and onWarning');
            }
            return { onProgress, onWarning };
        };

        const cancelRenderInFlight = async <TValue,>(
            renderMock: typeof mocks.renderOffline,
            rendering: ReturnType<typeof createDeferred<TValue>>
        ): Promise<RenderCallbacks> => {
            await waitFor(() => {
                expect(renderMock).toHaveBeenCalledTimes(1);
            });
            const callbacks = renderCallbacks(renderMock);
            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                rendering.reject(new Error('Export cancelled'));
            });
            await waitFor(() => {
                expect(screen.getByText('Oven turned off.')).toBeInTheDocument();
            });
            return callbacks;
        };

        const cancelStemExportWhileRendering = async (): Promise<RenderCallbacks> => {
            setProjectTracks(stemTracks);
            const rendering = holdRender<Map<string, AudioBuffer>>(mocks.exportStems);
            startStemExport();
            return cancelRenderInFlight(mocks.exportStems, rendering);
        };

        const cancelMixdownWhileRendering = async (): Promise<RenderCallbacks> => {
            const rendering = holdRender<AudioBuffer>(mocks.renderOffline);
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            return cancelRenderInFlight(mocks.renderOffline, rendering);
        };

        const cancelClipRenderWhileRendering = async (): Promise<RenderCallbacks> => {
            const rendering = holdRender<AudioBuffer>(mocks.renderOffline);
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /to clip/i }));
            fireEvent.click(screen.getByRole('button', { name: 'Render to Clip' }));
            return cancelRenderInFlight(mocks.renderOffline, rendering);
        };

        const expectCancelledStateHeld = async (startButtonName?: string | RegExp): Promise<void> => {
            expect(screen.getByText('Oven turned off.')).toBeInTheDocument();
            expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
            expect(mocks.loggerWarn).not.toHaveBeenCalledWith('plugin missing');
            await expectCancelledExportState(startButtonName);
        };

        it('keeps the cancelled state when a stem that was past its last checkpoint reports progress', async () => {
            const { onProgress } = await cancelStemExportWhileRendering();

            act(() => {
                onProgress(0.5);
            });

            expect(screen.queryByText('Proofing slices...')).not.toBeInTheDocument();
            await expectCancelledStateHeld();
        });

        it('drops a stem warning reported after the export was cancelled', async () => {
            const { onWarning } = await cancelStemExportWhileRendering();

            act(() => {
                onWarning('plugin missing');
            });

            await expectCancelledStateHeld();
        });

        it('keeps the cancelled state when the mixdown reports progress after the cancel', async () => {
            const { onProgress } = await cancelMixdownWhileRendering();

            act(() => {
                onProgress(0.5);
            });

            expect(screen.queryByText('Proofing whole loaf...')).not.toBeInTheDocument();
            await expectCancelledStateHeld();
        });

        it('drops a mixdown warning reported after the export was cancelled', async () => {
            const { onWarning } = await cancelMixdownWhileRendering();

            act(() => {
                onWarning('plugin missing');
            });

            await expectCancelledStateHeld();
        });

        it('keeps the cancelled state when the clip render reports progress after the cancel', async () => {
            vi.mocked(renderToClip).mockReturnValue({
                trackId: 'track-1',
                clipId: 'clip-new',
                audioBufferId: 'rendered-1',
            });
            const { onProgress } = await cancelClipRenderWhileRendering();

            act(() => {
                onProgress(0.5);
            });

            expect(screen.queryByText('Rendering clip...')).not.toBeInTheDocument();
            await expectCancelledStateHeld('Render to Clip');
        });

        it('drops a clip render warning reported after the export was cancelled', async () => {
            const { onWarning } = await cancelClipRenderWhileRendering();

            act(() => {
                onWarning('plugin missing');
            });

            await expectCancelledStateHeld('Render to Clip');
        });

        it('keeps the progress bar down when an encoder reports progress after the cancel', async () => {
            const encoding = createDeferred<Uint8Array>();
            mocks.encodeWav.mockReturnValue(encoding.promise);
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
            });
            const reportEncoding = mocks.encodeWav.mock.calls[0]?.[2];
            if (!reportEncoding) {
                throw new TypeError('expected encodeWav to receive a progress callback');
            }
            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                encoding.resolve(new Uint8Array([1, 2, 3]));
            });
            await waitFor(() => {
                expect(screen.getByText('Oven turned off.')).toBeInTheDocument();
            });

            act(() => {
                reportEncoding(0.5);
            });

            await expectCancelledStateHeld();
        });

        it('keeps "Oven turned off." when Turn off Oven is pressed again during the unlock delay', async () => {
            await cancelStemExportWhileRendering();

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));

            expect(screen.getByText('Oven turned off.')).toBeInTheDocument();
            expect(screen.queryByText('Cooling down...')).not.toBeInTheDocument();
            await expectCancelledExportState();
        });
    });

    it.each([
        [true, 'mixdown'],
        [false, 'mixdown'],
        [true, 'stems'],
        [false, 'stems'],
    ] as const)('saves no file after a named Faust refusal (native=%s, mode=%s)', async (native, mode) => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(native);
        const message = 'Track "Delay Bus" could not render device "Tape Delay": worklet module unavailable';
        mocks.renderOffline.mockRejectedValue(new Error(message));
        mocks.exportStems.mockRejectedValue(new Error(message));
        const write = vi.fn(async () => {});
        const abort = vi.fn(async () => {});
        const createWritable = vi.fn(async () => ({ write, close: async () => {}, abort }));
        const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
        const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        try {
            if (mode === 'mixdown') {
                await startMixdownExport();
            } else {
                setProjectTracks([{ id: 'delay', name: 'Delay Bus', kind: 'audio', clips: [] }]);
                render(<ExportDialog open={true} onClose={vi.fn()} />);
                fireEvent.click(screen.getByRole('button', { name: /slices/i }));
                fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            }
            await waitFor(() => {
                expect(screen.getByText(message)).toBeInTheDocument();
            });
            expect(mocks.encodeWav).not.toHaveBeenCalled();
            expect(audioBufferToMp3).not.toHaveBeenCalled();
            expect(audioBufferToFlac).not.toHaveBeenCalled();
            expect(mocks.writeNativeAudioMixdownFile).not.toHaveBeenCalled();
            expect(mocks.writeNativeAudioStemFile).not.toHaveBeenCalled();
            expect(createWritable).toHaveBeenCalledTimes(native ? 0 : 1);
            expect(write).not.toHaveBeenCalled();
            expect(abort).toHaveBeenCalledTimes(native ? 0 : 1);
            expect(clickDownload).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
        } finally {
            clickDownload.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('shows the progress and warnings a live mixdown render reports', async () => {
        const rendering = createDeferred<AudioBuffer>();
        mocks.renderOffline.mockReturnValue(rendering.promise);
        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
        });
        const renderedWith: Partial<RenderCallbacks> | undefined = mocks.renderOffline.mock.calls[0]?.[0];
        const { onProgress, onWarning } = renderedWith ?? {};
        if (!onProgress || !onWarning) {
            throw new TypeError('expected renderOffline to receive onProgress and onWarning');
        }

        act(() => {
            onProgress(0.5);
            onWarning('plugin missing');
        });

        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
        expect(screen.getByText('Proofing whole loaf...')).toBeInTheDocument();
        expect(mocks.loggerWarn).toHaveBeenCalledWith('plugin missing');

        await act(async () => {
            rendering.resolve(MockAudioBuffer.create(2, 128, 44100));
        });

        await expectSucceededExportState();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Export warning: plugin missing', 'warning');
    });

    describe('a Cancel pressed while the buffers are still being restored', () => {
        it('starts no mixdown render', async () => {
            const restoring = createDeferred<number>();
            mocks.restoreCachedAudioBuffersFromIdb.mockReturnValue(restoring.promise);
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                restoring.resolve(0);
            });

            await expectCancelledExportState();
            expect(mocks.renderOffline).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
        });

        it('starts no stem export', async () => {
            const restoring = createDeferred<number>();
            mocks.restoreCachedAudioBuffersFromIdb.mockReturnValue(restoring.promise);
            setProjectTracks([
                { id: 'track-bass', name: 'Bass', kind: 'audio', clips: [] },
                { id: 'track-lead', name: 'Lead', kind: 'audio', clips: [] },
            ]);
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /slices/i }));
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                restoring.resolve(0);
            });

            await expectCancelledExportState();
            expect(mocks.exportStems).not.toHaveBeenCalled();
            expect(mocks.writeNativeAudioStemFile).not.toHaveBeenCalled();
        });
    });

    it('reports a failed browser save as an error even when Cancel was pressed while it was closing', async () => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        encodeWavReportingDone();
        const closing = createDeferred<void>();
        const writable = {
            write: vi.fn(() => Promise.resolve()),
            close: vi.fn(() => closing.promise),
            abort: vi.fn(() => Promise.resolve()),
        };
        vi.stubGlobal(
            'showSaveFilePicker',
            vi.fn().mockResolvedValue({ createWritable: vi.fn(() => Promise.resolve(writable)) })
        );

        try {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => {
                expect(writable.close).toHaveBeenCalledTimes(1);
            });

            fireEvent.click(screen.getByRole('button', { name: /turn off oven/i }));
            await act(async () => {
                closing.reject(new Error('Disk full'));
            });

            await waitFor(() => {
                expect(screen.getByText('Disk full')).toBeInTheDocument();
            });
            expect(mocks.loggerError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Export failed' }));
            expect(screen.queryByText('Oven turned off.')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /close bakery/i })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
            expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
        } finally {
            vi.unstubAllGlobals();
            vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
        }
    });

    it('still writes every format when no Cancel is pressed', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav', 'mp3'],
            sampleRate: 44100,
            bitDepth: 24,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });
        vi.mocked(audioBufferToMp3).mockResolvedValue(new Uint8Array([4, 5, 6]));

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledTimes(2);
        });
        expect(mocks.writeNativeAudioMixdownFile.mock.calls.map((call) => call[0].format)).toEqual(['wav', 'mp3']);
    });

    it('should stop offering 32-bit once FLAC is selected instead of downgrading it (OE-8)', () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav', 'flac'],
            sampleRate: 44100,
            bitDepth: 32,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });

        render(<ExportDialog open={true} onClose={vi.fn()} />);

        expect(screen.queryByRole('button', { name: '32-bit' })).toBeNull();
        expect(screen.getByRole('button', { name: '24-bit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '16-bit' })).toBeInTheDocument();
    });

    it('should encode FLAC at the selected bit depth rather than a hardcoded 16 (OE-8)', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['flac'],
            sampleRate: 44100,
            bitDepth: 24,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });
        vi.mocked(audioBufferToFlac).mockResolvedValue(new Uint8Array([7, 7, 7]));
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.flac');

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(audioBufferToFlac).toHaveBeenCalledTimes(1);
        });
        expect(vi.mocked(audioBufferToFlac).mock.calls[0]![1]).toBe(24);
    });

    it('should hand the encoder a seeded dither when repeatable export is selected', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav'],
            sampleRate: 44100,
            bitDepth: 16,
            mp3BitRate: 128,
            dither: 'seeded',
            normalization: 'off',
        });
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.wav');

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
        });
        // Without a seed reaching the encoder the export still succeeds, it is
        // just irreproducible — so the seed itself is the assertion.
        const ditherArgument = mocks.encodeWav.mock.calls[0]![3] as { mode: string; seed?: number };
        expect(ditherArgument.mode).toBe('tpdf');
        expect(typeof ditherArgument.seed).toBe('number');
    });

    it('should hand the encoder an off-dither setting for a bit-exact bounce', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav'],
            sampleRate: 44100,
            bitDepth: 16,
            mp3BitRate: 128,
            dither: 'none',
            normalization: 'off',
        });
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.wav');

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
        });
        expect(mocks.encodeWav.mock.calls[0]![3]).toEqual({ mode: 'none' });
    });

    it('should normalize the exported audio to the loudness target when R128 is selected', async () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav'],
            sampleRate: 44100,
            bitDepth: 24,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'r128',
        });

        // One second of a -20 dBFS 1 kHz tone: long enough for the gating
        // blocks, and a known loudness to correct from.
        const buffer = MockAudioBuffer.create(2, 44100, 44100);
        const amplitude = 10 ** (-20 / 20);
        for (let channel = 0; channel < 2; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let index = 0; index < samples.length; index++) {
                samples[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / 44100);
            }
        }
        mocks.renderOffline.mockResolvedValue(buffer);
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.wav');

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
        });

        let encodedPeak = 0;
        const encodedChannel = buffer.getChannelData(0);
        for (const sample of encodedChannel) {
            encodedPeak = Math.max(
                encodedPeak,
                Math.abs(sample * Reflect.get(mocks.encodeWav.mock.calls[0]![0], 'gain'))
            );
        }

        // -20 LUFS raised to the -14 LUFS target is +6 dB, so the -20 dBFS tone
        // should now peak near -14 dBFS. The true-peak ceiling is -1 dBTP and is
        // nowhere near binding here.
        expect(20 * Math.log10(encodedPeak)).toBeCloseTo(-14, 1);
    });

    it('should leave the exported audio at its authored level when normalization is off', async () => {
        const buffer = MockAudioBuffer.create(2, 44100, 44100);
        const amplitude = 10 ** (-20 / 20);
        for (let channel = 0; channel < 2; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let index = 0; index < samples.length; index++) {
                samples[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / 44100);
            }
        }
        mocks.renderOffline.mockResolvedValue(buffer);
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.wav');

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(mocks.encodeWav).toHaveBeenCalledTimes(1);
        });

        let encodedPeak = 0;
        for (const sample of buffer.getChannelData(0)) {
            encodedPeak = Math.max(encodedPeak, Math.abs(sample));
        }

        // Default is 'off': the mix keeps the level it was authored at.
        expect(20 * Math.log10(encodedPeak)).toBeCloseTo(-20, 1);
    });

    it('should stop offering 32-bit when FLAC is toggled on while 32-bit is chosen (OE-8)', () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav'],
            sampleRate: 44100,
            bitDepth: 32,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: '32-bit' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: /flac/i }));

        expect(screen.queryByRole('button', { name: '32-bit' })).toBeNull();
        expect(screen.getByRole('button', { name: '24-bit' })).toBeInTheDocument();
    });

    it('should keep the stored 32-bit preference intact across a FLAC toggle on and off (OE-8)', () => {
        vi.mocked(loadExportSettings).mockReturnValueOnce({
            formats: ['wav'],
            sampleRate: 44100,
            bitDepth: 32,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });

        render(<ExportDialog open={true} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /flac/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /flac/i }));

        // Withdrawing an option while FLAC is on must not rewrite what the user
        // chose: unchecking FLAC has to restore 32-bit, in the UI and on disk.
        expect(screen.getByRole('button', { name: '32-bit' })).toBeInTheDocument();
        const persistedDepths = vi.mocked(saveExportSettings).mock.calls.map((call) => call[0].bitDepth);
        expect(persistedDepths).toEqual([32, 32]);
    });

    it('renders one advisory per Toaster pattern the selector reports and keeps Start enabled', () => {
        mocks.listToasterPatternsOutsideArrangement.mockReturnValue([
            { trackId: 'track-1', trackName: 'Drums', deviceName: 'Toaster' },
        ]);

        render(<ExportDialog open={true} onClose={vi.fn()} />);

        expect(
            screen.getByText(
                'Toaster "Toaster" on "Drums" has a sequencer pattern that is not in the arrangement. Use To timeline on the device to include it in the export.'
            )
        ).toBeInTheDocument();
        // Non-blocking: the advisory never disables Start.
        expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
    });

    it('renders no advisory when the selector reports no pattern outside the arrangement', () => {
        mocks.listToasterPatternsOutsideArrangement.mockReturnValue([]);

        render(<ExportDialog open={true} onClose={vi.fn()} />);

        expect(screen.queryByText(/has a sequencer pattern that is not in the arrangement/i)).not.toBeInTheDocument();
    });

    it('starts fresh on reopen after a completed export so a second bake is possible', async () => {
        // AppShell keeps the dialog mounted and toggles only `open`; the rerender
        // pair below reproduces exactly that close-then-reopen sequence.
        const view = render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(screen.getByText(/Ding! Baking Complete/)).toBeInTheDocument();
        });

        view.rerender(<ExportDialog open={false} onClose={vi.fn()} />);
        view.rerender(<ExportDialog open={true} onClose={vi.fn()} />);

        expect(screen.queryByText(/Ding! Baking Complete/)).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /close bakery/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
    });

    it('does not let a completed export auto-close a dialog reopened within the timer window', async () => {
        // The success auto-close timer is armed by the finishing export; closing
        // and reopening inside its window starts a new session, and the stale
        // timer must not fire onClose against that fresh session.
        const onClose = vi.fn();
        const view = render(<ExportDialog open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(screen.getByText(/Ding! Baking Complete/)).toBeInTheDocument();
        });

        view.rerender(<ExportDialog open={false} onClose={onClose} />);
        view.rerender(<ExportDialog open={true} onClose={onClose} />);

        await new Promise((resolve) => {
            setTimeout(resolve, 2600);
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('starts fresh on reopen after a failed export so no stale error remains', async () => {
        mocks.writeNativeAudioMixdownFile.mockRejectedValueOnce(new Error('disk full'));
        const view = render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(screen.getByText('disk full')).toBeInTheDocument();
        });

        view.rerender(<ExportDialog open={false} onClose={vi.fn()} />);
        view.rerender(<ExportDialog open={true} onClose={vi.fn()} />);

        expect(screen.queryByText('disk full')).not.toBeInTheDocument();
        expect(screen.queryByText('The bread burned...')).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
    });

    it('renders the failure status beside the error when an export fails', async () => {
        mocks.writeNativeAudioMixdownFile.mockRejectedValueOnce(new Error('disk full'));

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(screen.getByText('The bread burned...')).toBeInTheDocument();
        });
        expect(screen.getByText('disk full')).toBeInTheDocument();
    });

    it('grows the oven status slot for a long failure message instead of clipping it', async () => {
        // Native write failures carry the command plus the full output path, so
        // the message wraps to several lines inside the slot. jsdom cannot
        // measure wrapping, so the observable is the slot's class: min-height
        // (free to grow) in the failure state instead of the fixed height that
        // clipped the message's bottom.
        mocks.writeNativeAudioMixdownFile.mockRejectedValueOnce(
            new Error(
                'Bake failed: sourdaw-mixdown exited 1 while writing "/Users/musician/Bounces/My Song (final mix) 2026-10-07.wav"'
            )
        );

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        const errorNode = await screen.findByText(/Bake failed:/);
        expect(errorNode).toBeInTheDocument();
        expect(errorNode.closest('.min-h-10')).not.toBeNull();
        expect(errorNode.closest('.h-10')).toBeNull();
    });

    it('keeps the fixed oven status slot for the ready layout', () => {
        render(<ExportDialog open={true} onClose={vi.fn()} />);

        expect(screen.getByText(/Oven Ready/).closest('.h-10')).not.toBeNull();
    });

    it('keeps the fixed oven status slot during a retry flight after a failed export', async () => {
        mocks.writeNativeAudioMixdownFile.mockRejectedValueOnce(new Error('disk full'));
        render(<ExportDialog open={true} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(screen.getByText('disk full')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        const bar = await screen.findByRole('progressbar');
        expect(bar.closest('.h-10')).not.toBeNull();
    });

    it('stops before rendering and surfaces an error when native destination selection fails', async () => {
        mocks.selectNativeAudioExportFile.mockRejectedValue(new Error('Permission denied'));

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

        await waitFor(() => {
            expect(screen.getByText('Permission denied')).toBeInTheDocument();
        });
        expect(mocks.renderOffline).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Permission denied', 'error');
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
        expect(screen.queryByText(/Ding! Baking Complete/)).not.toBeInTheDocument();
    });

    it('reports a browser picker failure visibly before restoring or rendering any audio', async () => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new Error('Save picker failed')));
        const createObjectURL = vi.spyOn(URL, 'createObjectURL');
        try {
            render(<ExportDialog open onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
            await waitFor(() => expect(screen.getByText('Save picker failed')).toBeInTheDocument());
            expect(mocks.renderOffline).not.toHaveBeenCalled();
            expect(mocks.restoreCachedAudioBuffersFromIdb).not.toHaveBeenCalled();
            expect(createObjectURL).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledWith('Save picker failed', 'error');
        } finally {
            createObjectURL.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('stops before rendering when destination selection is aborted', async () => {
        const abortError = new Error('The user aborted a request.');
        abortError.name = 'AbortError';
        let rejectSelection: (error: Error) => void = () => {
            throw new Error('Destination selection was not started');
        };
        const selection = new Promise<string | null>((_resolve, reject) => {
            rejectSelection = reject;
        });
        mocks.selectNativeAudioExportFile.mockReturnValue(selection);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.selectNativeAudioExportFile).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
            rejectSelection(abortError);
        });

        expect(mocks.renderOffline).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(screen.queryByText('The user aborted a request.')).not.toBeInTheDocument();
        expect(screen.queryByText('The bread burned...')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
    });

    it('stops before rendering when native destination selection is cancelled', async () => {
        let resolveSelection: (path: string | null) => void = () => {
            throw new Error('Destination selection was not started');
        };
        const selection = new Promise<string | null>((resolve) => {
            resolveSelection = resolve;
        });
        mocks.selectNativeAudioExportFile.mockReturnValue(selection);

        render(<ExportDialog open={true} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start baking/i }));
        await waitFor(() => {
            expect(mocks.selectNativeAudioExportFile).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
            resolveSelection(null);
        });

        expect(mocks.renderOffline).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(screen.queryByText('The bread burned...')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
    });

    describe('independent delivery target controls', () => {
        it('exposes all five families and preserves edits when switching, adding, removing and rerendering', () => {
            const view = render(<ExportDialog open onClose={() => {}} />);
            const names = [
                'Spotify stereo master',
                'Apple Music stereo master',
                'YouTube audio master for video',
                'Podcast RSS MP3',
                'Game Audio PCM',
            ];
            for (const name of names)
                expect(screen.getByRole('checkbox', { name: 'Export ' + name })).toBeInTheDocument();
            fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
                target: { value: 'podcast-rss-mp3' },
            });
            fireEvent.click(screen.getByRole('button', { name: '48.0k' }));
            fireEvent.change(screen.getByRole('spinbutton', { name: 'Target loudness' }), { target: { value: '-20' } });
            fireEvent.click(screen.getByRole('checkbox', { name: 'Export Game Audio PCM' }));
            fireEvent.change(screen.getByRole('combobox', { name: 'Output channels' }), { target: { value: '1' } });
            fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
                target: { value: 'podcast-rss-mp3' },
            });
            expect(screen.getByRole('button', { name: '48.0k' })).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByRole('spinbutton', { name: 'Target loudness' })).toHaveValue(-20);
            view.rerender(<ExportDialog open onClose={() => {}} />);
            fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
                target: { value: 'game-audio-pcm' },
            });
            expect(screen.getByRole('combobox', { name: 'Output channels' })).toHaveValue('1');
            fireEvent.click(screen.getByRole('button', { name: 'Reset this target' }));
            expect(screen.getByRole('combobox', { name: 'Output channels' })).toHaveValue('2');
            fireEvent.click(screen.getByRole('checkbox', { name: 'Export Game Audio PCM' }));
            expect(screen.getByRole('checkbox', { name: 'Export Podcast RSS MP3' })).toBeChecked();
        });
        it('captures all target overrides before the directory await and renders only once at their maximum rate', async () => {
            const destination = createDeferred<string>();
            mocks.selectNativeAudioExportDirectory.mockReturnValueOnce(destination.promise);
            mocks.renderOffline.mockResolvedValueOnce(createPodcastFixture(48000));
            render(<ExportDialog open onClose={() => {}} />);
            fireEvent.click(screen.getByRole('checkbox', { name: 'Export YouTube audio master for video' }));
            fireEvent.click(screen.getByRole('checkbox', { name: 'Export Game Audio PCM' }));
            fireEvent.change(screen.getByRole('combobox', { name: 'Output channels' }), { target: { value: '1' } });
            fireEvent.click(screen.getByRole('button', { name: '44.1k' }));
            fireEvent.click(screen.getByTestId('export-start'));
            expect(mocks.selectNativeAudioExportDirectory).toHaveBeenCalledTimes(1);
            expect(mocks.selectNativeAudioExportFile).not.toHaveBeenCalled();
            // Controls still edit the next draft while the destination chooser owns its await.
            fireEvent.change(screen.getByRole('combobox', { name: 'Output channels' }), { target: { value: '2' } });
            fireEvent.click(screen.getByRole('button', { name: '96.0k' }));
            act(() => destination.resolve('/tmp/multi-target'));
            await waitFor(() => expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledTimes(2));
            expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
            expect(mocks.renderOffline).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 48000 }));
            const game = mocks.encodeWav.mock.calls[1]![0];
            expect(game).toMatchObject({ sampleRate: 44100, numberOfChannels: 1, length: 44100 });
            const names = mocks.writeNativeAudioStemFile.mock.calls.map((call) => call[0].fileName);
            expect(names[0]).toMatch(/__youtube-audio-master\.wav$/);
            expect(names[1]).toMatch(/__game-audio-pcm\.wav$/);
        });
        it('refuses an unresolved source rate and the known LAME96 stereo rate change before storage or render', async () => {
            mocks.getAudioContext.mockReturnValue(null);
            render(<ExportDialog open onClose={() => {}} />);
            fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
                target: { value: 'spotify-stereo-master' },
            });
            fireEvent.click(screen.getByTestId('export-start'));
            expect(await screen.findByText(/source sample rate/i)).toBeInTheDocument();
            expect(mocks.selectNativeAudioExportFile).not.toHaveBeenCalled();
            fireEvent.change(screen.getByRole('combobox', { name: 'Delivery preset' }), {
                target: { value: 'custom' },
            });
            selectPodcastEpisode();
            fireEvent.click(screen.getByRole('button', { name: '96k' }));
            fireEvent.click(screen.getByTestId('export-start'));
            expect(await screen.findByText(/96.*stereo/i)).toBeInTheDocument();
            expect(mocks.selectNativeAudioExportFile).not.toHaveBeenCalled();
            expect(mocks.selectNativeAudioExportDirectory).not.toHaveBeenCalled();
            expect(mocks.renderOffline).not.toHaveBeenCalled();
        });
    });
});
