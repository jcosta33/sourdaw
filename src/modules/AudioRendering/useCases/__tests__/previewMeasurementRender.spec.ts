import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureOfflineDeviceSetup, prepareOfflineDeviceSetup } from '#/app/prepareOfflineDeviceSetup';
import { projectNativeDeviceState } from '#/app/projectNativeDeviceState';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { compareAgentScopeMeasurements, measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import {
    configureAudioDeviceRuntimeSink,
    configureOfflineYeastMidiProcessing,
    type captureOfflineRenderInput,
    type renderTrackSubgraphOffline,
} from '#/modules/AudioEngine/useCases';
import {
    captureProjectRevision,
    createCommandPreviewWorkspace,
    createCrdtDoc,
    DOC_PREFIX_ROOT,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    createDefaultGrandBouleState,
    createGrandBouleStore,
    resetGrandBouleStores,
} from '#/modules/GrandBoule/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    holdsKeyedYeastRack,
    holdsLegacyYeastRack,
    LEGACY_SHARED_RACK_DEVICE_ID,
    readStoredYeastRack,
    readYeastRack,
    yeastDeviceIdsInProjectOrder,
    yeastStore,
    type YeastProcessorInfo,
} from '#/modules/Yeast/stores';

import { clearAgentMeasurementArtifacts } from '../clearAgentMeasurementArtifacts';
import { getAgentMeasurementArtifacts } from '../getAgentMeasurementArtifacts';
import { renderAgentPreviewMeasurementScope } from '../renderAgentPreviewMeasurementScope';

// Only the engine's render boundary is replaced; capture, target resolution,
// revision checks and the preview workspace are the real ones.
const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: engine.renderOffline,
    renderOfflineInput: engine.renderOfflineInput,
    renderTrackSubgraphOffline: engine.renderTrackSubgraphOffline,
}));

type CapturedRenderInput = ReturnType<typeof captureOfflineRenderInput>;
type SubgraphRequest = Parameters<typeof renderTrackSubgraphOffline>[0];
type Workspace = ReturnType<typeof createCommandPreviewWorkspace>;
type Preview = { sourceRevision: string; workspace: Workspace };

const SAMPLE_RATE = 48_000;
const LIVE_GAIN = 0.8;
const LIVE_TEMPO = 120;
const VOCAL = { kind: 'tracks', ids: ['vocal'] } as const;
const MASTER = { kind: 'master' } as const;
const KEYS_A = { kind: 'tracks', ids: ['keys-a'] } as const;
const KEYS = { kind: 'tracks', ids: ['keys'] } as const;
const CEILINGS = { measuredSeconds: 300, renderedSeconds: 600 };
const GLUTEN: Track['devices'][number] = {
    id: 'gluten-1',
    name: 'Gluten',
    type: 'gluten',
    bypassed: false,
    parameterValues: { threshold: -18, ratio: 4 },
};
const PLUGIN: Track['devices'][number] = {
    id: 'plugin-1',
    name: 'Hosted Plugin',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalPluginId: 'com.example.plugin',
    externalInstanceId: 'instance-1',
};
const GRAND_BOULE_ID = 'grand-boule-1';
const ARPEGGIATOR: YeastProcessorInfo = { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false };
const CHORD: YeastProcessorInfo = { id: 'chord-1', type: 'chord', name: 'Chord Generator', bypassed: false };

type PostedMessage = { type: string; name?: string; value?: number; index?: number };

/** A Grand Boule state chunk voiced at `temperament` and `hammerHardness`, on the default morph. */
function grandBouleChunk(temperament: number, hammerHardness: number) {
    const { morph } = createDefaultGrandBouleState();
    return {
        version: 1,
        data: { ...morph, temperament, hammerHardness, velocityCurve: 1, stereoWidth: 0.6, toneTilt: 0 },
    };
}

