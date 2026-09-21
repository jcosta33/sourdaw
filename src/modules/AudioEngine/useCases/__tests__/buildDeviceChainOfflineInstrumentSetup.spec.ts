import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

// The offline chain is the only place a native-DSP instrument gets the setup its
// live descriptor performs (instrument identity, sample zones, drum kit). Every
// engine node creator is mocked so the real registry, the real matchers and the
// real strategy all run, and only the WASM node construction is faked.
const { creators, loggerWarn } = vi.hoisted(() => {
    const creators = {
        createFermenterNode: vi.fn(),
        createToasterNode: vi.fn(),
        createLevainNode: vi.fn(),
        createGlutenNode: vi.fn(),
        createBacteriaNode: vi.fn(),
        createGrinderNode: vi.fn(),
        createProofNode: vi.fn(),
        createProofChamberNode: vi.fn(),
        createScoringNode: vi.fn(),
        createGrandBouleNode: vi.fn(),
        createKneadNode: vi.fn(),
    };
    return { creators, loggerWarn: vi.fn() };
});

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: () => false,
    isFaustInstrumentModule: () => false,
}));

vi.mock('../../engine/FermenterNode', () => ({
    isFermenterDevice: (t: string) => t === 'fermenter',
    createFermenterNode: creators.createFermenterNode,
}));
vi.mock('../../engine/ToasterNode', () => ({
    isToasterDevice: (t: string) => t === 'toaster',
    createToasterNode: creators.createToasterNode,
}));
vi.mock('../../engine/LevainNode', () => ({
    isLevainDevice: (t: string) => t === 'levain',
    createLevainNode: creators.createLevainNode,
}));
vi.mock('../../engine/GlutenNode', () => ({
    isGlutenDevice: (t: string) => t === 'gluten',
    createGlutenNode: creators.createGlutenNode,
}));
vi.mock('../../engine/BacteriaNode', () => ({
    isBacteriaDevice: (t: string) => t === 'bacteria',
    createBacteriaNode: creators.createBacteriaNode,
}));
vi.mock('../../engine/GrinderNode', () => ({
    isGrinderDevice: (t: string) => t === 'grinder',
    createGrinderNode: creators.createGrinderNode,
}));
vi.mock('../../engine/ProofNode', () => ({
    isProofDevice: (t: string) => t === 'proof',
    createProofNode: creators.createProofNode,
}));
vi.mock('../../engine/ProofChamberNode', () => ({
    isProofChamberDevice: (t: string) => t === 'proofChamber',
    createProofChamberNode: creators.createProofChamberNode,
}));
vi.mock('../../engine/ScoringNode', () => ({
    isScoringDevice: (t: string) => t === 'scoring',
    createScoringNode: creators.createScoringNode,
}));
vi.mock('../../engine/GrandBouleNode', () => ({
    isGrandBouleDevice: (t: string) => t === 'grandBoule',
    createGrandBouleNode: creators.createGrandBouleNode,
}));
vi.mock('../../engine/KneadNode', () => ({
    isKneadDevice: (t: string) => t === 'knead',
    createKneadNode: creators.createKneadNode,
}));

class FakeAudioWorkletNode {
    public readonly port = { postMessage: vi.fn() } as unknown as MessagePort;
    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    constructor(public readonly numberOfInputs: number) {}
}

type PrepareInput = {
    deviceId: string;
    deviceType: string;
    deviceState?: unknown;
    port: MessagePort;
    signal?: AbortSignal;
};

function makeDevice(id: string, type: string): Device {
    return { id, name: type, type, bypassed: false, parameterValues: {} };
}

function makeChainEnds(): { input: AudioNode; output: AudioNode } {
    return {
        input: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
        output: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
    };
}

