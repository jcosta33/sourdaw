import { type ReactNode } from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';

import { audioBufferToFlac } from '../../../useCases/audioBufferToFlac';
import { audioBufferToMp3 } from '../../../useCases/audioBufferToMp3';
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
    writeNativeAudioMixdownFile: ReturnType<typeof vi.fn>;
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
    stopTrackInputMonitoring: vi.fn(),

    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    cancelExport: vi.fn(),
    exportStems: mocks.exportStems,
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

vi.mock('../../../useCases/audioBufferToWav', () => ({
    audioBufferToWav: mocks.encodeWav,
}));

vi.mock('../../../useCases/audioBufferToMp3', () => ({
    audioBufferToMp3: vi.fn(),
}));

vi.mock('../../../useCases/audioBufferToFlac', () => ({
    audioBufferToFlac: vi.fn(),
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

function createDeferred<TValue>(): { promise: Promise<TValue>; resolve: (value: TValue) => void } {
    let settle: (value: TValue) => void = () => {
        throw new Error('Deferred was not initialised');
    };
    const promise = new Promise<TValue>((resolve) => {
        settle = resolve;
    });
    return { promise, resolve: settle };
}

/** A WAV encoder that finishes its pass: real encoders end by reporting progress 1. */
function encodeWavReportingDone(): void {
    mocks.encodeWav.mockImplementation((_buffer, _depth, onProgress) => {
        onProgress?.(1);
        return Promise.resolve(new Uint8Array([1, 2, 3]));
    });
}

/** A cancelled export reads cancelled, never finished, and hands the dialog back for a new export. */
async function expectCancelledExportState(): Promise<void> {
    await waitFor(() => {
        expect(screen.getByText('Oven turned off.')).toBeInTheDocument();
    });
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100);
    await waitFor(
        () => {
            expect(screen.getByRole('button', { name: /start baking/i })).toBeEnabled();
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

    it('ends cancelled, not finished, when Cancel is pressed while the last format is being written', async () => {
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
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'success');
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
            encodedPeak = Math.max(encodedPeak, Math.abs(sample));
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

    it('falls through to the download link when the browser save picker fails', async () => {
        vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(false);
        const pickerError = new Error('Save picker failed');
        const showSaveFilePicker = vi.fn().mockRejectedValue(pickerError);
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sourdaw-export');
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        try {
            render(<ExportDialog open={true} onClose={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

            await waitFor(() => {
                expect(document.querySelector('a[download$=".wav"]')).toBeInstanceOf(HTMLAnchorElement);
            });

            expect(document.querySelector('a[download$=".wav"]')).toHaveAttribute(
                'download',
                expect.stringMatching(/^Sourdaw_Bake_\d+\.wav$/)
            );
            expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
            expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
            expect(mocks.selectNativeAudioExportFile).not.toHaveBeenCalled();
            expect(clickDownload).toHaveBeenCalledTimes(1);
            expect(screen.queryByText('Save picker failed')).not.toBeInTheDocument();
            expect(screen.queryByText('The bread burned...')).not.toBeInTheDocument();
            expect(mocks.notifyUser).not.toHaveBeenCalledWith('Save picker failed', 'error');
            expect(createObjectURL).toHaveBeenCalledTimes(1);
            expect(revokeObjectURL).not.toHaveBeenCalled();
        } finally {
            clickDownload.mockRestore();
            createObjectURL.mockRestore();
            revokeObjectURL.mockRestore();
            vi.unstubAllGlobals();
            vi.mocked(isNativeProjectRuntimeAvailable).mockReturnValue(true);
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
});