function grandBoule(id: string, deviceState: ReturnType<typeof grandBouleChunk>): Track['devices'][number] {
    return { id, name: 'Grand Boule', type: 'grand-boule', bypassed: false, parameterValues: {}, deviceState };
}

function pianoTrack(device: Track['devices'][number]): Track {
    return { ...createTrack({ id: 'piano', name: 'Piano', kind: 'midi' }), devices: [device] };
}

function yeastTrack(trackId: string, deviceId: string): Track {
    return {
        ...createTrack({ id: trackId, name: trackId, kind: 'midi' }),
        devices: [{ id: deviceId, name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }],
    };
}

function keysTrack(): Track {
    return yeastTrack('keys', 'yeast-1');
}

/** A project-wide v1 Yeast slot: one rack keyed by no device, adopted by the first Yeast device. */
function seedLegacyRackSlot(): void {
    seedYeastSlot({ schemaVersion: 1, processors: storedRack('arp-legacy').processors });
}

/** One rack as the Yeast slot stores it, holding a single arpeggiator. */
function storedRack(processorId: string) {
    return {
        schemaVersion: 1,
        processors: { [processorId]: { deleted: false, value: { ...ARPEGGIATOR, id: processorId } } },
    };
}

/** Writes the Yeast slot into the live document and decodes it, as opening a saved project does. */
function seedYeastSlot(slot: Record<string, unknown>): void {
    mutateCrdtDoc<Record<string, unknown>>({
        id: DOC_PREFIX_ROOT,
        changeFn: (draft) => {
            draft.yeast = slot;
        },
    });
    yeastStore.hydrate();
}

/** The offline device wiring `src/app/bootstrap.ts` installs, so device setup runs as it does in the app. */
function installAppDeviceSink(): void {
    configureAudioDeviceRuntimeSink({
        captureOfflineInstrument: (device, source) => {
            const captured = captureOfflineDeviceSetup(device, source);
            return ({ port, signal }) =>
                prepareOfflineDeviceSetup({ deviceId: device.id, deviceType: device.type, captured, port, signal });
        },
        projectNativeDeviceState,
    });
}

/** What the captured preview setup posts at a device's offline worklet. */
async function postedSetup(captured: CapturedRenderInput, deviceId: string): Promise<PostedMessage[]> {
    const prepare = captured.instruments.get(deviceId);
    if (prepare === undefined) {
        throw new Error(`The preview capture holds no setup for ${deviceId}`);
    }
    const postMessage = vi.fn<(message: PostedMessage) => void>();
    await prepare({ port: { postMessage } as unknown as MessagePort });
    return postMessage.mock.calls.map(([message]) => message);
}

