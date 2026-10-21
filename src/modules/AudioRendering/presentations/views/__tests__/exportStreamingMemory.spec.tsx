import { type ReactNode } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { type Track } from '#/modules/Arrangement/stores';
import {
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
} from '#/modules/AudioEngine/useCases';
import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';
import { unzipSync } from 'fflate';

import { ExportDialog } from '../ExportDialog';
import { loadExportSettings } from '../exportSettings';

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
                throw new Error('Expected options');
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

const zipAllocation = vi.hoisted(() => ({ observe: (_bytes: Uint8Array) => {} }));
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
        },
    };
});

const ownership = vi.hoisted(() => ({ rendered: 0, consumed: 0, peakRetained: 0 }));
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
        stemRender.frames = 44100;
        mocks.trackStore.value = { tracks: stemRender.tracks, selectedTrackId: null, ghostClips: [] };
        vi.clearAllMocks();
        const audioContext = createMockAudioContext();
        audioContext.sampleRate = 44100;
        mocks.audioContext = asBaseAudioContext(audioContext);
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
                return {
                    ...context,
                    sampleRate: 44100,
                    suspend: undefined,
                    resume: undefined,
                    async startRendering() {
                        ownership.rendered++;
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
    it('consumes two reported WAV targets before releasing each of64 rendered stems', async () => {
        const chunks: Uint8Array[] = [];
        let closed = false;
        let releaseFirstWrite: () => void = () => {};
        let signalFirstWrite: () => void = () => {};
        const firstWriteStarted = new Promise<void>((resolve) => {
            signalFirstWrite = resolve;
        });
        const firstWriteDrain = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let firstWrite = true;
        vi.stubGlobal('showSaveFilePicker', async () => ({
            createWritable: async () => ({
                write: async (bytes: Uint8Array) => {
                    if (firstWrite) {
                        firstWrite = false;
                        signalFirstWrite();
                        await firstWriteDrain;
                    }
                    chunks.push(bytes.slice());
                },
                close: async () => {
                    closed = true;
                },
                abort: async () => {},
            }),
        }));
        try {
            render(<ExportDialog open onClose={() => {}} />);
            fireEvent.click(screen.getByTestId('export-mode-stems'));
            fireEvent.click(screen.getByRole('checkbox', { name: 'Export Apple Music stereo master' }));
            fireEvent.click(screen.getByRole('checkbox', { name: 'Export Game Audio PCM' }));
            fireEvent.change(screen.getByRole('combobox', { name: 'Output channels' }), { target: { value: '1' } });
            fireEvent.click(screen.getByRole('button', { name: 'Off', exact: true }));
            fireEvent.click(screen.getByRole('checkbox', { name: 'Include WAV loudness reports' }));
            fireEvent.click(screen.getByTestId('export-start'));
            await firstWriteStarted;
            expect(ownership.rendered).toBe(1);
            releaseFirstWrite();
            await waitFor(() => expect(closed).toBe(true), { timeout: 60000 });
            expect(ownership.rendered).toBe(64);
            expect(ownership.consumed).toBe(64);
            expect(ownership.peakRetained).toBe(1);
            const archive = new Uint8Array(chunks.reduce((sum, b) => sum + b.length, 0));
            let offset = 0;
            for (const b of chunks) {
                archive.set(b, offset);
                offset += b.length;
            }
            const entries = unzipSync(archive);
            expect(Object.keys(entries)).toHaveLength(256);
            for (const [name, bytes] of Object.entries(entries)) {
                if (name.endsWith('.loudness.json')) {
                    const report = JSON.parse(new TextDecoder().decode(bytes));
                    expect(report.audioFile).toBe(name.slice(0, -'.loudness.json'.length));
                    expect(report.measurementBasis).toBe('decoded-WAV-bytes');
                    expect(report.publicationAttested).toBe(false);
                    continue;
                }
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                if (name.endsWith('__game-audio-pcm.wav')) {
                    expect(view.getUint32(24, true)).toBe(48000);
                    expect(view.getUint16(22, true)).toBe(1);
                    expect(bytes.length).toBe(44 + 48000 * 3);
                    expect(bytes.subarray(44).every((b) => b === 0)).toBe(true);
                } else {
                    expect(name).toMatch(/__apple-music-stereo-master\.wav$/);
                    expect(view.getUint32(24, true)).toBe(44100);
                    expect(view.getUint16(22, true)).toBe(2);
                }
            }
        } finally {
            vi.unstubAllGlobals();
        }
    }, 65000);
    it('observes sampled output ownership below 2B across 64 WAV/MP3/FLAC stems', async () => {
        const gc: unknown = Reflect.get(globalThis, 'gc');
        if (typeof gc !== 'function') {
            throw new Error('Run this ownership probe with node --expose-gc.');
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
        const allocations: WeakRef<ArrayBufferLike>[] = [];
        const track = (buffer: ArrayBufferLike) => {
            if (!observed.has(buffer)) {
                observed.add(buffer);
                allocations.push(new WeakRef(buffer));
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
                                track(value.buffer);
                            } else if (value instanceof ArrayBuffer) {
                                track(value);
                            }
                        }
                        return value;
                    },
                })
            );
        }
        zipAllocation.observe = (bytes) => {
            if (collecting) {
                track(bytes.buffer);
            }
        };
        let closed = false;
        let writes = 0;
        let samples = 0;
        let resolveFinished: () => void = () => {};
        let rejectFinished: (reason: unknown) => void = () => {};
        const finished = new Promise<void>((resolve, reject) => {
            resolveFinished = resolve;
            rejectFinished = reject;
        });
        vi.stubGlobal('showSaveFilePicker', async () => ({
            createWritable: async () => ({
                write: async (bytes: Uint8Array) => {
                    track(bytes.buffer);
                    writes++;
                    // Sample at fixed ownership checkpoints. Full collections for every small MPEG
                    // packet dominated the test itself; each checkpoint still includes every observed buffer.
                    if (writes % 32 !== 1) {
                        return;
                    }
                    samples++;
                    // WeakRef targets are kept alive for the job that observed them. Advance a real
                    // turn before GC; no fixed microtask count stands in for collection completion.
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                    gc();
                    let live = 0;
                    for (const reference of allocations) {
                        live += reference.deref()?.byteLength ?? 0;
                    }
                    peak = Math.max(peak, live);
                    expect(live).toBeLessThanOrEqual(2 * b);
                },
                close: async () => {
                    closed = true;
                    resolveFinished();
                },
                abort: async () => {
                    rejectFinished(
                        mocks.loggerError.mock.calls.at(-1)?.[0] ?? new Error('Streaming export aborted before commit.')
                    );
                },
            }),
        }));
        try {
            render(<ExportDialog open onClose={() => {}} />);
            fireEvent.click(screen.getByTestId('export-mode-stems'));
            fireEvent.click(screen.getByTestId('export-start'));
            await finished;
            expect(closed).toBe(true);
            expect(ownership.rendered).toBe(64);
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
            collecting = false;
            zipAllocation.observe = () => {};
            vi.unstubAllGlobals();
        }
    }, 120000);
});
