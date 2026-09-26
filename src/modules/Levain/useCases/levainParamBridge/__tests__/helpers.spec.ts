import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { createDefaultPatch, type MicPositionType } from '../../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../../stores/levainStore';
import { projectLevainPatchToEngineParameters } from '../../projectLevainPatchToEngineParameters';
import { createLevainBridge, type LevainDevice } from '../helpers';

// ---------------------------------------------------------------------------
// createLevainBridge — engine forwarding behaviour
// ---------------------------------------------------------------------------

type AutoLoad = (
    deviceId: string,
    port: MessagePort,
    instrumentId: string,
    signal?: AbortSignal
) => Promise<readonly MicPositionType[] | null>;

function makeDeps(
    autoLoad: AutoLoad = vi.fn(() => Promise.resolve(null)),
    initialResolutionStatus: DeviceWriteTargetResolution['status'] = 'eligible'
) {
    let resolutionStatus = initialResolutionStatus;
    return {
        getAllTracks: vi.fn(() => []),
        persistDeviceParam: vi.fn(),
        writeNativeBuiltinParameters:
            vi.fn<(trackId: string, deviceId: string, values: Record<string, number>) => void>(),
        sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
        autoLoadLevainSamples: vi.fn(autoLoad) as unknown as AutoLoad & ReturnType<typeof vi.fn>,
        setLoadedMicPositions: vi.fn<(deviceId: string, positions: readonly MicPositionType[] | null) => void>(),
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
};

function makeDevice(): MockedLevainDevice {
    return {
        setParam: vi.fn<LevainDevice['setParam']>(),
        handleCc: vi.fn<LevainDevice['handleCc']>(),
    };
}

// Defaults to the default patch's own three-mic order so every existing test
// that doesn't care about Space/room resolution keeps resolving room to index
// 2 unchanged; only the Space-macro tests below override this explicitly.
function seedDevice(
    deviceId: string,
    loadedMicPositions: readonly MicPositionType[] | null = ['close', 'decca-tree', 'room']
): void {
    levainStore.set({
        [deviceId]: { ...defaultLevainState, patch: createDefaultPatch('violin-1'), loadedMicPositions },
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

                void bridge.registerLevainDevice('d1', device, {} as MessagePort);

                expect(levainStore.value).toEqual({});
                expect(deps.autoLoadLevainSamples).not.toHaveBeenCalled();
                expect(deps.persistDeviceParam).not.toHaveBeenCalled();
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
                    return new Promise<readonly MicPositionType[] | null>(() => {
                        // Intentionally remains pending so cancellation is observable.
                    });
                });
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                void bridge.registerLevainDevice('d1', device, {} as MessagePort);
                expect(signals).toHaveLength(1);
                deps.autoLoadLevainSamples.mockClear();
                deps.setResolutionStatus(status);

                void bridge.loadSamplesForInstrument('d1', 'cello');

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
                void bridge.registerLevainDevice('d1', device);
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
                void bridge.registerLevainDevice('d1', device);
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
            void bridge.registerLevainDevice('d1', device);
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
                    return new Promise<readonly MicPositionType[] | null>(() => {
                        // Intentionally remains pending so unregister must abort it.
                    });
                });
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                seedDevice('d1');
                void bridge.registerLevainDevice('d1', device, {} as MessagePort);
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

    describe('registration patch ordering', () => {
        it('applies the complete patch before loading samples without persisting initialization', () => {
            const device = makeDevice();
            let engineCallsWhenLoading: Parameters<LevainDevice['setParam']>[] = [];
            const deps = makeDeps(() => {
                engineCallsWhenLoading = [...device.setParam.mock.calls];
                return Promise.resolve(null);
            });
            const bridge = createLevainBridge(deps);
            const patch = createDefaultPatch('violin-1');

            void bridge.registerLevainDevice('d1', device, {} as MessagePort);

            expect(engineCallsWhenLoading).toEqual(
                projectLevainPatchToEngineParameters(patch).map(({ name, value }) => [name, value])
            );
            expect(deps.persistDeviceParam).not.toHaveBeenCalled();
            flushRaf();
            expect(deps.persistDeviceParam).not.toHaveBeenCalled();
        });
    });

    describe('fix 5 — Space macro resolves close/room by loaded position type, never a fixed index', () => {
        it('writes mic_2_volume, not mic_1_volume, when the loaded bank keeps room at index 2', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            device.setParam.mockClear();

            // 'Space' is macro index 4 in the default labels.
            bridge.setMacroWithAudio('d1', 4, 0.7);

            expect(device.setParam).toHaveBeenCalledWith('mic_2_volume', 0.7);
            expect(device.setParam).not.toHaveBeenCalledWith('mic_1_volume', expect.any(Number));
        });

        it('writes mic_0_volume and mic_1_volume when the loaded bank omits decca-tree', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1', ['close', 'room']);
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            device.setParam.mockClear();

            bridge.setMacroWithAudio('d1', 4, 0.6);

            expect(device.setParam).toHaveBeenCalledWith('mic_0_volume', expect.any(Number));
            expect(device.setParam).toHaveBeenCalledWith('mic_1_volume', 0.6);
            expect(device.setParam).not.toHaveBeenCalledWith('mic_2_volume', expect.any(Number));
        });

        it('writes Close on mic_1_volume and Room on mic_0_volume when the loaded bank orders room first', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1', ['room', 'close']);
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            device.setParam.mockClear();

            bridge.setMacroWithAudio('d1', 4, 0.6);

            // Room sits at index 0 here, Close at index 1 — the reverse of the
            // decca-tree-omitted case above — so each type's volume must still
            // follow its own loaded index, not the fixed index that case used.
            expect(device.setParam).toHaveBeenCalledWith('mic_1_volume', 0.7);
            expect(device.setParam).toHaveBeenCalledWith('mic_0_volume', 0.6);
        });

        it('writes no mic parameter when the loaded bank carries no room mic', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1', ['close']);
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            device.setParam.mockClear();

            bridge.setMacroWithAudio('d1', 4, 0.6);

            expect(device.setParam).not.toHaveBeenCalledWith(expect.stringMatching(/^mic_/), expect.any(Number));
        });
    });

    it('delivers the canonical DSP id without persisting duplicate articulation truth', () => {
        const deps = makeDeps();
        const bridge = createLevainBridge(deps);
        const device = makeDevice();
        const patch = { ...createDefaultPatch('violin-1'), currentArticulation: 'tremolo' as const };
        levainStore.set({ d1: { ...defaultLevainState, patch } });

        void bridge.registerLevainDevice('d1', device, {} as MessagePort);
        flushRaf();

        expect(device.setParam).toHaveBeenCalledWith('current_articulation', 13);
        expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'current_articulation', expect.any(Number));
        device.setParam.mockClear();
        deps.persistDeviceParam.mockClear();

        bridge.setLevainParamWithAudio('d1', 'currentArticulation', 'pizzicato');
        flushRaf();

        expect(device.setParam).toHaveBeenCalledWith('current_articulation', 10);
        expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'current_articulation', expect.any(Number));
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
            void bridge.registerLevainDevice('d1', device);

            bridge.setLevainParamWithAudio('d1', 'currentArticulation', articulation);
            flushRaf();

            expect(levainStore.value?.d1?.patch.currentArticulation).toBe(articulation);
            expect(device.setParam).toHaveBeenCalledWith('current_articulation', expectedId);
            expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'current_articulation', expect.any(Number));
        });

        it('should forward nested number and boolean fields to engine params', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
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
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'legatoEnabled', 0);
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'legatoSlowThresholdMs', 275);
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
            ): Promise<readonly MicPositionType[] | null> {
                signals.push(signal);
                return new Promise<readonly MicPositionType[] | null>(() => {
                    // never resolves — simulates a long-running load
                });
            }
            const deps = makeDeps(autoLoad);
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);

            // First load handed out by registration; start a second.
            void bridge.loadSamplesForInstrument('d1', 'cello');

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
            ): Promise<readonly MicPositionType[] | null> {
                signals.push(signal);
                return new Promise<readonly MicPositionType[] | null>(() => {});
            }
            const deps = makeDeps(autoLoad);
            const bridge = createLevainBridge(deps);
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            expect(signals[0]?.aborted).toBe(false);
            bridge.unregisterLevainDevice('d1');
            expect(signals[0]?.aborted).toBe(true);
        });

        it('settles registration from the successor when its initial bank load is superseded', async () => {
            const loads: PromiseWithResolvers<readonly MicPositionType[] | null>[] = [];
            const deps = makeDeps(() => {
                const load = Promise.withResolvers<readonly MicPositionType[] | null>();
                loads.push(load);
                return load.promise;
            });
            const bridge = createLevainBridge(deps);
            const registration = bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            const replacement = bridge.loadSamplesForInstrument('d1', 'cello');
            loads[1]?.resolve(null);

            await expect(registration).resolves.toBe('ready');
            await expect(replacement).resolves.toBe('ready');
        });
    });

    describe('loadedMicPositions — only loadSamplesForInstrument (the live route) writes it', () => {
        it('clears loadedMicPositions before invoking autoLoadLevainSamples', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();
            deps.autoLoadLevainSamples.mockClear();

            void bridge.loadSamplesForInstrument('d1', 'cello');

            expect(deps.setLoadedMicPositions).toHaveBeenCalledWith('d1', null);
            expect(deps.autoLoadLevainSamples).toHaveBeenCalledTimes(1);
            const clearOrder = deps.setLoadedMicPositions.mock.invocationCallOrder[0];
            const loadOrder = deps.autoLoadLevainSamples.mock.invocationCallOrder[0];
            expect(clearOrder).toBeLessThan(loadOrder as number);
        });

        it('sets loadedMicPositions to the resolved bank names on a successful load', async () => {
            const deps = makeDeps(() => Promise.resolve(['close', 'room']));
            const bridge = createLevainBridge(deps);
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();

            await bridge.loadSamplesForInstrument('d1', 'cello');

            expect(deps.setLoadedMicPositions).toHaveBeenCalledWith('d1', ['close', 'room']);
        });

        it('restores the previously committed names when a live load rejects', async () => {
            // 'close' is committed through an actual successful load (rather
            // than seeded directly into the store) so the bridge's own
            // committed-bank record — not the store's transient
            // `loadedMicPositions` — is what the rejection below restores from.
            const deps = makeDeps((_deviceId, _port, instrumentId) =>
                instrumentId === 'violin-1' ? Promise.resolve(['close']) : Promise.reject(new Error('boom'))
            );
            const bridge = createLevainBridge(deps);
            seedDevice('d1');
            await bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();

            await bridge.loadSamplesForInstrument('d1', 'cello');

            // Null during the load, then restored to the bank the engine kept
            // sounding once the rejection settles.
            expect(deps.setLoadedMicPositions).toHaveBeenNthCalledWith(1, 'd1', null);
            expect(deps.setLoadedMicPositions).toHaveBeenNthCalledWith(2, 'd1', ['close']);
        });

        it('stays null when no bank was committed and the load rejects', async () => {
            const deps = makeDeps(() => Promise.reject(new Error('boom')));
            const bridge = createLevainBridge(deps);
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();

            await bridge.loadSamplesForInstrument('d1', 'cello');

            expect(deps.setLoadedMicPositions).toHaveBeenCalledTimes(2);
            expect(deps.setLoadedMicPositions).toHaveBeenNthCalledWith(1, 'd1', null);
            expect(deps.setLoadedMicPositions).toHaveBeenNthCalledWith(2, 'd1', null);
        });

        it('writes nothing for a rejected load already superseded by another', async () => {
            const first = Promise.withResolvers<readonly MicPositionType[] | null>();
            const second = Promise.withResolvers<readonly MicPositionType[] | null>();
            const responsesByInstrument = new Map<string, Promise<readonly MicPositionType[] | null>>([
                ['cello', first.promise],
                ['viola', second.promise],
            ]);
            const deps = makeDeps(
                (_deviceId, _port, instrumentId) => responsesByInstrument.get(instrumentId) ?? Promise.resolve(null)
            );
            const bridge = createLevainBridge(deps);
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            seedDevice('d1', ['close']);
            deps.setLoadedMicPositions.mockClear();

            const loadA = bridge.loadSamplesForInstrument('d1', 'cello');
            const loadB = bridge.loadSamplesForInstrument('d1', 'viola');

            // B (the successor) settles; A rejects afterward but its controller
            // was already aborted when B started, so it must not restore over
            // B's outcome.
            second.resolve(['room']);
            first.reject(new Error('boom'));
            await Promise.all([loadA, loadB]);

            expect(deps.setLoadedMicPositions).toHaveBeenLastCalledWith('d1', ['room']);
            expect(deps.setLoadedMicPositions).not.toHaveBeenCalledWith('d1', ['close']);
        });

        it('keeps the successor’s names when a load superseded before it resolves settles later, surviving a later rejection too', async () => {
            const first = Promise.withResolvers<readonly MicPositionType[] | null>();
            const second = Promise.withResolvers<readonly MicPositionType[] | null>();
            // Keyed by instrument id rather than call order, so registration's
            // own initial load (a different instrument id) doesn't consume
            // either resolver meant for the two explicit calls below.
            const responsesByInstrument = new Map<string, Promise<readonly MicPositionType[] | null>>([
                ['cello', first.promise],
                ['viola', second.promise],
            ]);
            const deps = makeDeps((_deviceId, _port, instrumentId) => {
                if (instrumentId === 'flute') {
                    return Promise.reject(new Error('boom'));
                }
                return responsesByInstrument.get(instrumentId) ?? Promise.resolve(null);
            });
            const bridge = createLevainBridge(deps);
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();

            const loadA = bridge.loadSamplesForInstrument('d1', 'cello');
            const loadB = bridge.loadSamplesForInstrument('d1', 'viola');

            // B (the successor) settles first; A settles afterward but its
            // controller was already aborted when B started.
            second.resolve(['close']);
            first.resolve(['room']);
            await Promise.all([loadA, loadB]);

            expect(deps.setLoadedMicPositions).toHaveBeenLastCalledWith('d1', ['close']);
            expect(deps.setLoadedMicPositions).not.toHaveBeenCalledWith('d1', ['room']);

            // A's late resolution must not have corrupted the bridge's
            // committed-bank record with its own (earlier-started, later
            // arriving) names: a further load that rejects has to restore
            // B's bank, not A's, proving the record itself still holds
            // B's commit rather than only the transient store write above.
            await bridge.loadSamplesForInstrument('d1', 'flute');

            expect(deps.setLoadedMicPositions).toHaveBeenLastCalledWith('d1', ['close']);
        });

        it('restores the last committed bank when the load that supersedes an uncommitted resolution rejects', async () => {
            const first = Promise.withResolvers<readonly MicPositionType[] | null>();
            const second = Promise.withResolvers<readonly MicPositionType[] | null>();
            const responsesByInstrument = new Map<string, Promise<readonly MicPositionType[] | null>>([
                ['violin-1', Promise.resolve(['close'])],
                ['cello', first.promise],
                ['viola', second.promise],
            ]);
            const deps = makeDeps(
                (_deviceId, _port, instrumentId) => responsesByInstrument.get(instrumentId) ?? Promise.resolve(null)
            );
            const bridge = createLevainBridge(deps);
            await bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();

            const loadA = bridge.loadSamplesForInstrument('d1', 'cello');
            const loadB = bridge.loadSamplesForInstrument('d1', 'viola');

            // A (superseded by B) resolves null — it never proved a
            // commitment, so it must not erase what registration already
            // committed. B (the current load) rejects afterward and must
            // restore that still-standing commitment, not A's null.
            first.resolve(null);
            second.reject(new Error('boom'));
            await Promise.all([loadA, loadB]);

            expect(deps.setLoadedMicPositions).toHaveBeenLastCalledWith('d1', ['close']);
        });

        it('records a superseded load’s committed bank so a later rejection can restore it', async () => {
            const first = Promise.withResolvers<readonly MicPositionType[] | null>();
            const second = Promise.withResolvers<readonly MicPositionType[] | null>();
            const responsesByInstrument = new Map<string, Promise<readonly MicPositionType[] | null>>([
                ['violin-1', Promise.resolve(['close'])],
                ['cello', first.promise],
                ['viola', second.promise],
            ]);
            const deps = makeDeps(
                (_deviceId, _port, instrumentId) => responsesByInstrument.get(instrumentId) ?? Promise.resolve(null)
            );
            const bridge = createLevainBridge(deps);
            await bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            deps.setLoadedMicPositions.mockClear();

            const loadA = bridge.loadSamplesForInstrument('d1', 'cello');
            const loadB = bridge.loadSamplesForInstrument('d1', 'viola');

            // A's worklet handshake commits its bank after B already
            // superseded (aborted) it. The commitment already happened in the
            // engine, so it must still update the record B's own later
            // rejection restores from.
            first.resolve(['close', 'room']);
            second.reject(new Error('boom'));
            await Promise.all([loadA, loadB]);

            expect(deps.setLoadedMicPositions).toHaveBeenLastCalledWith('d1', ['close', 'room']);
        });

        it('starts a fresh committed record after unregister, so a rejecting first load after re-register restores null', async () => {
            const deps = makeDeps((_deviceId, _port, instrumentId) =>
                instrumentId === 'violin-1' ? Promise.resolve(['close']) : Promise.reject(new Error('boom'))
            );
            const bridge = createLevainBridge(deps);
            seedDevice('d1');
            await bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            bridge.unregisterLevainDevice('d1');
            levainStore.set({ d1: { ...defaultLevainState, patch: createDefaultPatch('cello') } });
            await bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            // Without clearing the committed record on unregister, this would
            // restore the pre-unregister 'close' bank instead of null.
            expect(deps.setLoadedMicPositions).toHaveBeenLastCalledWith('d1', null);
        });
    });

    describe('fix — teardown cancels pending rAF batches before they persist', () => {
        it('does not persist a queued param after the device is unregistered', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
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

    describe('applyPatchToEngine', () => {
        it('applies the whole projection and persists everything but the articulation id', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            flushRaf();
            device.setParam.mockClear();
            deps.persistDeviceParam.mockClear();

            const patch = createDefaultPatch('cello');
            bridge.applyPatchToEngine('d1', patch);
            flushRaf();

            for (const { name, value } of projectLevainPatchToEngineParameters(patch)) {
                expect(device.setParam).toHaveBeenCalledWith(name, value);
            }
            // Articulation identity rides `Device.deviceState`; persisting the engine
            // id here would create a second, competing source of truth for it.
            expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'currentArticulation', expect.anything());
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'mic0Volume', 0.8);
        });

        it.each(['missing', 'ineligible'] as const)(
            'writes nothing to the engine when the write target resolves %s',
            (status) => {
                const deps = makeDeps();
                const bridge = createLevainBridge(deps);
                const device = makeDevice();
                seedDevice('d1');
                void bridge.registerLevainDevice('d1', device, {} as MessagePort);
                flushRaf();
                device.setParam.mockClear();
                deps.persistDeviceParam.mockClear();

                deps.setResolutionStatus(status);
                bridge.applyPatchToEngine('d1', createDefaultPatch('cello'));
                flushRaf();

                expect(device.setParam).not.toHaveBeenCalled();
                expect(deps.persistDeviceParam).not.toHaveBeenCalled();
            }
        );
    });

    /**
     * A natively carried strip keeps its Web Audio node as the fallback
     * carrier, so every engine-spelled write has to reach both: the node holds
     * the current value for the moment the session's gate reopens at Stop, and
     * the native session is what a musician is actually hearing while it runs.
     */
    describe('native session writes', () => {
        it('sends a flushed patch edit to the native session as well as the worklet', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            flushRaf();
            device.setParam.mockClear();
            deps.writeNativeBuiltinParameters.mockClear();

            bridge.setLevainParamWithAudio('d1', 'masterGain', 0.62);
            flushRaf();

            expect(device.setParam).toHaveBeenCalledWith('master_gain', 0.62);
            expect(deps.writeNativeBuiltinParameters).toHaveBeenCalledWith('track-1', 'd1', { master_gain: 0.62 });
        });

        it('sends an articulation switch natively, addressed to the owning strip', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            flushRaf();
            deps.writeNativeBuiltinParameters.mockClear();

            bridge.setLevainParamWithAudio('d1', 'currentArticulation', 'pizzicato');

            expect(deps.writeNativeBuiltinParameters).toHaveBeenCalledWith('track-1', 'd1', {
                current_articulation: 10,
            });
        });

        it('sends a macro’s CC gestures to both carriers', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', device, {} as MessagePort);
            flushRaf();
            deps.writeNativeBuiltinParameters.mockClear();

            // 'Space' is macro index 4 in the default labels; 'Dynamics' is 0.
            bridge.setMacroWithAudio('d1', 4, 0.7);
            bridge.setMacroWithAudio('d1', 0, 0.7);

            expect(deps.writeNativeBuiltinParameters).toHaveBeenCalledWith('track-1', 'd1', { mic_2_volume: 0.7 });
            expect(device.handleCc).toHaveBeenCalledWith(1, 89);
            expect(deps.sendNativeLiveMidiControl).toHaveBeenCalledWith({
                trackId: 'track-1',
                deviceId: 'd1',
                controller: 1,
                value: 89,
                channel: 0,
            });
            // A continuous controller is still not a device parameter: it
            // reaches the native body through the controller door above, never
            // as a value on the parameter one.
            expect(deps.writeNativeBuiltinParameters).not.toHaveBeenCalledWith(
                'track-1',
                'd1',
                expect.objectContaining({ cc1: expect.anything() })
            );
        });

        it('replays the registered patch natively, so a splice mid-session hears it', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            seedDevice('d1');

            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            expect(deps.writeNativeBuiltinParameters).toHaveBeenCalledWith('track-1', 'd1', {
                current_articulation: 0,
            });
        });

        it.each(['missing', 'ineligible'] as const)('sends nothing natively for %s ownership', (status) => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            seedDevice('d1');
            void bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);
            flushRaf();
            deps.writeNativeBuiltinParameters.mockClear();
            deps.setResolutionStatus(status);

            bridge.setLevainParamWithAudio('d1', 'masterGain', 0.62);
            bridge.setMacroWithAudio('d1', 4, 0.7);
            flushRaf();

            expect(deps.writeNativeBuiltinParameters).not.toHaveBeenCalled();
        });
    });
});

function paramBatcherHasPending(rafCallbacks: FrameRequestCallback[]): boolean {
    return rafCallbacks.length > 0;
}