/** The last value each `param` message set, by name. */
function lastParams(messages: readonly PostedMessage[]): Map<string, number | undefined> {
    const params = new Map<string, number | undefined>();
    for (const message of messages) {
        if (message.type === 'param' && message.name !== undefined) {
            params.set(message.name, message.value);
        }
    }
    return params;
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

function setTracks(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
}

function currentTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

function withVocal(tracks: readonly Track[], overrides: Partial<Track>): Track[] {
    return tracks.map((track) => (track.id === 'vocal' ? { ...track, ...overrides } : track));
}

function trackIn(tracks: readonly Track[] | undefined, trackId: string): Track {
    const track = tracks?.find((candidate) => candidate.id === trackId);
    if (track === undefined) {
        throw new Error(`Track ${trackId} is not in the rendered document`);
    }
    return track;
}

/** A preview workspace at the live revision, with `edit` applied inside it. */
function openPreview(edit: () => void): Preview {
    const sourceRevision = captureProjectRevision();
    const workspace = createCommandPreviewWorkspace(sourceRevision);
    workspace.scope(edit);
    return { sourceRevision, workspace };
}

function measure(
    scope: typeof VOCAL | typeof MASTER | typeof KEYS_A | typeof KEYS,
    preview: Preview,
    signal?: AbortSignal
) {
    return renderAgentPreviewMeasurementScope({
        scope,
        startBeat: 4,
        endBeat: 8,
        sourceRevision: preview.sourceRevision,
        rangeCeilings: CEILINGS,
        preview: preview.workspace,
        signal,
    });
}

function subgraphRequests(): SubgraphRequest[] {
    return engine.renderTrackSubgraphOffline.mock.calls.map(([request]) => request as SubgraphRequest);
}

function capturedMixdown(): CapturedRenderInput {
    const captured = engine.renderOfflineInput.mock.calls[0]?.[0] as CapturedRenderInput | undefined;
    if (captured === undefined) {
        throw new Error('The preview mixdown never reached the renderer');
    }
    return captured;
}

function expectReleased(preview: Preview): void {
    expect(() => preview.workspace.getProjectDocument()).toThrow('Command preview has been released');
}

/** The Yeast rack reads `src/app/bootstrap.ts` hands the offline capture. */
function installAppYeastRacks(): void {
    configureOfflineYeastMidiProcessing({
        createProcessor: () => () => [],
        racks: {
            readRack: (deviceId) => readYeastRack(deviceId).processors,
            readStoredRack: readStoredYeastRack,
            holdsKeyedRack: holdsKeyedYeastRack,
            holdsLegacyRack: holdsLegacyYeastRack,
            firstDeviceInProjectOrder: () => yeastDeviceIdsInProjectOrder()[0] ?? null,
        },
    });
}

beforeEach(() => {
    installAppYeastRacks();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('preview measurement render test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    setTracks([
        createTrack({ id: 'master', name: 'Master', kind: 'master' }),
        { ...createTrack({ id: 'vocal', name: 'Vocal', kind: 'audio' }), gain: LIVE_GAIN },
    ]);
    transportStore.set({ ...defaultTransportState, tempo: LIVE_TEMPO });
    flushAutomergeStorageWrites();
    clearAgentMeasurementArtifacts();
    engine.renderOffline.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderOfflineInput.mockReset().mockResolvedValue(sineBuffer(0.25));
    engine.renderTrackSubgraphOffline.mockReset().mockResolvedValue(sineBuffer(0.5));
});

