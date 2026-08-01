import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../../stores/levainStore';
import { createLevainBridge, type LevainDevice } from '../helpers';

// ---------------------------------------------------------------------------
// createLevainBridge — engine forwarding behaviour
// ---------------------------------------------------------------------------

type AutoLoad = (deviceId: string, port: MessagePort, instrumentId: string, signal?: AbortSignal) => Promise<void>;

function makeDeps(
    autoLoad: AutoLoad = vi.fn(() => Promise.resolve()),
    initialResolutionStatus: DeviceWriteTargetResolution['status'] = 'eligible'
) {
    let resolutionStatus = initialResolutionStatus;
    return {
        getAllTracks: vi.fn(() => []),
        persistDeviceParam: vi.fn(),
        autoLoadLevainSamples: vi.fn(autoLoad) as unknown as AutoLoad & ReturnType<typeof vi.fn>,
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string): DeviceWriteTargetResolution => {
            if (resolutionStatus !== 'eligible') {
                return { status: resolutionStatus };
            }

            return { status: 'eligible', trackId: 'track-1', deviceId };
        }),
        setResolutionStatus(status: DeviceWriteTargetResolution['status']): void {
            resolutionStatus = status;
        },
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

    describe('device write eligibility', () => {
        it.each(['missing', 'ineligible'] as const)(
            'rejects %s registration before registry, store, load, queue, or engine effects',
            (status) => {
                const deps = makeDeps(undefined, status);
                const bridge = createLevainBridge(deps);
                const device = makeDevice();

                bridge.registerLevainDevice('d1', device, {} as MessagePort);

                expect(levainStore.value).toEqual({});
                expect(deps.autoLoadLevainSamples).not.toHaveBeenCalled();
                expect(deps.persistDeviceParam).not.toHaveBeenCalled();
                expect(device.setInstrument).not.toHaveBeenCalled();
                expect(rafCallbacks).toEqual([]);

                deps.setResolutionStatus('eligible');
                bridge.sendMicParamToEngine('d1', 0, 'volume', 0.5);
                expect(device.setParam).not.toHaveBeenCalled();
            }
        );

        it.each(['missing', 'ineligible'] as const)(
            'rejects %s sample loading before instrument, cancellation, or async-load effects',
            (status) => {
                const signals: AbortSignal[] = [];
                const deps = makeDeps((_deviceId, _port, _instrumentId, signal) => {
                    if (signal) {
                        signals.push(signal);
                    }
                    return new Promise<void>(() => {
                        // Intentionally remains pending so cancellation is observable.
                    });
                });
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                bridge.registerLevainDevice('d1', device, {} as MessagePort);
                expect(signals).toHaveLength(1);
                deps.autoLoadLevainSamples.mockClear();
                device.setInstrument.mockClear();
                deps.setResolutionStatus(status);

                bridge.loadSamplesForInstrument('d1', 'cello');

                expect(device.setInstrument).not.toHaveBeenCalled();
                expect(deps.autoLoadLevainSamples).not.toHaveBeenCalled();
                expect(signals[0]?.aborted).toBe(false);
            }
        );

        it.each(['missing', 'ineligible'] as const)(
            'rejects %s granular parameter writes before store, queue, persistence, or engine effects',
            (status) => {
                const deps = makeDeps();
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                seedDevice('d1');
                bridge.registerLevainDevice('d1', device);
                const before = structuredClone(levainStore.value);
                deps.setResolutionStatus(status);

                bridge.setLevainParamWithAudio('d1', 'masterGain', 0.42);

                expect(levainStore.value).toEqual(before);
                expect(rafCallbacks).toEqual([]);
                expect(deps.persistDeviceParam).not.toHaveBeenCalled();
                expect(device.setParam).not.toHaveBeenCalled();
            }
        );

        it.each(['missing', 'ineligible'] as const)(
            'rejects %s macro writes before store or engine effects',
            (status) => {
                const deps = makeDeps();
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                seedDevice('d1');
                bridge.registerLevainDevice('d1', device);
                const before = structuredClone(levainStore.value);
                deps.setResolutionStatus(status);

                bridge.setMacroWithAudio('d1', 4, 0.7);

                expect(levainStore.value).toEqual(before);
                expect(device.handleCc).not.toHaveBeenCalled();
                expect(device.setParam).not.toHaveBeenCalled();
            }
        );

        it.each(['missing', 'ineligible'] as const)('rejects %s mic writes before engine effects', (status) => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            bridge.registerLevainDevice('d1', device);
            deps.setResolutionStatus(status);

            bridge.sendMicParamToEngine('d1', 2, 'volume', 0.5);

            expect(device.setParam).not.toHaveBeenCalled();
        });

        it.each(['missing', 'ineligible'] as const)(
            'keeps unregister cleanup independent when the owner becomes %s',
            (status) => {
                const signals: AbortSignal[] = [];
                const deps = makeDeps((_deviceId, _port, _instrumentId, signal) => {
                    if (signal) {
                        signals.push(signal);
                    }
                    return new Promise<void>(() => {
                        // Intentionally remains pending so unregister must abort it.
                    });
                });
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                seedDevice('d1');
                bridge.registerLevainDevice('d1', device, {} as MessagePort);
                flushRaf();
                deps.persistDeviceParam.mockClear();
                bridge.setLevainParamWithAudio('d1', 'masterGain', 0.42);
                deps.setResolutionStatus(status);
                deps.resolveEligibleDeviceWriteTarget.mockClear();

                bridge.unregisterLevainDevice('d1');
                flushRaf();

                expect(deps.resolveEligibleDeviceWriteTarget).not.toHaveBeenCalled();
                expect(signals[0]?.aborted).toBe(true);
                expect(levainStore.value).toEqual({});
                expect(deps.persistDeviceParam).not.toHaveBeenCalled();
            }
        );
    });

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
        it.each([
            ['spiccato', 7],
            ['staccato', 8],
            ['pizzicato', 10],
            ['tremolo', 13],
        ] as const)('forwards %s with its canonical DSP articulation id', (articulation, expectedId) => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            bridge.registerLevainDevice('d1', device);

            bridge.setLevainParamWithAudio('d1', 'currentArticulation', articulation);
            flushRaf();

            expect(levainStore.value?.d1?.patch.currentArticulation).toBe(articulation);
            expect(device.setParam).toHaveBeenCalledWith('current_articulation', expectedId);
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'current_articulation', expectedId);
        });

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
