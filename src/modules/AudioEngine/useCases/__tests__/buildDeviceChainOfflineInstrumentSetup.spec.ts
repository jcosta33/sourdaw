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