describe('buildDeviceChain offline instrument setup', () => {
    let workletNode: FakeAudioWorkletNode;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        // Instruments are source nodes (0 inputs); the strategy exposes noteOn so
        // the chain attaches a note surface.
        workletNode = new FakeAudioWorkletNode(0);
        for (const creator of Object.values(creators)) {
            creator.mockResolvedValue({
                workletNode,
                ready: Promise.resolve({}),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
            });
        }
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        setAudioDeviceRuntimeSink({});
    });

    it('uses the captured owner preparation after asynchronous node construction', async () => {
        const ready = Promise.withResolvers<Awaited<ReturnType<typeof creators.createLevainNode>>>();
        const entered = Promise.withResolvers<void>();
        const constructed = await creators.createLevainNode();
        creators.createLevainNode.mockImplementation(() => {
            entered.resolve();
            return ready.promise;
        });
        const liveSetup = vi.fn(async () => {});
        setAudioDeviceRuntimeSink({ prepareOfflineInstrument: liveSetup });
        const { input, output } = makeChainEnds();
        const instruments = new Map([
            [
                'levain-1',
                async ({ port }: { port: MessagePort }) => {
                    port.postMessage({ type: 'param', name: 'captured-value', value: 0.25 });
                },
            ],
        ]);
        const building = buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output, {
            instruments,
        });
        await entered.promise;
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: async ({ port }) => {
                port.postMessage({ type: 'param', name: 'wrong-live-value', value: 0.9 });
            },
        });
        ready.resolve(constructed);
        await building;
        expect(workletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'param',
            name: 'captured-value',
            value: 0.25,
        });
        expect(liveSetup).not.toHaveBeenCalled();
    });

    it('asks the owning module to prepare a levain device, handing it that device port', async () => {
        const received: PrepareInput[] = [];
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: (input) => {
                received.push(input);
                return Promise.resolve();
            },
        });
        const { input, output } = makeChainEnds();

        await buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output);

        expect(received).toHaveLength(1);
        expect(received[0]?.deviceId).toBe('levain-1');
        expect(received[0]?.deviceType).toBe('levain');
        expect(received[0]?.port).toBe(workletNode.port);
        // The signal is what lets a stalled fetch be abandoned instead of holding
        // the render lock forever.
        expect(received[0]?.signal?.aborted).toBe(false);
    });

    it('passes the render snapshot device state to offline instrument setup', async () => {
        const received: PrepareInput[] = [];
        const deviceState = { version: 1, data: { kit: { name: 'snapshot kit' } } };
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: (input) => {
                received.push(input);
                return Promise.resolve();
            },
        });
        const { input, output } = makeChainEnds();

        await buildDeviceChain(
            {} as BaseAudioContext,
            [{ ...makeDevice('toaster-1', 'toaster'), deviceState }],
            input,
            output
        );

        expect(received[0]?.deviceState).toEqual(deviceState);
    });

    it('forwards the device type rather than deciding itself, so a non-instrument is a no-op downstream', async () => {
        // Gluten is a bus compressor: native DSP, worklet-backed, but nothing to
        // prepare. The chain does not branch on type — it hands the type over, and
        // the composition root's sink dispatches only what it recognises.
        const received: PrepareInput[] = [];
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: (prepareInput) => {
                received.push(prepareInput);
                return Promise.resolve();
            },
        });
        const { input, output } = makeChainEnds();

        await buildDeviceChain({} as BaseAudioContext, [makeDevice('gluten-1', 'gluten')], input, output);

        expect(received.map((entry) => entry.deviceType)).toEqual(['gluten']);
    });

    it('does not ask for setup for a device with no worklet port', async () => {
        const prepareOfflineInstrument = vi.fn(() => Promise.resolve());
        setAudioDeviceRuntimeSink({ prepareOfflineInstrument });
        const { input, output } = makeChainEnds();

        const entries = await buildDeviceChain(
            {} as BaseAudioContext,
            [makeDevice('nothing-claims-this', 'no-matcher-claims-this')],
            input,
            output
        );

        expect(entries).toEqual([]);
        expect(prepareOfflineInstrument).not.toHaveBeenCalled();
    });

    // Regression: a failed offline setup must degrade the track to silence, never
    // to a different instrument. If the failure propagates, `createDevice` throws,
    // the chain logs and drops the device, and the entry loses its
    // `instrumentControls`. `scheduleTrackClips` reads that absence as "this track
    // has no instrument" and falls through to `getSynthParamsFromDevices`, whose
    // builtin default is a sawtooth at 0.3 gain — so an orchestral part bounces as
    // a synth lead while the export dialog reports success.
    //
    // This guards the mechanism, not one device. Any route that costs an entry its
    // `instrumentControls` ends in the same substituted synth, and there are known
    // siblings: an offline Faust strategy exposes no `noteOn`/`noteOff`, and an
    // `external-plugin` type has no offline matcher at all.
    it('keeps a device whose setup rejects in the chain, with its note surface intact', async () => {
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: () => Promise.reject(new Error('manifest 404')),
        });
        const { input, output } = makeChainEnds();

        const entries = await buildDeviceChain(
            {} as BaseAudioContext,
            [makeDevice('levain-1', 'levain')],
            input,
            output
        );

        expect(entries.map((entry) => entry.deviceId)).toEqual(['levain-1']);
        // Present and routed: the scheduler sends notes here instead of falling
        // back to the builtin synth.
        expect(entries[0]?.instrumentControls).toBeTypeOf('object');
        expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('manifest 404'));
    });

    it('abandons a setup that outruns its deadline instead of stalling the export', async () => {
        vi.useFakeTimers();
        try {
            let observedSignal: AbortSignal | undefined;
            setAudioDeviceRuntimeSink({
                prepareOfflineInstrument: ({ signal }) =>
                    new Promise<void>((_resolve, reject) => {
                        observedSignal = signal;
                        signal?.addEventListener('abort', () => {
                            reject(new Error('aborted'));
                        });
                    }),
            });
            const { input, output } = makeChainEnds();

            const pending = buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output);

            await vi.advanceTimersByTimeAsync(30_000);
            const entries = await pending;

            expect(observedSignal?.aborted).toBe(true);
            // A never-settling load used to hold the render lock forever, so every
            // later export — mixdown or stems — failed with "an export is already
            // in progress" until the app was reloaded.
            expect(entries.map((entry) => entry.deviceId)).toEqual(['levain-1']);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('buildDeviceChain offline instrument setup — cancellation (#4440)', () => {
    let workletNode: FakeAudioWorkletNode;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        workletNode = new FakeAudioWorkletNode(0);
        for (const creator of Object.values(creators)) {
            creator.mockResolvedValue({
                workletNode,
                ready: Promise.resolve({}),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
            });
        }
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        setAudioDeviceRuntimeSink({});
    });

    it('starts no setup for an already-aborted render and unwinds with Export cancelled', async () => {
        const prepareOfflineInstrument = vi.fn(() => Promise.resolve());
        setAudioDeviceRuntimeSink({ prepareOfflineInstrument });
        const { input, output } = makeChainEnds();
        const controller = new AbortController();
        controller.abort();

        await expect(
            buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output, {
                cancellationSignal: controller.signal,
            })
        ).rejects.toThrow('Export cancelled');
        expect(prepareOfflineInstrument).not.toHaveBeenCalled();
    });

    it('aborts an in-flight setup when the render is cancelled and unwinds, never degrades', async () => {
        let setupSignal: AbortSignal | undefined;
        let releaseSetup: ((value: void) => void) | undefined;
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: ({ signal }) =>
                new Promise<void>((resolve, reject) => {
                    setupSignal = signal;
                    releaseSetup = resolve;
                    signal?.addEventListener('abort', () => {
                        reject(new Error('The operation was aborted'));
                    });
                }),
        });
        const { input, output } = makeChainEnds();
        const controller = new AbortController();

        const pending = buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output, {
            cancellationSignal: controller.signal,
        });

        // Let the setup actually start before cancelling, so the probe lands
        // on the in-flight abort rather than the before-start guard above.
        for (let attempt = 0; attempt < 100 && setupSignal === undefined; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(setupSignal).toBeDefined();

        // Cancel while the setup is still pending: the fetch-side signal the
        // sink received must fire at the moment of cancellation, not at the
        // 30-second deadline and not at the next between-track checkpoint. The
        // wall-clock bound is the discriminator: `setupSignal.aborted` alone is
        // deadline-satisfiable (30 s of waiting produces the same abort), so a
        // broken caller-to-setup bridge that unwinds only via the deadline fails
        // the two-second bound here while still passing every state assertion.
        const cancelledAt = Date.now();
        controller.abort();
        await expect(pending).rejects.toThrow('Export cancelled');
        expect(Date.now() - cancelledAt).toBeLessThan(2_000);
        expect(setupSignal?.aborted).toBe(true);
        // The catch that degrades a failed setup to silence must not have run:
        // a cancelled render may not report success over a missing device.
        expect(loggerWarn).not.toHaveBeenCalledWith(expect.stringContaining('render silent'));
        void releaseSetup;
    });

    it('discards a setup result that completes after cancellation', async () => {
        let releaseSetup: ((value: void) => void) | undefined;
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: () =>
                new Promise<void>((resolve) => {
                    releaseSetup = resolve;
                }),
        });
        const { input, output } = makeChainEnds();
        const controller = new AbortController();

        const pending = buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output, {
            cancellationSignal: controller.signal,
        });

        // The fetch settles successfully after Cancel was pressed: the late
        // result belongs to a render that no longer wants one.
        controller.abort();
        releaseSetup?.();
        await expect(pending).rejects.toThrow('Export cancelled');
    });

    it('keeps the deadline independent of the caller signal', async () => {
        vi.useFakeTimers();
        try {
            let observedSignal: AbortSignal | undefined;
            setAudioDeviceRuntimeSink({
                prepareOfflineInstrument: ({ signal }) =>
                    new Promise<void>((_resolve, reject) => {
                        observedSignal = signal;
                        signal?.addEventListener('abort', () => {
                            reject(new Error('aborted'));
                        });
                    }),
            });
            const { input, output } = makeChainEnds();
            const controller = new AbortController();

            const pending = buildDeviceChain(
                {} as BaseAudioContext,
                [makeDevice('levain-1', 'levain')],
                input,
                output,
                { cancellationSignal: controller.signal }
            );

            // No cancellation arrives, yet the 30-second backstop still fires:
            // the caller signal must not have replaced the deadline.
            await vi.advanceTimersByTimeAsync(30_000);
            const entries = await pending;

            expect(observedSignal?.aborted).toBe(true);
            expect(controller.signal.aborted).toBe(false);
            expect(entries.map((entry) => entry.deviceId)).toEqual(['levain-1']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('destroys the interrupted device own strategy on the cancellation unwind (#4483)', async () => {
        // Cancel lands after createDevice resolved but before the entry reached
        // `entries`, so no caller-side teardown can see that strategy — the
        // unwind itself must destroy it or a metered device leaks one of the 64
        // telemetry slots for the page session.
        const destroy = vi.fn();
        creators.createLevainNode.mockResolvedValueOnce({
            workletNode,
            ready: Promise.resolve({}),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
            destroy,
        });
        let setupStarted: ((value: void) => void) | undefined;
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: () =>
                new Promise<void>((resolve) => {
                    setupStarted = resolve;
                }),
        });
        const { input, output } = makeChainEnds();
        const controller = new AbortController();

        const pending = buildDeviceChain({} as BaseAudioContext, [makeDevice('levain-1', 'levain')], input, output, {
            cancellationSignal: controller.signal,
        });

        for (let attempt = 0; attempt < 100 && setupStarted === undefined; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(setupStarted).toBeDefined();

        controller.abort();
        // The setup settles only after Cancel — either shape (reject on abort or
        // a late resolve) unwinds through the discard path; either way the
        // strategy must be destroyed.
        setupStarted?.();
        await expect(pending).rejects.toThrow('Export cancelled');
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('keeps degrading a genuinely failed setup when no cancellation signal is threaded', async () => {
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: () => Promise.reject(new Error('manifest 404')),
        });
        const { input, output } = makeChainEnds();

        const entries = await buildDeviceChain(
            {} as BaseAudioContext,
            [makeDevice('levain-1', 'levain')],
            input,
            output
        );

        // The freeze path passes no signal: its degrade-to-silent contract is
        // unchanged by the cancellation wiring.
        expect(entries.map((entry) => entry.deviceId)).toEqual(['levain-1']);
        expect(entries[0]?.instrumentControls).toBeTypeOf('object');
    });
});
