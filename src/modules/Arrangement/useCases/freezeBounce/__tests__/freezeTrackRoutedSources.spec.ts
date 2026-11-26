import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    cacheAudioBuffer,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
    reportLatency,
} from '#/modules/AudioEngine/useCases';
import { automationStore, modulationStore, type ModulationStoreState } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Track } from '../../../models/Track';
import { updateTrack } from '../../../repositories/track/updateTrack';
import {
    type AdjustmentLayer,
    adjustmentLayerStore,
    takeLaneStore,
    type TakeLaneStoreState,
    trackStore,
    vcaGroupStore,
} from '../../../stores';
import { createTrack } from '../../createTrack';
import { addClip, getArrangementHandlers, removeClip, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { digestFreezePrintInput } from '../digestFreezePrintInput';
import { initStalenessDetection } from '../initStalenessDetection';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The Freeze action, its commit and the clip writes are the real ones over a real CRDT document.
// Only the offline render, which owns the audio, is replaced; like the real one it reads the input
// the freeze captured and hands it, never the live stores.
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

vi.mock('../digestFreezePrintInput', async (importOriginal) => {
    const original = await importOriginal<typeof import('../digestFreezePrintInput')>();
    return { digestFreezePrintInput: vi.fn(original.digestFreezePrintInput) };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
}));

const { clearReportedLatency: clearLiveReportedLatency } = await vi.importActual<
    typeof import('#/modules/AudioEngine/useCases')
>('#/modules/AudioEngine/useCases');

const { digestFreezePrintInput: realDigest } =
    await vi.importActual<typeof import('../digestFreezePrintInput')>('../digestFreezePrintInput');

const TRACK_ID = 'track-1';
const SOURCE_ID = 'track-source';
const OTHER_ID = 'track-other';
const CHANGED_MESSAGE = 'The track changed while it was freezing. Freeze it again.';

const FIRST_EXTRA_ID = 'track-first-extra';
const SECOND_EXTRA_ID = 'track-second-extra';

function automationLane(trackId: string, parameterId: string, value: number) {
    return {
        id: `lane-${trackId}-${parameterId}`,
        trackId,
        parameterId,
        parameterName: parameterId,
        points: [{ id: 'point-1', beat: 0, value, curve: 'linear' as const, tension: 0 }],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

/** A sidechain route from the routed source into the target: both its ends are in the render. */
function sidechainRoute(gain: number) {
    return {
        id: 'route-inside',
        sourceTrackId: SOURCE_ID,
        targetTrackId: TRACK_ID,
        targetDeviceId: 'device-1',
        targetParameterId: 'key',
        gain,
    };
}

function setVcaGain(gain: number): void {
    vcaGroupStore.set({ groups: [{ id: 'vca-1', name: 'VCA', gain, muted: false, trackIds: [SOURCE_ID] }] });
}

function joinSourceToVca(gain: number): void {
    setVcaGain(gain);
    updateTrack(SOURCE_ID, (track) => ({ ...track, vcaGroupId: 'vca-1' }));
}

function setSourceNotePitch(pitch: number): void {
    midiStore.set({
        ...midiStore.value!,
        notesByClipId: {
            ...midiStore.value!.notesByClipId,
            'source-clip': [{ id: 'note-1', pitch, startBeat: 0, duration: 1, velocity: 90 }],
        },
    });
}

/** A take lane on the routed source, an adjustment layer reaching it and a modulator mapped onto it. */
function seedSessionRows(): void {
    takeLaneStore.set({
        lanes: [
            {
                id: 'lane-1',
                trackId: SOURCE_ID,
                takes: [
                    {
                        id: 'take-1',
                        clipId: 'source-clip',
                        name: 'Take 1',
                        startBeat: 0,
                        endBeat: 4,
                        selected: true,
                    },
                ],
                activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-1' }],
            },
        ],
    });
    adjustmentLayerStore.set({
        layers: [
            {
                id: 'layer-1',
                name: 'Layer',
                effectType: 'volume',
                parameters: [{ name: 'Gain', value: -3, min: -24, max: 12, unit: 'dB' }],
                affectedTrackIds: [SOURCE_ID],
                insertionIndex: 0,
                regions: [],
                enabled: true,
                mix: 1,
                color: '#abcdef',
            },
        ],
    });
    modulationStore.set({
        modulators: [
            {
                id: 'mod-1',
                name: 'LFO',
                trackId: SOURCE_ID,
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: false, phase: 0, depth: 0.5 },
                mappings: [
                    { targetTrackId: SOURCE_ID, targetDeviceId: 'device-1', targetParamId: 'cutoff', amount: 0.5 },
                ],
                enabled: true,
            },
        ],
    });
}

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];
type Modulator = ModulationStoreState['modulators'][number];

