import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { DROPOUT_IDX, dropoutCounters } from '../../engine/dropoutCounter';
import { createAudioEngine } from '../createWebAudioEngine';

import type { AdjustmentLayerTickInput, AudioEngine, BuiltinDeviceNode } from '../../models/AudioEngineState';

const runtimeMocks = vi.hoisted(() => ({
    applyTick: vi.fn(),
    reset: vi.fn(),
    listLiveBusKeys: vi.fn(() => ['adj:t1']),
}));

const trackNodeInstances = vi.hoisted(
    () => [] as Array<{ trackId: string; mocks: Record<string, (...args: unknown[]) => void> }>
);

vi.mock('../../engine/AdjustmentLayerRuntime', () => ({
    createAdjustmentLayerRuntime: vi.fn(() => ({
        applyTick: runtimeMocks.applyTick,
        reset: runtimeMocks.reset,
        listLiveBusKeys: runtimeMocks.listLiveBusKeys,
    })),
}));

// Rich TrackNode double: records every delegated call so the engine's routing
// of public API → strip method is observable per method and argument list.
vi.mock('../../engine/TrackNode', () => ({
    TrackNode: class {
        trackId: string;
        strip: {
            trackId: string;
            preFaderTap: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
            analyserNode: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
            meterNode: null;
            deviceNodes: unknown[];
        };
        mocks: Record<string, (...args: unknown[]) => void>;

        constructor(id: string) {
            this.trackId = id;
            this.strip = {
                trackId: id,
                preFaderTap: { connect: vi.fn(), disconnect: vi.fn() },
                analyserNode: { connect: vi.fn(), disconnect: vi.fn() },
                meterNode: null,
                deviceNodes: [],
            };
            this.mocks = {
                setGain: vi.fn<(...args: unknown[]) => void>(),
                setPan: vi.fn<(...args: unknown[]) => void>(),
                setMute: vi.fn<(...args: unknown[]) => void>(),
                getPeakLevel: vi.fn<(...args: unknown[]) => void>(),
                setOutput: vi.fn<(...args: unknown[]) => void>(),
                addDevice: vi.fn<(...args: unknown[]) => void>(),
                removeDevice: vi.fn<(...args: unknown[]) => void>(),
                updateParam: vi.fn<(...args: unknown[]) => void>(),
                updatePatch: vi.fn<(...args: unknown[]) => void>(),
                scheduleParam: vi.fn<(...args: unknown[]) => void>(),
                scheduleDeviceKeyOn: vi.fn<(...args: unknown[]) => void>(),
                scheduleDeviceKeyOff: vi.fn<(...args: unknown[]) => void>(),
                updateBypass: vi.fn<(...args: unknown[]) => void>(),
                addMidiFx: vi.fn<(...args: unknown[]) => void>(),
                removeMidiFx: vi.fn<(...args: unknown[]) => void>(),
                updateMidiFxParam: vi.fn<(...args: unknown[]) => void>(),
                updateMidiFxBypass: vi.fn<(...args: unknown[]) => void>(),
                registerTuningTable: vi.fn<(...args: unknown[]) => void>(),
                dispose: vi.fn<(...args: unknown[]) => void>(),
            };
            trackNodeInstances.push({ trackId: id, mocks: this.mocks });
        }

        setGain(...args: unknown[]) {
            this.mocks.setGain!(...args);
        }
        setPan(...args: unknown[]) {
            this.mocks.setPan!(...args);
        }
        setMute(...args: unknown[]) {
            this.mocks.setMute!(...args);
        }
        getPeakLevel(): number {
            this.mocks.getPeakLevel!();
            return 0.5;
        }
        getDeviceLoadState(deviceId: string): 'ready' | 'pending' | 'failed' {
            const device = this.strip.deviceNodes.find(
                (candidate) => (candidate as { deviceId?: string }).deviceId === deviceId
            ) as { diagnosticLoadState?: 'ready' | 'pending' | 'failed' } | undefined;
            return device?.diagnosticLoadState ?? 'ready';
        }
        setOutput(...args: unknown[]) {
            this.mocks.setOutput!(...args);
        }
        addDevice(...args: unknown[]) {
            this.mocks.addDevice!(...args);
        }
        removeDevice(...args: unknown[]) {
            this.mocks.removeDevice!(...args);
        }
        updateParam(...args: unknown[]) {
            this.mocks.updateParam!(...args);
        }
        updatePatch(...args: unknown[]) {
            this.mocks.updatePatch!(...args);
        }
        scheduleParam(...args: unknown[]) {
            this.mocks.scheduleParam!(...args);
        }
        scheduleDeviceKeyOn(...args: unknown[]) {
            this.mocks.scheduleDeviceKeyOn!(...args);
        }
        scheduleDeviceKeyOff(...args: unknown[]) {
            this.mocks.scheduleDeviceKeyOff!(...args);
        }
        updateBypass(...args: unknown[]) {
            this.mocks.updateBypass!(...args);
        }
        addMidiFx(...args: unknown[]) {
            this.mocks.addMidiFx!(...args);
        }
        removeMidiFx(...args: unknown[]) {
            this.mocks.removeMidiFx!(...args);
        }
        updateMidiFxParam(...args: unknown[]) {
            this.mocks.updateMidiFxParam!(...args);
        }
        updateMidiFxBypass(...args: unknown[]) {
            this.mocks.updateMidiFxBypass!(...args);
        }
        registerTuningTable(...args: unknown[]) {
            this.mocks.registerTuningTable!(...args);
        }
        dispose() {
            this.mocks.dispose!();
        }
    },
}));