afterEach(() => {
    configureAudioDeviceRuntimeSink({});
    resetGrandBouleStores();
    clearAgentMeasurementArtifacts();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('renderAgentPreviewMeasurementScope', () => {
    it('renders the preview from the preview document and the baseline from the live project, leaving the live project untouched', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));

        const result = await measure(VOCAL, preview);

        expect(result.status).toBe('rendered');
        const [baseline, proposal] = subgraphRequests();
        expect(baseline?.source).toBeUndefined();
        expect(trackIn(baseline?.renderTracks, 'vocal').gain).toBe(LIVE_GAIN);
        expect(trackIn(proposal?.renderTracks, 'vocal').gain).toBe(LIVE_GAIN / 2);
        expect(trackIn(proposal?.source?.project.tracks?.tracks, 'vocal').gain).toBe(LIVE_GAIN / 2);
        expect(captureProjectRevision()).toBe(preview.sourceRevision);
        expect(trackIn(currentTracks(), 'vocal').gain).toBe(LIVE_GAIN);
        expectReleased(preview);
    });

    it('captures the preview mixdown from the preview document while the baseline mixdown renders live', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));

        const result = await measure(MASTER, preview);

        expect(result.status).toBe('rendered');
        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
        expect(engine.renderOffline).toHaveBeenCalledWith(
            expect.objectContaining({ startBeat: 4, durationBeats: 4, sampleRate: SAMPLE_RATE, tailSeconds: 0 })
        );
        expect(trackIn(capturedMixdown().renderContext.tracks?.tracks, 'vocal').gain).toBe(LIVE_GAIN / 2);
        expect(trackIn(currentTracks(), 'vocal').gain).toBe(LIVE_GAIN);
    });

    it('captures a device the preview inserts, with its parameters, though no live instance exists for it', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { devices: [GLUTEN] })));

        const result = await measure(MASTER, preview);

        expect(result.status).toBe('rendered');
        const captured = capturedMixdown();
        expect(trackIn(captured.renderContext.tracks?.tracks, 'vocal').devices).toEqual([GLUTEN]);
        expect(captured.instruments.has(GLUTEN.id)).toBe(true);
        expect(captured.nativeDevices.has(GLUTEN.id)).toBe(true);
        expect(trackIn(currentTracks(), 'vocal').devices).toEqual([]);
    });

    it('converts the range to seconds through each document’s own tempo map', async () => {
        const preview = openPreview(() => transportStore.set({ ...defaultTransportState, tempo: LIVE_TEMPO / 2 }));

        const result = await measure(MASTER, preview);

        // Beats 4 to 8: two seconds at 120 bpm, four at 60 bpm.
        expect(result).toMatchObject({
            status: 'rendered',
            baseline: { rangeSeconds: { measuredSeconds: 2, renderedSeconds: 4 } },
            preview: { rangeSeconds: { measuredSeconds: 4, renderedSeconds: 8 } },
        });
        expect(capturedMixdown().outputDurationSeconds).toBeCloseTo(4, 10);
        expect(transportStore.value?.tempo).toBe(LIVE_TEMPO);
    });

    it('refuses the preview before anything renders when its own tempo carries the range past a ceiling', async () => {
        const preview = openPreview(() => transportStore.set({ ...defaultTransportState, tempo: LIVE_TEMPO / 4 }));

        const result = await renderAgentPreviewMeasurementScope({
            scope: VOCAL,
            startBeat: 4,
            endBeat: 8,
            sourceRevision: preview.sourceRevision,
            // The live range is two seconds; at 30 bpm the preview's is eight.
            rangeCeilings: { measuredSeconds: 3, renderedSeconds: 600 },
            preview: preview.workspace,
        });

        expect(result).toEqual({
            status: 'refused',
            code: 'range-exceeds-ceiling',
            subject: 'preview',
            targetId: null,
            contributorId: null,
            deviceId: null,
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expectReleased(preview);
    });

    it('refuses both renders as stale once the live project leaves the base revision mid-run, and retains nothing', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));
        engine.renderTrackSubgraphOffline.mockImplementation((request: SubgraphRequest) => {
            if (request.source !== undefined) {
                // A collaborator's edit lands while the preview renders.
                setTracks(withVocal(currentTracks(), { gain: 0.3 }));
                flushAutomergeStorageWrites();
            }
            return Promise.resolve(sineBuffer(0.5));
        });

        const result = await measure(VOCAL, preview);

        expect(result).toEqual({
            status: 'refused',
            code: 'stale-revision',
            subject: null,
            targetId: 'vocal',
            contributorId: null,
            deviceId: null,
        });
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(2);
        expect(getAgentMeasurementArtifacts()).toEqual([]);
        expectReleased(preview);
    });

    it('refuses as stale before capturing when the live project has already left the base revision', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));
        setTracks(withVocal(currentTracks(), { gain: 0.3 }));
        flushAutomergeStorageWrites();

        const result = await measure(VOCAL, preview);

        expect(result).toEqual({
            status: 'refused',
            code: 'stale-revision',
            subject: null,
            targetId: null,
            contributorId: null,
            deviceId: null,
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expectReleased(preview);
    });

    it('cancels on an abort mid-run, retains nothing, and leaves the workspace released', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));
        const controller = new AbortController();
        engine.renderTrackSubgraphOffline.mockImplementation(
            ({ abortSignal }: SubgraphRequest) =>
                new Promise((_resolve, reject) => {
                    abortSignal?.addEventListener('abort', () => reject(new Error('Render aborted')));
                })
        );

        const pending = measure(VOCAL, preview, controller.signal);
        controller.abort();

        expect(await pending).toEqual({ status: 'cancelled' });
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(getAgentMeasurementArtifacts()).toEqual([]);
        expectReleased(preview);
    });

    it('retains both documents’ renders against the base revision', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));
        engine.renderTrackSubgraphOffline.mockImplementation((request: SubgraphRequest) =>
            Promise.resolve(sineBuffer(trackIn(request.renderTracks, request.targetTrackId).gain))
        );

        const result = await measure(VOCAL, preview);

        if (result.status !== 'rendered') {
            throw new Error(`Expected a rendered comparison, got ${JSON.stringify(result)}`);
        }
        const retained = getAgentMeasurementArtifacts().map((artifact) => [
            artifact.contentAddress,
            artifact.sourceRevision,
        ]);
        expect(retained).toEqual([
            [result.baseline.targets[0]?.artifact.contentAddress, preview.sourceRevision],
            [result.preview.targets[0]?.artifact.contentAddress, preview.sourceRevision],
        ]);
    });

    // The jsdom `OfflineAudioContext` is a stub that renders no samples, so a
    // real offline render cannot run here. The stand-in renderer prints a sine
    // at the target's fader gain — the one fact this row turns on — and the
    // measurement and comparison that follow are the real ones.
    it('measures a 6 dB fader cut in the preview as an integrated loudness delta near −6 LU', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN * 10 ** (-6 / 20) })));
        engine.renderTrackSubgraphOffline.mockImplementation((request: SubgraphRequest) =>
            Promise.resolve(sineBuffer(trackIn(request.renderTracks, request.targetTrackId).gain))
        );

        const result = await measure(VOCAL, preview);

        if (result.status !== 'rendered') {
            throw new Error(`Expected a rendered comparison, got ${JSON.stringify(result)}`);
        }
        const [baselineTarget] = result.baseline.targets;
        const [previewTarget] = result.preview.targets;
        if (baselineTarget === undefined || previewTarget === undefined) {
            throw new Error('Expected one rendered target per document');
        }
        const deltas = compareAgentScopeMeasurements({
            baseline: measureAgentScopeRender(baselineTarget.buffer, ['integratedLoudness']),
            preview: measureAgentScopeRender(previewTarget.buffer, ['integratedLoudness']),
        });
        const loudness = deltas.integratedLoudness;
        if (loudness?.status !== 'compared') {
            throw new Error(`Expected a compared loudness delta, got ${JSON.stringify(loudness)}`);
        }
        expect(loudness.unit).toBe('LU');
        expect(Math.abs(loudness.delta + 6)).toBeLessThanOrEqual(0.5);
    });
});

