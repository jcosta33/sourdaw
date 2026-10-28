import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort, flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import {
    audioEngine,
    configureAudioDeviceRuntimeSink,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
    mirrorDeviceChainDelta,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';

import { type Device, type Track, trackStore } from '../../../stores/trackStore';
import { createTrack } from '../../../useCases/createTrack';
import { applyDeviceChainRuntimeDelta } from '../../../useCases/device/applyDeviceChainRuntimeDelta';
import { compileReorderDevicesAction } from '../../../useCases/device/compileReorderDevicesAction';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { projectTrackToLiveStrip } from '../../../useCases/projectTrackToLiveStrip';
import { runtimeGraphTopology } from '../../../useCases/runtimeGraphTopology';
import { setTrackOutput } from '../../../useCases/toggleTrackState/setTrackOutput';

// The graph writers, compiler, CRDT, Command history and builtin factories are
// real. Only platform AudioNodes are controlled; there is no WASM substitution.
const audio = await vi.hoisted(async () => {
    const { createMockAudioContext } = await import('#/helpers/__tests__/audioContext.mock');
    const context = createMockAudioContext();
    const edges = new Map<object, Set<unknown>>();
    function recordNode<TNode extends object>(node: TNode): TNode {
        const destinations = new Set<unknown>();
        edges.set(node, destinations);
        Object.defineProperty(node, 'connect', {
            value: (target: unknown) => {
                destinations.add(target);
                return target;
            },
        });
        Object.defineProperty(node, 'disconnect', {
            value: (target?: unknown) => {
                if (target === undefined) {
                    destinations.clear();
                } else {
                    destinations.delete(target);
                }
            },
        });
        return node;
    }
    for (const name of ['createGain', 'createStereoPanner', 'createAnalyser', 'createBiquadFilter', 'createDynamicsCompressor', 'createDelay'] as const) {
        const factory = context[name].getMockImplementation();
        if (!factory) {
            throw new Error(`Missing controlled platform primitive ${name}`);
        }
        Object.defineProperty(context, name, { value: () => recordNode(factory()) });
    }
    vi.stubGlobal('AudioContext', class {
        constructor() {
            return context;
        }
    });
    class MeterWorklet {
        port = { postMessage: vi.fn(), close: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
    }
    vi.stubGlobal('AudioWorkletNode', MeterWorklet);
    return { context, edges, MeterWorklet };
});

// Record the complete native input while still calling the production mirror.
// No physical native session is active here; the native-obligation integration
// suite owns real apply/defer queue and readback proof with its backend double.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return { ...actual, mirrorDeviceChainDelta: vi.fn(actual.mirrorDeviceChainDelta) };
});

const removed = vi.fn<(payload: { deviceId: string; deviceType: string }) => void>();
let stopProjection: (() => void) | undefined;

function eq(id: string): Device {
    return { id, name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: { 'eq-low-gain': 2 } };
}

function currentTrack(): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === 'midi');
    if (!track) {
        throw new Error('Missing authoritative MIDI track');
    }
    return track;
}

function liveIds(): string[] {
    return audioEngine.getTrackStrip('midi')?.deviceNodes.map((device) => device.deviceId) ?? [];
}

function warmProject(instrumentType = 'builtin-synth'): { track: Track; bus: Track; instrument: Device } {
    const track = createTrack({ id: 'midi', name: 'MIDI', kind: 'midi', withoutDefaultDevice: true });
    const instrument: Device = { id: 'synth', name: 'Synth', type: instrumentType, bypassed: false, parameterValues: {} };
    const compressor: Device = { id: 'comp', name: 'Compressor', type: 'builtin-compressor', bypassed: false, parameterValues: { threshold: -18 } };
    track.devices = [instrument, eq('eq'), compressor];
    const bus = createTrack({ id: 'bus', name: 'Bus', kind: 'bus' });
    bus.devices = [eq('bus-eq')];
    trackStore.set({ tracks: [track, bus], selectedTrackId: track.id });
    flushAutomergeStorageWrites();
    for (const owner of [bus, track]) {
        expect(projectTrackToLiveStrip({ trackId: owner.id })).toMatchObject({ acceptance: 'accepted', application: 'applied' });
    }
    expect(liveIds()).toEqual(['eq', 'comp']);
    expect(audioEngine.getTrackStrip(bus.id)?.deviceNodes.map((device) => device.deviceId)).toEqual(['bus-eq']);
    clearUndoHistory();
    removed.mockClear();
    vi.mocked(mirrorDeviceChainDelta).mockClear();
    return { track: structuredClone(currentTrack()), bus, instrument };
}

beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioWorkletNode', audio.MeterWorklet);
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('nodeless runtime projection');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    stopProjection = setupProjectionBridge();
    projectCrdtToStores();
    trackStore.set({ tracks: [], selectedTrackId: null });
    flushAutomergeStorageWrites();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    clearUndoHistory();
    audioEngine.resetGraph();
    configureRuntimeGraphProjectRevisionValidator((revision) => revision === captureProjectRevision());
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    configureAudioDeviceRuntimeSink({ emitDeviceRemoved: removed });
    await audioEngine.initialize();
});

