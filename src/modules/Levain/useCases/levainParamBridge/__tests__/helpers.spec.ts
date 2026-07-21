import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../../stores/levainStore';
import { createLevainBridge, type LevainDevice } from '../helpers';

// ---------------------------------------------------------------------------
// createLevainBridge — engine forwarding behaviour
// ---------------------------------------------------------------------------

type AutoLoad = (deviceId: string, port: MessagePort, instrumentId: string, signal?: AbortSignal) => Promise<void>;

function makeDeps(autoLoad: AutoLoad = vi.fn(() => Promise.resolve())) {
    return {
        getAllTracks: vi.fn(() => []),
        persistDeviceParam: vi.fn(),
        autoLoadLevainSamples: vi.fn(autoLoad) as unknown as AutoLoad & ReturnType<typeof vi.fn>,
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string) => ({
            status: 'eligible' as const,
            trackId: 'track-1',
            deviceId,
        })),
    };
}

type MockedLevainDevice = {
    setParam: Mock<LevainDevice['setParam']>;
    handleCc: Mock<LevainDevice['handleCc']>;
    setInstrument: Mock<NonNullable<LevainDevice['setInstrument']>>;
};

function makeDevice(): MockedLevainDevice {
    return {
        setParam: vi.fn<LevainDevice['setParam']>(),
        handleCc: vi.fn<LevainDevice['handleCc']>(),
        setInstrument: vi.fn<NonNullable<LevainDevice['setInstrument']>>(),
    };
}

function seedDevice(deviceId: string): void {
    levainStore.set({
        [deviceId]: { ...defaultLevainState, patch: createDefaultPatch('violin-1') },
    });
}

describe('createLevainBridge', () => {
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        levainStore.set({});
        rafCallbacks = [];
        // Run the rAF batcher synchronously on demand so we can flush queued params.
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function flushRaf(): void {
        const pending = rafCallbacks;
        rafCallbacks = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    describe('fix 1 — register-time vibrato uses the cents slot, not the CC slot', () => {
        // vibratoDepthMax is in cents (default 40). The CC-scaled slot
        // 'vibrato_depth' would saturate it to ~2x; the runtime panel path sends
        // 'expression_vibrato_depth_max'. Register-time must match that key.
        it('forwards vibratoDepthMax to expression_vibrato_depth_max', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const port = {} as MessagePort;

            bridge.registerLevainDevice('d1', makeDevice(), port);
            flushRaf();

            const cents = createDefaultPatch('violin-1').expression.vibratoDepthMax;
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'expression_vibrato_depth_max', cents);
            expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'vibrato_depth', expect.anything());
        });
    });

    describe('fix 5 — Space macro drives the room mic (index 2)', () => {
        it('writes mic_2_volume, not mic_1_volume, for the Space macro', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            bridge.registerLevainDevice('d1', device, {} as MessagePort);
            device.setParam.mockClear();

            // 'Space' is macro index 4 in the default labels.
            bridge.setMacroWithAudio('d1', 4, 0.7);

            expect(device.setParam).toHaveBeenCalledWith('mic_2_volume', 0.7);
            expect(device.setParam).not.toHaveBeenCalledWith('mic_1_volume', expect.any(Number));
        });
    });

    describe('setLevainParamWithAudio — nested patch forwarding', () => {
        it('should forward nested number and boolean fields to engine params', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            bridge.registerLevainDevice('d1', device, {} as MessagePort);
            flushRaf();
            deps.persistDeviceParam.mockClear();
            device.setParam.mockClear();

            const legato = {
                ...createDefaultPatch('violin-1').legato,
                enabled: false,
                slowThresholdMs: 275,
            };

            bridge.setLevainParamWithAudio('d1', 'legato', legato);

            expect(levainStore.value?.d1?.patch.legato).toEqual(legato);
            expect(deps.persistDeviceParam).not.toHaveBeenCalled();

            flushRaf();

            expect(device.setParam).toHaveBeenCalledWith('legato_enabled', 0);
            expect(device.setParam).toHaveBeenCalledWith('legato_slow_threshold_ms', 275);
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'legato_enabled', 0);
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'legato_slow_threshold_ms', 275);
        });
    });

    describe('fix 2 — a newer load supersedes the previous one', () => {
        it('aborts the in-flight load when a new load for the same device starts', () => {
            const signals: (AbortSignal | undefined)[] = [];
            function autoLoad(
                _deviceId: string,
                _port: MessagePort,
                _instrumentId: string,
                signal?: AbortSignal
            ): Promise<void> {
                signals.push(signal);
                return new Promise<void>(() => {
                    // never resolves — simulates a long-running load
                });
            }
            const deps = makeDeps(autoLoad);
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            bridge.registerLevainDevice('d1', device, {} as MessagePort);

            // First load handed out by registration; start a second.
            bridge.loadSamplesForInstrument('d1', 'cello');

            expect(signals.length).toBeGreaterThanOrEqual(2);
            const first = signals[0];
            const second = signals[signals.length - 1];
            expect(first?.aborted).toBe(true);
            expect(second?.aborted).toBe(false);
        });

        it('aborts the in-flight load on unregister', () => {
            const signals: (AbortSignal | undefined)[] = [];
            function autoLoad(
                _deviceId: string,
                _port: MessagePort,
                _instrumentId: string,
                signal?: AbortSignal
            ): Promise<void> {
                signals.push(signal);
                return new Promise<void>(() => {});
            }
            const deps = makeDeps(autoLoad);
            const bridge = createLevainBridge(deps);
            bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            expect(signals[0]?.aborted).toBe(false);
            bridge.unregisterLevainDevice('d1');
            expect(signals[0]?.aborted).toBe(true);
        });
    });

    describe('fix — teardown cancels pending rAF batches before they persist', () => {
        it('does not persist a queued param after the device is unregistered', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            bridge.registerLevainDevice('d1', device, {} as MessagePort);
            // Drain the register-time batched params so the assertion below only
            // sees the post-register write we schedule next.
            flushRaf();
            deps.persistDeviceParam.mockClear();

            // Schedule a param (e.g. dragging the master-gain fader), then tear
            // the device down in the same frame before the rAF fires.
            bridge.setLevainParamWithAudio('d1', 'masterGain', 0.42);
            expect(paramBatcherHasPending(rafCallbacks)).toBe(true);
            bridge.unregisterLevainDevice('d1');

            // The rAF still fires — its entry must have been cancelled so the
            // post-teardown flush never reaches persistDeviceParam.
            flushRaf();

            expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'master_gain', 0.42);
            expect(deps.persistDeviceParam).not.toHaveBeenCalled();
        });
    });
});

function paramBatcherHasPending(rafCallbacks: FrameRequestCallback[]): boolean {
    return rafCallbacks.length > 0;
}
