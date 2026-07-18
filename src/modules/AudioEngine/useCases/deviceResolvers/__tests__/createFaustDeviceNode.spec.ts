import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        compileFaustDSP: vi.fn(),
        createFaustNode: vi.fn(),
        createFaustDevice: vi.fn(),
    },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
}));

vi.mock('../../../repositories/faustDeviceFactory', () => ({
    createFaustDevice: mocks.createFaustDevice,
}));

import * as subject from '../createFaustDeviceNode';

describe('createFaustDeviceNode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should compose Plugin Faust operations into the AudioEngine repository wrapper', async () => {
        const offlineNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [],
        };
        mocks.createFaustDevice.mockResolvedValue(offlineNode);
        const ctx = {} as BaseAudioContext;

        const result = await subject.createFaustDeviceNode(ctx, 'faust-test');

        expect(result).toBe(offlineNode);
        expect(mocks.createFaustDevice).toHaveBeenCalledWith({
            ctx,
            faustModuleId: 'faust-test',
            compileFaustDSP: mocks.compileFaustDSP,
            createFaustNode: mocks.createFaustNode,
        });
    });
});