afterEach(() => {
    audioEngine.resetGraph();
    configureAudioDeviceRuntimeSink({});
    configureRuntimeGraphProjectRevisionValidator(null);
    configureRuntimeGraphTopologyValidator(null);
    clearUndoHistory();
    clearHandlerRegistry();
    stopProjection?.();
    stopProjection = undefined;
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    removeCrdtDoc('revision-change');
    vi.restoreAllMocks();
});

describe.each(['builtin-synth', 'builtin-drum-kit'])('%s alongside persistent runtime devices', (instrumentType) => {
    it('routes a warm Synth/EQ/compressor strip to a verified bus through the actual output writer', () => {
        const { track, bus } = warmProject(instrumentType);
        expect(setTrackOutput(track.id, bus.id)).toBe(true);
        expect(currentTrack().outputId).toBe(bus.id);
        expect(currentTrack().devices.map((device) => device.id)).toEqual(['synth', 'eq', 'comp']);
        const source = audioEngine.getTrackStrip(track.id);
        const target = audioEngine.getTrackStrip(bus.id);
        expect(source?.outputId).toBe(bus.id);
        expect(audio.edges.get(source!.carrierGate)?.has(target!.gainNode)).toBe(true);
        expect(liveIds()).toEqual(['eq', 'comp']);
    });

    it('reorders real persistent effects around Synth and retains full project/native chains through Undo and Redo', async () => {
        const { track } = warmProject(instrumentType);
        const before = audioEngine.getTrackStrip(track.id);
        const eqNode = before?.deviceNodes[0];
        const compNode = before?.deviceNodes[1];
        const action = compileReorderDevicesAction(track.id, 'comp', 'eq');
        if (!action) {
            throw new Error('Expected a legal compiled rack reorder');
        }
        await expect(executeAppAction(action)).resolves.toBeUndefined();
        expect(currentTrack().devices.map((device) => device.id)).toEqual(['synth', 'comp', 'eq']);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([compNode, eqNode]);
        expect(audioEngine.getTrackStrip(track.id)?.faderNode).toBe(before?.faderNode);
        expect(vi.mocked(mirrorDeviceChainDelta).mock.calls.at(-1)?.[0].after.devices.map((device) => device.id)).toEqual(['synth', 'comp', 'eq']);
        expect(removed).not.toHaveBeenCalled();
        await undo();
        expect(currentTrack().devices.map((device) => device.id)).toEqual(['synth', 'eq', 'comp']);
        expect(liveIds()).toEqual(['eq', 'comp']);
        await redo();
        expect(currentTrack().devices.map((device) => device.id)).toEqual(['synth', 'comp', 'eq']);
        expect(liveIds()).toEqual(['comp', 'eq']);
    });

    it('restores a mixed Synth/effect preset chain with actual constructors and complete native input', async () => {
        const { track, instrument } = warmProject(instrumentType);
        const oldNodes = audioEngine.getTrackStrip(track.id)?.deviceNodes;
        await expect(executeAppAction({
            type: 'restorePresetDeviceChain',
            payload: { trackId: track.id, expectedBefore: runtimeGraphTopology.createNode(track), expectedFrozen: false, replacementDevices: [instrument, eq('replacement-eq')] },
        })).resolves.toBeUndefined();
        expect(currentTrack().devices.map((device) => device.id)).toEqual(['synth', 'replacement-eq']);
        expect(liveIds()).toEqual(['replacement-eq']);
        const replacement = audioEngine.getTrackStrip(track.id)?.deviceNodes[0];
        expect(replacement?.nodes).toHaveLength(3);
        expect(replacement?.nodes[0]).toHaveProperty('gain.value', 2);
        expect(replacement).not.toBe(oldNodes?.[0]);
        expect(removed.mock.calls.map(([payload]) => payload.deviceId)).toEqual(['eq', 'comp']);
        expect(vi.mocked(mirrorDeviceChainDelta).mock.calls.at(-1)?.[0].after.devices.map((device) => device.id)).toEqual(['synth', 'replacement-eq']);
    });
});


function publishAfter(after: Track, bus: Track): void {
    trackStore.set({ tracks: [after, bus], selectedTrackId: after.id });
    flushAutomergeStorageWrites();
}

function outputDelta(track: Track, bus: Track) {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision: audioEngine.getRuntimeGraphRevision(), projectRevision: captureProjectRevision() },
        nodes: [runtimeGraphTopology.createNode(track), runtimeGraphTopology.createNode(bus)],
        edges: [{ kind: 'output', sourceId: track.id, targetId: bus.id }],
        parameters: [],
    };
}

