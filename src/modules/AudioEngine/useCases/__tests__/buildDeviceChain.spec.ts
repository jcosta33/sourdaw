import { beforeEach, describe, it, expect, vi } from 'vitest';

import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        compileFaustDSP: vi.fn(),
        createFaustDevice: vi.fn(),
        createFaustNode: vi.fn(),
        isFaustModule: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('#/modules/Plugin/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
    isFaustModule: mocks.isFaustModule,
}));

vi.mock('../../repositories/faustDeviceFactory', () => ({
    createFaustDevice: mocks.createFaustDevice,
}));

describe('buildDeviceChain', () => {
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
});
