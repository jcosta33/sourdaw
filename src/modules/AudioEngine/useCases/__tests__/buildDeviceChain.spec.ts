import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        compileFaustDSP: vi.fn(),
        createFaustDevice: vi.fn(),
        createFaustNode: vi.fn(),
        isFaustModule: vi.fn(),
        loggerWarn: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
    isFaustModule: mocks.isFaustModule,
}));

vi.mock('../../repositories/faustDeviceFactory', () => ({
    createFaustDevice: mocks.createFaustDevice,
}));

describe('buildDeviceChain', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isFaustModule.mockReturnValue(false);
    });

    it('should connect input to output when there are no active devices', async () => {
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const ctx = {} as BaseAudioContext;

        const bypassed: Device = {
            id: 'd1',
            name: 'Bypassed',
            type: 'builtin-synth',
            bypassed: true,
            parameterValues: {},
        };

        const entries = await buildDeviceChain(ctx, [bypassed], input, output);

        expect(entries).toEqual([]);
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    it('should create Faust devices through Plugin-backed use-case composition', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const faustInput = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const faustOutput = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const offlineNode = {
            inputNode: faustInput,
            outputNode: faustOutput,
            nodes: [{ setParamValue: vi.fn() } as unknown as AudioNode],
        };
        mocks.isFaustModule.mockImplementation((type) => type === 'faust-x');
        mocks.createFaustDevice.mockResolvedValue(offlineNode);
        const ctx = {} as BaseAudioContext;
        const device: Device = {
            id: 'd1',
            name: 'Faust',
            type: 'faust-x',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain(ctx, [device], input, output);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.deviceType).toBe('faust-x');
        expect(mocks.createFaustDevice).toHaveBeenCalledWith({
            ctx,
            faustModuleId: 'faust-x',
            compileFaustDSP: mocks.compileFaustDSP,
            createFaustNode: mocks.createFaustNode,
        });
        expect(input.connect).toHaveBeenCalledWith(faustInput);
        expect(faustOutput.connect).toHaveBeenCalledWith(output);
    });

    // MD-4 review — this is why a registry matcher gap is silent rather than
    // loud: an unclaimed device type makes createDevice throw, the chain logs a
    // warning and drops the device, and an instrument track renders nothing.
    it('drops a device no registry matcher claims, leaving the chain without it', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        mocks.isFaustModule.mockReturnValue(false);
        const unclaimed: Device = {
            id: 'd1',
            name: 'Unclaimed instrument',
            type: 'no-matcher-claims-this',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain({} as BaseAudioContext, [unclaimed], input, output);

        expect(entries).toEqual([]);
        // Nothing generates into the chain — the track is silent, not merely dry.
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    it('routes Yeast around the audio chain without logging a missing-device warning', async () => {
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const yeast: Device = {
            id: 'yeast-1',
            name: 'Yeast',
            type: 'yeast',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain({} as BaseAudioContext, [yeast], input, output);

        expect(entries).toEqual([]);
        expect(input.connect).toHaveBeenCalledWith(output);
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // MD-4 — the note surface used to be attached to every entry, so the offline
    // scheduler read the first device in any chain as the track's instrument and
    // routed MIDI into a no-op instead of the fallback synth.
    it('gives no note surface to a device whose strategy cannot voice notes', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        mocks.isFaustModule.mockImplementation((type) => type === 'faust-reverb');
        mocks.createFaustDevice.mockResolvedValue({
            inputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
            outputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
            nodes: [],
        });
        const device: Device = {
            id: 'd1',
            name: 'Faust Reverb',
            type: 'faust-reverb',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain({} as BaseAudioContext, [device], input, output);

        expect(entries[0]?.instrumentControls).toBeUndefined();
    });
});
