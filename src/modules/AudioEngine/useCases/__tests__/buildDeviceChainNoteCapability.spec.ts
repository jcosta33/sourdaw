import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type Device } from '../../models/TrackViewTypes';
import { type NativeDspNode } from '../../repositories/deviceStrategy/nativeDspDeviceFactories';
import { buildDeviceChain } from '../buildDeviceChain';

/**
 * `instrumentControls` is what `scheduleTrackClips` reads to decide which device
 * on a track voices its MIDI. It must be present on devices that can take notes
 * and absent on the ones that cannot — the offline scheduler takes the *first*
 * entry that presents a note surface, so an effect that presents one shadows the
 * instrument behind it and the track renders silent.
 *
 * These build real `NativeDspDeviceStrategy` instances over stand-in DSP nodes:
 * one shaped like Gluten (no note API at all) and one shaped like Fermenter.
 */

const { mocks } = vi.hoisted(() => ({
    mocks: {
        isFaustModule: vi.fn(() => false),
        loggerWarn: vi.fn(),
        instrumentNoteOn: vi.fn(),
        instrumentNoteOff: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: mocks.isFaustModule,
    isFaustInstrumentModule: vi.fn(() => false),
}));

function makeWorkletNode(): AudioNode {
    return { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 1 } as unknown as AudioNode;
}

/** Gluten's shape: a bus compressor exposes params and bypass, never notes. */
function makeEffectDspNode(): NativeDspNode {
    return {
        workletNode: makeWorkletNode() as AudioWorkletNode,
        setParam: vi.fn(),
        setBypass: vi.fn(),
        ready: Promise.resolve({}),
    };
}

/** Fermenter's shape: the same surface plus a real note API. */
function makeInstrumentDspNode(): NativeDspNode {
    return {
        workletNode: makeWorkletNode() as AudioWorkletNode,
        setParam: vi.fn(),
        setBypass: vi.fn(),
        noteOn: mocks.instrumentNoteOn,
        noteOff: mocks.instrumentNoteOff,
        ready: Promise.resolve({}),
    };
}

vi.mock('../../repositories/deviceStrategy/nativeDspDeviceFactories', () => ({
    isNativeDspDevice: (type: string) => type === 'gluten' || type === 'fermenter',
    NATIVE_DSP_DEVICE_FACTORIES: [
        { matches: (type: string) => type === 'gluten', create: () => Promise.resolve(makeEffectDspNode()) },
        { matches: (type: string) => type === 'fermenter', create: () => Promise.resolve(makeInstrumentDspNode()) },
    ],
}));

function device(type: string, id: string): Device {
    return { id, name: type, type, bypassed: false, parameterValues: {} };
}

function makeChainEnds() {
    return {
        input: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
        output: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
    };
}

describe('buildDeviceChain — which devices present a note surface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', undefined);
    });

    it('gives an effect-only chain no instrument to route MIDI into', async () => {
        const { input, output } = makeChainEnds();

        const entries = await buildDeviceChain({} as BaseAudioContext, [device('gluten', 'd-gluten')], input, output);

        expect(entries.map((entry) => entry.deviceType)).toEqual(['gluten']);
        expect(entries.filter((entry) => entry.instrumentControls)).toEqual([]);
    });

    it('resolves an effect-before-instrument chain to the instrument', async () => {
        const { input, output } = makeChainEnds();
        const devices = [device('gluten', 'd-gluten'), device('fermenter', 'd-fermenter')];

        const entries = await buildDeviceChain({} as BaseAudioContext, devices, input, output);

        // The scheduler's own selection: first entry presenting a note surface.
        const selected = entries.find((entry) => entry.instrumentControls);
        expect(selected?.deviceType).toBe('fermenter');

        selected?.instrumentControls?.noteOn({ noteOrPad: 60, velocity: 100, sampleFrame: 480 });
        expect(mocks.instrumentNoteOn).toHaveBeenCalledWith({ noteOrPad: 60, velocity: 100, sampleFrame: 480 });
    });
});