function editTakeLane(edit: (take: Take) => Take): void {
    takeLaneStore.set({
        lanes: takeLaneStore.value!.lanes.map((lane) => ({ ...lane, takes: lane.takes.map(edit) })),
    });
}

function editLayer(edit: (layer: AdjustmentLayer) => AdjustmentLayer): void {
    adjustmentLayerStore.set({ layers: adjustmentLayerStore.value!.layers.map(edit) });
}

function editModulator(edit: (modulator: Modulator) => Modulator): void {
    modulationStore.set({ modulators: modulationStore.value!.modulators.map(edit) });
}

function findTrack(trackId: string) {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected the fixture track ${trackId}`);
    }
    return track;
}

function renderedBuffer(): AudioBuffer {
    const channel = new Float32Array(4410).fill(0.25);
    return {
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        duration: 0.1,
        getChannelData: vi.fn(() => channel),
        sampleRate: 44100,
        length: 4410,
        numberOfChannels: 1,
    };
}

/** The frozen track, a source routed into it, and a track that reaches it by no route. */
function resetProject(sourceKind: 'audio' | 'midi' = 'audio'): void {
    trackStore.set({
        tracks: [
            createTrack({ id: TRACK_ID, name: 'Frozen', kind: 'audio' }),
            { ...createTrack({ id: SOURCE_ID, name: 'Source', kind: sourceKind }), outputId: TRACK_ID },
            createTrack({ id: OTHER_ID, name: 'Other', kind: 'audio' }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
    addClip({ id: 'first-clip', trackId: TRACK_ID, startBeat: 0, endBeat: 4, name: 'First', type: 'audio' });
    addClip({ id: 'source-clip', trackId: SOURCE_ID, startBeat: 0, endBeat: 4, name: 'Source', type: sourceKind });
}

function addLateClip(trackId: string, clipId = 'late-clip'): void {
    addClip({ id: clipId, trackId, startBeat: 4, endBeat: 8, name: 'Late', type: 'audio' });
}

async function freeze(): Promise<void> {
    vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
    await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });
}

beforeEach(() => {
    vi.mocked(digestFreezePrintInput).mockImplementation(realDigest);
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze routed sources test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureRuntimeGraphProjectRevisionValidator(
        (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
    );
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    projectStore.set(structuredClone(defaultProjectStoreState));
    resetProject();
});

afterEach(() => {
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    sidechainStore.set({ routes: [] });
    vcaGroupStore.set({ groups: [] });
    automationStore.set({ lanes: [] });
    takeLaneStore.set({ lanes: [] });
    adjustmentLayerStore.set({ layers: [] });
    modulationStore.set({ modulators: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('a freeze whose render reads a routed source track', () => {
    it('renders the captured sources and commits when a source gains a clip and loses it during the render', async () => {
        let renderedSourceClipIds: string[] = [];
        vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
            addLateClip(SOURCE_ID);
            const capturedSource = options?.captured?.source.project.tracks?.tracks.find(
                (candidate) => candidate.id === SOURCE_ID
            );
            renderedSourceClipIds = (capturedSource?.clips ?? []).map((clip) => clip.id);
            options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
            removeClip('late-clip');
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(renderedSourceClipIds).toEqual(['source-clip']);
        expect(findTrack(TRACK_ID).frozen).toBe(true);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });

    it('pins compensation from the latency the render aligned by, not a figure reported during it', async () => {
        const deviceId = 'target-delay';
        updateTrack(TRACK_ID, (track) => ({
            ...track,
            devices: [{ id: deviceId, name: 'Delay', type: 'builtin-delay', bypassed: false, parameterValues: {} }],
        }));
        reportLatency(deviceId, 20);
        // Like the real render, the stand-in reports the latency input it captured before it
        // yielded, and withholds the device so its latency is the residual the take must pin.
        vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
            const project = options?.captured?.source.project;
            if (!project) {
                throw new Error('Expected the freeze to hand the render its capture');
            }
            const compensationInput = {
                tracks: project.tracks?.tracks ?? [],
                routes: project.sidechainRoutes,
                deviceLatencyMs: new Map([[deviceId, 20]]),
            };
            reportLatency(deviceId, 50);
            options.onScheduled?.({
                scheduledNotes: 0,
                scheduledBuffers: [],
                withheldDeviceTypes: ['builtin-delay'],
                compensationInput,
            });
            return Promise.resolve(renderedBuffer());
        });

        try {
            await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });
        } finally {
            clearLiveReportedLatency(deviceId);
        }

        const { freezeState } = findTrack(TRACK_ID);
        expect(freezeState.status).toBe('frozen');
        expect(freezeState.compensationSeconds).toBeCloseTo(0.02, 9);
    });

    it('refuses the take when the source is edited during the render', async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            addLateClip(SOURCE_ID);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it.each([
        ["a routed source's gain changes", (track: Track) => ({ ...track, gain: 0.3 })],
        ["a routed source's pan changes", (track: Track) => ({ ...track, pan: -0.5 })],
        [
            "a routed source's automation is turned off",
            (track: Track) => ({ ...track, automationMode: 'off' as const }),
        ],
        ['a routed source is disabled', (track: Track) => ({ ...track, disabled: true })],
        [
            'a routed source gains a send',
            (track: Track) => ({ ...track, sends: [{ busId: TRACK_ID, level: 0.5, preFader: false }] }),
        ],
        [
            "a routed source's output moves to another track the render reads",
            (track: Track) => ({ ...track, outputId: OTHER_ID }),
        ],
    ])('refuses the take when %s during the render', async (_name, edit) => {
        updateTrack(OTHER_ID, (track) => ({ ...track, outputId: TRACK_ID }));
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(SOURCE_ID, edit);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('refuses the take when a routed source changes a send level during the render', async () => {
        updateTrack(SOURCE_ID, (track) => ({ ...track, sends: [{ busId: TRACK_ID, level: 0.8, preFader: false }] }));
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(SOURCE_ID, (track) => ({
                ...track,
                sends: [{ busId: TRACK_ID, level: 0.2, preFader: false }],
            }));
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it("commits the take when the target's own fader moves during the render", async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(TRACK_ID, (track) => ({ ...track, gain: 0.3 }));
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it('refuses the take when a routed MIDI source has a note edited during the render', async () => {
        resetProject('midi');
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'source-clip': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
        });
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    ...midiStore.value!.notesByClipId,
                    'source-clip': [{ id: 'note-1', pitch: 62, startBeat: 0, duration: 1, velocity: 90 }],
                },
            });
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('commits the take when only a track outside the render is edited during the render', async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            addLateClip(OTHER_ID);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it('gives the same signature to the same sources twice', async () => {
        await freeze();
        const first = findTrack(TRACK_ID).freezeState.sourceContentHash;
        await executeAppAction({ type: 'unfreezeTrack', payload: { trackId: TRACK_ID } });
        await freeze();

        expect(first).toBeDefined();
        expect(findTrack(TRACK_ID).freezeState.sourceContentHash).toBe(first);
    });

    it('commits the take when a routed content source is muted during the render', async () => {
        // The render honours only a sidechain key's mute; a content source prints unmuted.
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(SOURCE_ID, (track) => ({ ...track, muted: true }));
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it("refuses the take when a point on the target's device lane is edited during the render", async () => {
        automationStore.set({ lanes: [automationLane(TRACK_ID, 'device-1:cutoff', 0.2)] });
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            automationStore.set({ lanes: [automationLane(TRACK_ID, 'device-1:cutoff', 0.9)] });
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it("commits the take when a point on the target's own gain lane is edited during the render", async () => {
        automationStore.set({ lanes: [automationLane(TRACK_ID, 'gain', 0.2)] });
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            automationStore.set({ lanes: [automationLane(TRACK_ID, 'gain', 0.9)] });
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it("refuses the take when the target's send level changes during the render", async () => {
        updateTrack(TRACK_ID, (track) => ({ ...track, sends: [{ busId: OTHER_ID, level: 0.8, preFader: false }] }));
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(TRACK_ID, (track) => ({ ...track, sends: [{ busId: OTHER_ID, level: 0.2, preFader: false }] }));
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it("refuses the take when a routed source's VCA group gain changes during the render", async () => {
        joinSourceToVca(0.5);
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            setVcaGain(0.9);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('renders the captured VCA gain and commits when it changes and changes back during the render', async () => {
        joinSourceToVca(0.5);
        let renderedGain: number | undefined;
        vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
            setVcaGain(0.9);
            renderedGain = options?.captured?.source.project.vcaGroups[0]?.gain;
            setVcaGain(0.5);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(renderedGain).toBe(0.5);
        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it('refuses the take when a sidechain route inside the render changes during the render', async () => {
        sidechainStore.set({ routes: [sidechainRoute(1)] });
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            sidechainStore.set({ routes: [sidechainRoute(0.5)] });
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    describe('once frozen', () => {
        let stopStaleness: () => void;

        beforeEach(async () => {
            await freeze();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
            stopStaleness = initStalenessDetection();
        });

        afterEach(() => {
            stopStaleness();
        });

        it('marks the track stale when a routed source is edited', async () => {
            addLateClip(SOURCE_ID);

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('keeps the freeze when a track outside the render is edited', async () => {
            vi.mocked(digestFreezePrintInput).mockClear();

            addLateClip(OTHER_ID);

            expect(digestFreezePrintInput).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');

            addLateClip(SOURCE_ID, 'source-late-clip');

            expect(digestFreezePrintInput).toHaveBeenCalled();
        });

        it('marks the track stale when the source is rerouted away', async () => {
            updateTrack(SOURCE_ID, (track) => ({ ...track, outputId: 'master' }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });
    });
    describe('once frozen over extra routing', () => {
        let stopStaleness: () => void;

        afterEach(() => {
            stopStaleness();
        });

        async function freezeWatched(): Promise<void> {
            await freeze();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
            stopStaleness = initStalenessDetection();
        }

        it('marks the track stale when a routed source changes its gain', async () => {
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({ ...track, gain: 0.3 }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('marks the track stale when a routed source changes a send level', async () => {
            updateTrack(SOURCE_ID, (track) => ({
                ...track,
                sends: [{ busId: TRACK_ID, level: 0.8, preFader: false }],
            }));
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({
                ...track,
                sends: [{ busId: TRACK_ID, level: 0.2, preFader: false }],
            }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('marks the track stale when a sidechain route into the render is removed', async () => {
            sidechainStore.set({
                routes: [
                    {
                        id: 'route-1',
                        sourceTrackId: OTHER_ID,
                        targetTrackId: TRACK_ID,
                        targetDeviceId: 'device-1',
                        targetParameterId: 'key',
                        gain: 1,
                    },
                ],
            });
            await freezeWatched();

            sidechainStore.set({ routes: [] });

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('keeps the freeze when a sidechain route between unrelated tracks changes', async () => {
            await freezeWatched();
            vi.mocked(digestFreezePrintInput).mockClear();

            sidechainStore.set({
                routes: [
                    {
                        id: 'route-2',
                        sourceTrackId: OTHER_ID,
                        targetTrackId: 'track-nowhere',
                        targetDeviceId: 'device-1',
                        targetParameterId: 'key',
                        gain: 1,
                    },
                ],
            });

            expect(digestFreezePrintInput).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
        });
    });
    describe('once frozen, watched for changes', () => {
        let stopStaleness: () => void = () => undefined;

        afterEach(() => {
            stopStaleness();
        });

        async function freezeWatched(): Promise<void> {
            await freeze();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
            stopStaleness = initStalenessDetection();
        }

        it('marks the track stale when a note of a routed MIDI source is edited', async () => {
            resetProject('midi');
            setSourceNotePitch(60);
            await freezeWatched();

            setSourceNotePitch(62);

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('marks the track stale when a routed source is disabled', async () => {
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({ ...track, disabled: true }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('marks the track stale when a sidechain route inside the render changes', async () => {
            sidechainStore.set({ routes: [sidechainRoute(1)] });
            await freezeWatched();

            sidechainStore.set({ routes: [sidechainRoute(0.5)] });

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('runs no digest when a routed source is renamed or resized', async () => {
            await freezeWatched();
            vi.mocked(digestFreezePrintInput).mockClear();

            updateTrack(SOURCE_ID, (track) => ({ ...track, name: 'Renamed source' }));
            updateTrack(SOURCE_ID, (track) => ({ ...track, height: track.height + 40 }));

            expect(digestFreezePrintInput).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
        });

        it('marks the track stale when a routed source joins a VCA group with a non-unity gain', async () => {
            setVcaGain(0.5);
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({ ...track, vcaGroupId: 'vca-1' }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('keeps the freeze when a routed source joins a VCA group at unity gain', async () => {
            setVcaGain(1);
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({ ...track, vcaGroupId: 'vca-1' }));

            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
        });

        describe('with a take lane, an adjustment layer and a modulator on a covered track', () => {
            beforeEach(async () => {
                seedSessionRows();
                await freezeWatched();
            });

            it.each([
                ['another take is selected', () => editTakeLane((take) => ({ ...take, selected: !take.selected }))],
                ['a take is renamed', () => editTakeLane((take) => ({ ...take, name: 'Renamed take' }))],
                ['an adjustment layer is renamed', () => editLayer((layer) => ({ ...layer, name: 'Renamed layer' }))],
                ['an adjustment layer is recoloured', () => editLayer((layer) => ({ ...layer, color: '#123456' }))],
                ['a modulator is renamed', () => editModulator((modulator) => ({ ...modulator, name: 'Renamed' }))],
            ])('keeps the freeze and runs no digest when %s', (_name, edit) => {
                vi.mocked(digestFreezePrintInput).mockClear();

                edit();

                expect(digestFreezePrintInput).not.toHaveBeenCalled();
                expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
            });

            it.each([
                ['a take moves', () => editTakeLane((take) => ({ ...take, endBeat: take.endBeat + 1 }))],
                ['an adjustment layer mix changes', () => editLayer((layer) => ({ ...layer, mix: 0.25 }))],
                [
                    "a modulator's config changes",
                    () =>
                        editModulator((modulator) => ({
                            ...modulator,
                            config: {
                                kind: 'lfo' as const,
                                waveform: 'saw' as const,
                                rate: 2,
                                sync: false,
                                phase: 0,
                                depth: 0.9,
                            },
                        })),
                ],
            ])('marks the track stale when %s', async (_name, edit) => {
                edit();

                await vi.waitFor(() => {
                    expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
                });
            });
        });

        it("runs no digest and keeps the freeze when the frozen track's own fader moves", async () => {
            await freezeWatched();
            vi.mocked(digestFreezePrintInput).mockClear();

            updateTrack(TRACK_ID, (track) => ({ ...track, gain: 0.3, pan: -0.5 }));

            expect(digestFreezePrintInput).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
        });

        it('marks a track stale when it is written during a pass that already evaluated it', async () => {
            // Two more frozen tracks, ordered ahead of the target, so a pass has already read them
            // by the time the target's evaluation runs.
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: [
                    createTrack({ id: FIRST_EXTRA_ID, name: 'First extra', kind: 'audio' }),
                    createTrack({ id: SECOND_EXTRA_ID, name: 'Second extra', kind: 'audio' }),
                    ...state.tracks,
                ],
            });
            addClip({
                id: 'first-extra-clip',
                trackId: FIRST_EXTRA_ID,
                startBeat: 0,
                endBeat: 4,
                name: 'A',
                type: 'audio',
            });
            addClip({
                id: 'second-extra-clip',
                trackId: SECOND_EXTRA_ID,
                startBeat: 0,
                endBeat: 4,
                name: 'B',
                type: 'audio',
            });
            vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
            await executeAppAction({ type: 'freezeTrack', payload: { trackId: FIRST_EXTRA_ID } });
            await executeAppAction({ type: 'freezeTrack', payload: { trackId: SECOND_EXTRA_ID } });
            await freezeWatched();
            vi.mocked(digestFreezePrintInput).mockImplementationOnce((input) => {
                updateTrack(FIRST_EXTRA_ID, (track) => ({ ...track, disabled: true }));
                updateTrack(SECOND_EXTRA_ID, (track) => ({ ...track, disabled: true }));
                return realDigest(input);
            });

            updateTrack(SOURCE_ID, (track) => ({ ...track, disabled: true }));

            // Evaluation is synchronous: by the time the write returns, the pass the two later
            // writes asked for has run, so no later notification can stand in for it.
            expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            expect(findTrack(FIRST_EXTRA_ID).freezeState.status).toBe('stale');
            expect(findTrack(SECOND_EXTRA_ID).freezeState.status).toBe('stale');
        });

        it('evaluates nothing once torn down', async () => {
            await freezeWatched();
            stopStaleness();
            vi.mocked(digestFreezePrintInput).mockClear();

            // Two edits: a watcher still subscribed would record the first and digest the second.
            updateTrack(SOURCE_ID, (track) => ({ ...track, gain: 0.3 }));
            updateTrack(SOURCE_ID, (track) => ({ ...track, gain: 0.2 }));

            expect(digestFreezePrintInput).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
        });
    });
});