describe('renderAgentPreviewMeasurementScope — per-device state', () => {
    beforeEach(() => {
        installAppDeviceSink();
    });

    it('sets up a Grand Boule the preview rewrites under its live id with the preview voicing, never the live one', async () => {
        setTracks([...currentTracks(), pianoTrack(grandBoule(GRAND_BOULE_ID, grandBouleChunk(2, -0.5)))]);
        flushAutomergeStorageWrites();
        const liveState = createDefaultGrandBouleState();
        createGrandBouleStore(GRAND_BOULE_ID).set({
            ...liveState,
            temperament: 2,
            parameters: { ...liveState.parameters, hammerHardness: -0.5 },
            midiCalibration: { ...liveState.midiCalibration, ccSmoothingMs: 12 },
        });
        const preview = openPreview(() =>
            setTracks(
                currentTracks().map((track) =>
                    track.id === 'piano' ? pianoTrack(grandBoule(GRAND_BOULE_ID, grandBouleChunk(3, 0.5))) : track
                )
            )
        );

        const result = await measure(MASTER, preview);

        expect(result.status).toBe('rendered');
        const captured = capturedMixdown();
        const posted = await postedSetup(captured, GRAND_BOULE_ID);
        const params = lastParams(posted);
        expect(posted).toContainEqual({ type: 'temperament', index: 3 });
        expect(posted).not.toContainEqual({ type: 'temperament', index: 2 });
        expect(params.get('temperament')).toBe(3);
        expect(params.get('hammer_hardness')).toBe(0.5);
        // Calibration is never project state: the live device's own carries over.
        expect(params.get('cc_smoothing_ms')).toBe(12);
        expect(captured.nativeDevices.get(GRAND_BOULE_ID)?.parameterValues).toMatchObject({
            temperament: 3,
            hammer_hardness: 0.5,
        });
    });

    it('starts a Grand Boule the preview creates on the calibration a freshly loaded project gives it', async () => {
        const preview = openPreview(() =>
            setTracks([...currentTracks(), pianoTrack(grandBoule('grand-boule-new', grandBouleChunk(0, 0)))])
        );

        const result = await measure(MASTER, preview);

        expect(result.status).toBe('rendered');
        const fresh = createDefaultGrandBouleState().midiCalibration;
        const params = lastParams(await postedSetup(capturedMixdown(), 'grand-boule-new'));
        expect(params.get('cc_smoothing_ms')).toBe(fresh.ccSmoothingMs);
        expect(params.get('sustain_threshold')).toBe(fresh.sustainThreshold);
    });

    it('refuses a hosted plugin the preview creates, which no loaded instance backs, before anything renders', async () => {
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { devices: [PLUGIN] })));

        const result = await measure(MASTER, preview);

        expect(result).toEqual({
            status: 'refused',
            code: 'unrenderable-preview-device',
            subject: 'preview',
            targetId: null,
            contributorId: null,
            deviceId: PLUGIN.id,
        });
        expect(engine.renderOffline).not.toHaveBeenCalled();
        expect(engine.renderOfflineInput).not.toHaveBeenCalled();
        expectReleased(preview);
    });

    it('renders a hosted plugin the live project already holds, as the live render carries it', async () => {
        setTracks(withVocal(currentTracks(), { devices: [PLUGIN] }));
        flushAutomergeStorageWrites();
        const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));

        const result = await measure(MASTER, preview);

        expect(result.status).toBe('rendered');
    });

    describe('Yeast racks', () => {
        function seedLiveRack(processors: YeastProcessorInfo[]): void {
            setTracks([...currentTracks(), keysTrack()]);
            flushAutomergeStorageWrites();
            yeastStore.set({ processors, uiLevel: 1 });
            flushAutomergeStorageWrites();
        }

        it('renders when the preview stores a device’s rack exactly as the live project does', async () => {
            seedLiveRack([ARPEGGIATOR]);
            const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));

            const result = await measure(MASTER, preview);

            expect(result.status).toBe('rendered');
            expect(capturedMixdown().renderContext.tracks?.tracks.map((track) => track.id)).toContain('keys');
        });

        it('refuses when the preview stores a different rack for a device the live project holds', async () => {
            seedLiveRack([ARPEGGIATOR]);
            const preview = openPreview(() => yeastStore.set({ processors: [CHORD], uiLevel: 1 }));

            const result = await measure(MASTER, preview);

            expect(result).toEqual({
                status: 'refused',
                code: 'unprojectable-device-state',
                subject: 'preview',
                targetId: null,
                contributorId: null,
                deviceId: 'yeast-1',
            });
            expect(engine.renderOffline).not.toHaveBeenCalled();
            expectReleased(preview);
        });

        // Red when a capture with no rack reader, which reads every rack empty, renders anyway.
        it('refuses a Yeast device when no rack reader is configured, since its rack would capture empty', async () => {
            seedLiveRack([ARPEGGIATOR]);
            configureOfflineYeastMidiProcessing({ createProcessor: () => () => [] });
            const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));

            const result = await measure(KEYS, preview);

            expect(result).toMatchObject({
                status: 'refused',
                code: 'unprojectable-device-state',
                subject: 'preview',
                deviceId: 'yeast-1',
            });
        });

        it('refuses a device only the preview holds when the preview stores a rack for it', async () => {
            const preview = openPreview(() => {
                setTracks([...currentTracks(), keysTrack()]);
                yeastStore.set({ processors: [ARPEGGIATOR], uiLevel: 1 });
            });

            const result = await measure(MASTER, preview);

            expect(result).toMatchObject({
                status: 'refused',
                code: 'unprojectable-device-state',
                subject: 'preview',
                deviceId: 'yeast-1',
            });
            expect(engine.renderOffline).not.toHaveBeenCalled();
        });

        describe('a legacy single-rack slot', () => {
            function seedTwoYeastTracks(): void {
                setTracks([...currentTracks(), yeastTrack('keys-a', 'yeast-a'), yeastTrack('keys-b', 'yeast-b')]);
                flushAutomergeStorageWrites();
            }

            /** The live tracks with keys-b moved ahead of keys-a, so yeast-b comes first in project order. */
            function withKeysBFirst(): Track[] {
                const tracks = currentTracks();
                const keysB = trackIn(tracks, 'keys-b');
                return [keysB, ...tracks.filter((track) => track.id !== 'keys-b')];
            }

            it('renders while the preview keeps the device that owns the legacy rack first', async () => {
                seedTwoYeastTracks();
                seedLegacyRackSlot();
                const preview = openPreview(() => setTracks(withVocal(currentTracks(), { gain: LIVE_GAIN / 2 })));

                const result = await measure(MASTER, preview);

                expect(result.status).toBe('rendered');
            });

            // Red when the legacy rack's owner is read only from the live track order.
            it('refuses when the preview puts another Yeast device first, which would adopt the legacy rack', async () => {
                seedTwoYeastTracks();
                seedLegacyRackSlot();
                expect(readYeastRack('yeast-a').processors.map(({ id }) => id)).toEqual(['arp-legacy']);
                const preview = openPreview(() => setTracks(currentTracks().filter((track) => track.id !== 'keys-a')));

                const result = await measure(MASTER, preview);

                expect(result).toEqual({
                    status: 'refused',
                    code: 'unprojectable-device-state',
                    subject: 'preview',
                    targetId: null,
                    contributorId: null,
                    deviceId: 'yeast-b',
                });
                expect(engine.renderOffline).not.toHaveBeenCalled();
            });

            // Red when the live owner, which would lose the legacy rack, is not counted divergent.
            it('refuses a measurement of the live owner when the preview puts another Yeast device first', async () => {
                seedTwoYeastTracks();
                seedLegacyRackSlot();
                const preview = openPreview(() => setTracks(withKeysBFirst()));

                const result = await measure(KEYS_A, preview);

                expect(result).toMatchObject({
                    status: 'refused',
                    code: 'unprojectable-device-state',
                    subject: 'preview',
                    deviceId: 'yeast-a',
                });
            });

            // Red when a moved owner is refused although its own keyed rack, which it reads before
            // the parked legacy rack, makes its render faithful.
            it('renders when the device the preview puts first reads a keyed rack of its own', async () => {
                seedTwoYeastTracks();
                seedYeastSlot({
                    schemaVersion: 2,
                    racks: { [LEGACY_SHARED_RACK_DEVICE_ID]: storedRack('arp-legacy'), 'yeast-b': storedRack('arp-b') },
                });
                const preview = openPreview(() => setTracks(currentTracks().filter((track) => track.id !== 'keys-a')));

                const result = await measure(MASTER, preview);

                expect(result.status).toBe('rendered');
            });

            // Red when any reorder of Yeast devices is refused, whether or not a legacy rack exists.
            it('renders a reorder of Yeast devices in a project with no legacy rack', async () => {
                seedTwoYeastTracks();
                const preview = openPreview(() => setTracks(withKeysBFirst()));

                const result = await measure(KEYS_A, preview);

                expect(result.status).toBe('rendered');
            });
        });
    });
});