vi.mock('../../engine/BusNode', () => ({
    BusNode: class {
        busId: string;
        strip: { busId: string; gainNode: { connect: ReturnType<typeof vi.fn> } };
        dispose = vi.fn();
        setGain = vi.fn();
        getPeakLevel = vi.fn().mockReturnValue(0.3);
        constructor(id: string) {
            this.busId = id;
            this.strip = { busId: id, gainNode: { connect: vi.fn() } };
        }
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

function asAudioContext(ctx: MockAudioContext): AudioContext {
    return ctx as unknown as AudioContext;
}

type DiagnosticTestDevice = BuiltinDeviceNode & {
    diagnosticLoadState?: 'ready' | 'pending' | 'failed';
};

type DiagnosticDeviceInput = {
    context: MockAudioContext;
    deviceId: string;
    deviceType: string;
    nodeCount?: number;
    loadState?: DiagnosticTestDevice['diagnosticLoadState'];
};

function createDiagnosticDevice(input: DiagnosticDeviceInput): DiagnosticTestDevice {
    const nodes = Array.from({ length: input.nodeCount ?? 1 }, () => input.context.createGain());
    const device: DiagnosticTestDevice = {
        deviceId: input.deviceId,
        type: input.deviceType,
        nodes,
        inputNode: nodes[0]!,
        outputNode: nodes.at(-1)!,
    };
    if (input.loadState && input.loadState !== 'ready') {
        device.controller = {
            ready: false,
            setParam: vi.fn(),
        };
        device.diagnosticLoadState = input.loadState;
    }
    return device;
}

function trackMocks(trackId: string): Record<string, (...args: unknown[]) => void> {
    const instance = trackNodeInstances.find((candidate) => candidate.trackId === trackId);
    if (!instance) {
        throw new Error(`expected a TrackNode instance for ${trackId}`);
    }
    return instance.mocks;
}

describe('AudioEngine — public API delegation and lifecycle', () => {
    let engine: AudioEngine;
    let mockCtx: MockAudioContext;

    class FakeWorkletNode {
        port = { postMessage: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        runtimeMocks.listLiveBusKeys.mockReturnValue(['adj:t1']);
        runtimeMocks.reset.mockImplementation(() => {
            runtimeMocks.listLiveBusKeys.mockReturnValue([]);
        });
        trackNodeInstances.length = 0;
        mockCtx = createMockAudioContext();
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );
        engine = createAudioEngine(asAudioContext(mockCtx));
        // The dropout counters are a process-wide singleton backed by one SAB —
        // clear the tally so specs do not inherit each other's counts.
        dropoutCounters.reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getHealth starts clean: worklets not ready, no init or resume errors, no dropouts', () => {
        expect(engine.getHealth()).toEqual({
            workletReady: false,
            lastInitError: null,
            lastResumeError: null,
            // Audit RT-10 — runtime dropout tally, zero before anything renders.
            dropouts: { detectedUnderrunBlocks: 0, silentFrames: 0, lastUnderrunAtFrame: 0 },
        });
    });

    it('getHealth reports the dropout tally the render thread wrote to the shared counters', () => {
        // Stand in for the worklet: write the shared SAB the same way
        // grandBouleProcessor does on a detected ring-buffer underrun.
        const workletView = new Int32Array(dropoutCounters.getSab()!);
        Atomics.add(workletView, DROPOUT_IDX.detectedUnderrunBlocks, 2);
        Atomics.add(workletView, DROPOUT_IDX.silentFrames, 256);
        Atomics.store(workletView, DROPOUT_IDX.lastUnderrunAtFrame, 9_600);

        // Read through the health surface — no message round-trip, no polling.
        expect(engine.getHealth().dropouts).toEqual({
            detectedUnderrunBlocks: 2,
            silentFrames: 256,
            lastUnderrunAtFrame: 9_600,
        });

        dropoutCounters.reset();
        expect(engine.getHealth().dropouts.detectedUnderrunBlocks).toBe(0);
    });

    it('reports the live graph and runtime load without touching the render path', async () => {
        const expectedCtx = { state: 'running' as const, sampleRate: 48_000, baseLatency: 0.01, outputLatency: 0.01 };
        const emptyGraph = {
            trackStrips: 0,
            busStrips: 0,
            sends: 0,
            sidechains: 0,
            deviceInstances: 0,
            pendingDeviceInstances: 0,
            failedDeviceInstances: 0,
            deviceInstancesByType: {},
            deviceAudioNodes: 0,
            stripMeterWorklets: 0,
            masterMeterWorklets: 0,
            adjustmentLayerBuses: 1,
        };
        expect(engine.getDiagnostics()).toEqual({
            context: expectedCtx,
            graph: emptyGraph,
            runtime: { trackedAudioScheduledSources: 0 },
        });

        await engine.initialize();
        const track = engine.ensureTrackStrip('t1');
        const busTrack = engine.ensureTrackStrip('bus-1');
        engine.ensureBusStrip('bus-1');
        engine.setSend('t1', 'bus-1', 0.5, false);

        track.meterNode = new FakeWorkletNode() as unknown as AudioWorkletNode;
        busTrack.meterNode = null;
        function createDevice(input: Omit<DiagnosticDeviceInput, 'context'>): DiagnosticTestDevice {
            return createDiagnosticDevice({ context: mockCtx, ...input });
        }
        const fermenter = createDevice({ deviceId: 'fermenter-1', deviceType: 'fermenter' });
        const bacteria = createDevice({ deviceId: 'bacteria-1', deviceType: 'bacteria', nodeCount: 2 });
        const sidechain = createDevice({
            deviceId: 'sidechain-1',
            deviceType: 'builtin-sidechain-compressor',
        });
        const pending = createDevice({ deviceId: 'pending-1', deviceType: 'levain', loadState: 'pending' });
        const failed = createDevice({ deviceId: 'failed-1', deviceType: 'grand-boule', loadState: 'failed' });
        track.deviceNodes.push(fermenter, bacteria, pending, failed);
        busTrack.deviceNodes.push(sidechain);
        engine.wireSidechainRoute('t1', 'bus-1', 'sidechain-1');
        engine.registerScheduledSource(mockCtx.createOscillator());

        expect(engine.getDiagnostics()).toEqual({
            context: expectedCtx,
            graph: {
                trackStrips: 1,
                busStrips: 1,
                sends: 1,
                sidechains: 1,
                deviceInstances: 3,
                pendingDeviceInstances: 1,
                failedDeviceInstances: 1,
                deviceInstancesByType: {
                    bacteria: 1,
                    'builtin-sidechain-compressor': 1,
                    fermenter: 1,
                },
                deviceAudioNodes: 4,
                stripMeterWorklets: 1,
                masterMeterWorklets: 1,
                adjustmentLayerBuses: 1,
            },
            runtime: { trackedAudioScheduledSources: 1 },
        });

        engine.resetGraph();
        expect(engine.getDiagnostics()).toEqual({
            context: expectedCtx,
            graph: {
                ...emptyGraph,
                masterMeterWorklets: 1,
                adjustmentLayerBuses: 0,
            },
            runtime: { trackedAudioScheduledSources: 0 },
        });

        await engine.dispose();
        expect(engine.getDiagnostics().graph.masterMeterWorklets).toBe(0);
    });

    it('suspend suspends a running context and skips an already-suspended one', async () => {
        mockCtx.state = 'running';
        await engine.suspend();
        expect(mockCtx.suspend).toHaveBeenCalledTimes(1);

        mockCtx.state = 'suspended';
        await engine.suspend();
        expect(mockCtx.suspend).toHaveBeenCalledTimes(1);
    });

    it('suspend swallows a context suspension failure instead of rejecting', async () => {
        mockCtx.state = 'running';
        mockCtx.suspend.mockRejectedValueOnce(new Error('device lost'));

        await expect(engine.suspend()).resolves.toBeUndefined();
    });

    it('getState reflects the live context values', () => {
        engine.masterGainNode.gain.value = 0.8;

        expect(engine.getState()).toEqual({
            isReady: true,
            sampleRate: 48_000,
            state: 'running',
            masterGain: 0.8,
            currentTime: 0,
            baseLatency: 0.01,
        });
    });

    it('forwards track gain/pan/peak to the strip node and defaults peak to 0 without one', () => {
        expect(() => engine.setTrackGain('ghost', 0.5)).not.toThrow();
        expect(engine.getTrackPeakLevel('ghost')).toBe(0);

        engine.ensureTrackStrip('t1');
        engine.setTrackGain('t1', 0.7);
        engine.setTrackPan('t1', -25);

        expect(trackMocks('t1').setGain).toHaveBeenCalledWith(0.7);
        expect(trackMocks('t1').setPan).toHaveBeenCalledWith(-25);
        expect(engine.getTrackPeakLevel('t1')).toBe(0.5);
    });

    it('setTrackMute creates the strip on demand before muting it', () => {
        engine.setTrackMute('t-new', true);

        expect(trackMocks('t-new').setMute).toHaveBeenCalledWith(true);
    });

    it('caches bus strips, forwards bus gain, and reads bus peaks with a 0 fallback', () => {
        const strip = engine.ensureBusStrip('bus-1');
        expect(engine.ensureBusStrip('bus-1')).toBe(strip);
        expect(strip.gainNode.connect).not.toHaveBeenCalled();

        engine.setBusGain('bus-1', 0.6);
        expect(engine.getBusPeakLevel('bus-1')).toBe(0.3);
        expect(engine.getBusPeakLevel('missing')).toBe(0);
    });

    it('removeBusStrip disposes the bus and sweeps sends that fed it', () => {
        engine.ensureTrackStrip('t1');
        engine.ensureBusStrip('bus-1');
        engine.setSend('t1', 'bus-1', 0.5, false);
        const sendGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: ReturnType<typeof vi.fn> };

        engine.removeBusStrip('bus-1');

        expect(sendGain.disconnect).toHaveBeenCalled();
        // The bus is gone: peak reads fall back to 0 and a fresh ensure builds anew.
        expect(engine.getBusPeakLevel('bus-1')).toBe(0);
    });

    it('routes device lifecycle and parameter calls through the owning strip', () => {
        engine.addDeviceToStrip('t1', 'dev-1', 'levain', 'inst-9');
        expect(trackMocks('t1').addDevice).toHaveBeenCalledWith('dev-1', 'levain', 'inst-9');

        engine.updateDeviceParam('t1', 'dev-1', 'cutoff', 0.3);
        expect(trackMocks('t1').updateParam).toHaveBeenCalledWith('dev-1', 'cutoff', 0.3);

        engine.updateDevicePatch('t1', 'dev-1', { osc: 'saw' });
        expect(trackMocks('t1').updatePatch).toHaveBeenCalledWith('dev-1', { osc: 'saw' });

        engine.scheduleDeviceParam('t1', 'dev-1', 'cutoff', 0.9, 1.25);
        expect(trackMocks('t1').scheduleParam).toHaveBeenCalledWith('dev-1', 'cutoff', 0.9, 1.25);

        engine.scheduleDeviceKeyOn('t1', 'dev-1', 60, 100, 0.5);
        expect(trackMocks('t1').scheduleDeviceKeyOn).toHaveBeenCalledWith('dev-1', 60, 100, 0.5);

        engine.scheduleDeviceKeyOff('t1', 'dev-1', 60, 0, 1.5);
        expect(trackMocks('t1').scheduleDeviceKeyOff).toHaveBeenCalledWith('dev-1', 60, 0, 1.5);

        engine.updateDeviceBypass('t1', 'dev-1', true);
        expect(trackMocks('t1').updateBypass).toHaveBeenCalledWith('dev-1', true);

        engine.removeDeviceFromStrip('t1', 'dev-1');
        expect(trackMocks('t1').removeDevice).toHaveBeenCalledWith('dev-1');
    });

    it('routes MIDI-FX calls through the owning strip', () => {
        engine.ensureTrackStrip('t1');

        engine.addMidiFxToStrip('t1', 'fx-1', 'arp');
        expect(trackMocks('t1').addMidiFx).toHaveBeenCalledWith('fx-1', 'arp');

        engine.updateMidiFxParam('t1', 'fx-1', 'rate', 4);
        expect(trackMocks('t1').updateMidiFxParam).toHaveBeenCalledWith('fx-1', 'rate', 4);

        engine.updateMidiFxBypass('t1', 'fx-1', true);
        expect(trackMocks('t1').updateMidiFxBypass).toHaveBeenCalledWith('fx-1', true);

        engine.removeMidiFxFromStrip('t1', 'fx-1');
        expect(trackMocks('t1').removeMidiFx).toHaveBeenCalledWith('fx-1');
    });

    it('syncKneadState updates only devices exposing knead controls', () => {
        engine.ensureTrackStrip('t1');
        const updateState = vi.fn();
        const strip = engine.getTrackStrip('t1')!;
        strip.deviceNodes.push(
            { deviceId: 'knead-1', type: 'knead', kneadControls: { updateState } } as never,
            { deviceId: 'other', type: 'levain' } as never
        );

        engine.syncKneadState('t1', { 'clip-1': { shift: 2 } });

        expect(updateState).toHaveBeenCalledWith({ 'clip-1': { shift: 2 } });
    });

    it('fans the tuning table out to every live track strip', () => {
        engine.ensureTrackStrip('t1');
        engine.ensureTrackStrip('t2');

        engine.registerTuningTable([440, 466.16]);

        expect(trackMocks('t1').registerTuningTable).toHaveBeenCalledWith([440, 466.16]);
        expect(trackMocks('t2').registerTuningTable).toHaveBeenCalledWith([440, 466.16]);
    });

    it('setTrackOutput forwards the routing target to the strip', () => {
        engine.ensureTrackStrip('t1');

        engine.setTrackOutput('t1', 'bus-1');

        expect(trackMocks('t1').setOutput).toHaveBeenCalledWith('bus-1');
    });

    it('schedules a metronome oscillator with an attack/decay envelope into the master bus', () => {
        engine.scheduleOscillator(880, 1.0, 0.05, 0.3);

        const osc = mockCtx.createOscillator.mock.results[0]!.value;
        const env = mockCtx.createGain.mock.results.at(-1)!.value;
        expect(osc.frequency.value).toBe(880);
        expect(env.gain.setValueAtTime).toHaveBeenCalledWith(0, 1.0);
        expect(env.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.3, 1.005);
        expect(env.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 1.05);
        expect(osc.connect).toHaveBeenCalledWith(env);
        expect(env.connect).toHaveBeenCalledWith(engine.masterGainNode);
        expect(osc.start).toHaveBeenCalledWith(1.0);
        expect(osc.stop).toHaveBeenCalledWith(1.05);
    });

    it('scheduleClick maps accent to the bright short click and scales its volume', () => {
        engine.scheduleClick(2.0, true, 0.5);

        const osc = mockCtx.createOscillator.mock.results[0]!.value;
        const env = mockCtx.createGain.mock.results.at(-1)!.value;
        expect(osc.frequency.value).toBe(1500);
        // accent baseVol 0.4 × volume 0.5 = 0.2 at the envelope peak.
        expect(env.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 2.005);
        expect(osc.stop).toHaveBeenCalledWith(2.04);
    });

    it('stopAllScheduled stops queued oscillators at the current time and empties the queue', () => {
        engine.scheduleOscillator(440, 0.5, 1.0);
        const osc = mockCtx.createOscillator.mock.results[0]!.value;
        osc.stop.mockClear();

        engine.stopAllScheduled();
        expect(osc.stop).toHaveBeenCalledWith(mockCtx.currentTime);

        osc.stop.mockClear();
        engine.stopAllScheduled();
        expect(osc.stop).not.toHaveBeenCalled();
    });

    it('adjustment layer methods delegate to the runtime', () => {
        const records: AdjustmentLayerTickInput[] = [
            { trackId: 't1', layerId: 'l1', effectType: 'eq', parameters: {}, blend: 1 },
        ];
        engine.applyAdjustmentLayerTick?.(records);
        expect(runtimeMocks.applyTick).toHaveBeenCalledWith(records);

        engine.resetAdjustmentLayers?.();
        expect(runtimeMocks.reset).toHaveBeenCalledTimes(1);

        expect(engine.listLiveAdjustmentBusKeys?.()).toEqual([]);
    });

    it('resetGraph tears down tracks, buses, sends, and the adjustment runtime but keeps the context', () => {
        engine.ensureTrackStrip('t1');
        engine.ensureBusStrip('bus-1');
        engine.setSend('t1', 'bus-1', 0.5, false);
        const sendGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: ReturnType<typeof vi.fn> };

        engine.resetGraph();

        expect(engine.getTrackStrip('t1')).toBeUndefined();
        expect(trackMocks('t1').dispose).toHaveBeenCalledTimes(1);
        expect(sendGain.disconnect).toHaveBeenCalled();
        expect(runtimeMocks.reset).toHaveBeenCalled();
        expect(mockCtx.close).not.toHaveBeenCalled();

        // The engine remains usable for the next project.
        const strip = engine.ensureTrackStrip('t-next');
        expect(strip.trackId).toBe('t-next');
    });

    it('waitForDevices resolves immediately with no pending device loads', async () => {
        await expect(engine.waitForDevices()).resolves.toBeUndefined();
    });
});