describe('persistent runtime identity and failure boundaries', () => {
    it.each(['id', 'type', 'parameters', 'instance', 'target parameters'] as const)(
        'refuses a real live %s mismatch before changing output', (mismatch) => {
            const { track, bus } = warmProject();
            const strip = audioEngine.getTrackStrip(mismatch === 'target parameters' ? bus.id : track.id);
            const device = strip?.deviceNodes[0];
            if (!device) {
                throw new Error('Expected the real persistent node for the mismatch fixture');
            }
            if (mismatch === 'id') {
                device.deviceId = 'foreign-eq';
            } else if (mismatch === 'type') {
                device.type = 'builtin-filter';
            } else if (mismatch === 'instance') {
                device.externalInstanceId = 'foreign-instance';
            } else {
                device.parameterIds = ['foreign-parameter'];
            }
            const source = audioEngine.getTrackStrip(track.id);
            const destination = audioEngine.getTrackStrip(bus.id);
            expect(audioEngine.applyRuntimeGraphDelta(outputDelta(track, bus))).toMatchObject({ acceptance: 'rejected', application: 'not-applied', reason: expect.stringContaining('does not match') });
            expect(source?.outputId).toBe('master');
            expect(audio.edges.get(source!.carrierGate)?.has(destination!.gainNode)).toBe(false);
        }
    );

    it.each(['runtime', 'project', 'topology', 'duplicate owner', 'ABA'] as const)(
        'retains %s output authority instead of letting projection discharge a stale delta', (state) => {
            const { track, bus } = warmProject();
            const delta = outputDelta(track, bus);
            if (state === 'runtime') {
                audioEngine.ensureTrackStrip('another');
            } else if (state === 'project') {
                createCrdtDoc('revision-change');
            } else if (state === 'topology') {
                publishAfter({ ...track, devices: track.devices.slice(0, 2) }, bus);
            } else if (state === 'duplicate owner') {
                trackStore.set({ tracks: [track, bus, { ...track, name: 'Duplicate owner' }], selectedTrackId: null });
                flushAutomergeStorageWrites();
            } else {
                const oldStrip = audioEngine.getTrackStrip(track.id);
                audioEngine.removeTrackStrip(track.id);
                expect(projectTrackToLiveStrip({ trackId: track.id })).toMatchObject({ acceptance: 'accepted', application: 'applied' });
                expect(audioEngine.getTrackStrip(track.id)).not.toBe(oldStrip);
            }
            expect(audioEngine.applyRuntimeGraphDelta(delta)).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
            expect(audioEngine.getTrackStrip(track.id)?.outputId).toBe('master');
        }
    );

    it('does not announce a retained device id as removed when replacement rebuilds its physical node', () => {
        const { track, bus, instrument } = warmProject();
        const oldEq = audioEngine.getTrackStrip(track.id)?.deviceNodes[0];
        const after = { ...track, devices: [instrument, eq('eq')] };
        publishAfter(after, bus);
        expect(applyDeviceChainRuntimeDelta({ before: track, after, operation: 'replace-device-chain' })).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        expect(liveIds()).toEqual(['eq']);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes[0]).not.toBe(oldEq);
        expect(removed.mock.calls.map(([payload]) => payload.deviceId)).toEqual(['comp']);
        expect(vi.mocked(mirrorDeviceChainDelta).mock.calls.at(-1)?.[0].after.devices.map((device) => device.id)).toEqual(['synth', 'eq']);
    });

    it.each(['unknown device', 'physical constructor failure'] as const)(
        'reports actual partial replacement for %s and withholds the native mirror', (failure) => {
            const { track, bus, instrument } = warmProject();
            let replacement = eq('replacement-eq');
            if (failure === 'unknown device') {
                replacement = { ...replacement, type: 'unregistered-physical-device' };
            } else {
                vi.spyOn(audio.context, 'createBiquadFilter').mockImplementationOnce(() => {
                    throw new Error('Physical Biquad constructor rejected');
                });
            }
            const after = { ...track, devices: [instrument, replacement] };
            publishAfter(after, bus);
            expect(applyDeviceChainRuntimeDelta({ before: track, after, operation: 'replace-device-chain' })).toMatchObject({ acceptance: 'accepted', application: 'needs-reconcile', reason: expect.stringContaining('partially changed') });
            expect(currentTrack().devices.map((device) => device.id)).toEqual(['synth', 'replacement-eq']);
            expect(liveIds()).toEqual([]);
            expect(removed.mock.calls.map(([payload]) => payload.deviceId)).toEqual(['eq', 'comp']);
            expect(mirrorDeviceChainDelta).not.toHaveBeenCalled();
        }
    );

    it('keeps instrument-only Web Audio discharge while forwarding the complete native chain', () => {
        const { track, bus, instrument } = warmProject();
        const drum: Device = { ...instrument, id: 'drum', type: 'builtin-drum-kit', name: 'Drums' };
        const after = { ...track, devices: [instrument, drum, ...track.devices.slice(1)] };
        publishAfter(after, bus);
        const writer = vi.spyOn(audioEngine, 'applyRuntimeGraphDelta');
        expect(applyDeviceChainRuntimeDelta({ before: track, after, operation: 'add-device' })).toMatchObject({ acceptance: 'superseded', application: 'discharged' });
        expect(writer).not.toHaveBeenCalled();
        expect(liveIds()).toEqual(['eq', 'comp']);
        expect(vi.mocked(mirrorDeviceChainDelta).mock.calls.at(-1)?.[0].after.devices.map((device) => device.id)).toEqual(['synth', 'drum', 'eq', 'comp']);
    });
});
