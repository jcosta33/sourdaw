import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../faustDeviceFactory', () => ({
    createFaustDevice: vi.fn(),
}));

import { createFaustDevice } from '../../faustDeviceFactory';
import { FaustDeviceStrategy, createFaustStrategy } from '../FaustDeviceStrategy';
import { type Device } from '../../../models/TrackViewTypes';

describe('FaustDeviceStrategy', () => {
    it('should forward setParam to faustNode.setParamValue when present', () => {
        const setParamValue = vi.fn();
        const faustNode = { setParamValue };
        const offlineNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [faustNode as unknown as AudioNode],
        };
        const strategy = new FaustDeviceStrategy(offlineNode, faustNode);

        strategy.setParam('freq', 0.5);

        expect(setParamValue).toHaveBeenCalledWith('freq', 0.5);
    });

    it('should not throw when setParamValue is missing', () => {
        const offlineNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{} as AudioNode],
        };
        const strategy = new FaustDeviceStrategy(offlineNode, {});
        expect(() => strategy.setParam('x', 1)).not.toThrow();
    });
});

describe('createFaustStrategy', () => {
    beforeEach(() => {
        vi.mocked(createFaustDevice).mockReset();
    });

    it('should throw when createFaustDevice returns null', async () => {
        vi.mocked(createFaustDevice).mockResolvedValue(null);
        const device: Device = {
            id: 'd1',
            name: 'F',
            type: 'faust-x',
            bypassed: false,
            parameterValues: {},
        };
        await expect(createFaustStrategy({} as BaseAudioContext, device)).rejects.toThrow(
            /Failed to create Faust device/
        );
    });

    it('should apply initial parameter values on the Faust node', async () => {
        const setParamValue = vi.fn();
        const faustNode = { setParamValue };
        const offlineNode = {
            inputNode: faustNode as unknown as AudioNode,
            outputNode: faustNode as unknown as AudioNode,
            nodes: [faustNode as unknown as AudioNode],
        };
        vi.mocked(createFaustDevice).mockResolvedValue(offlineNode as never);
        const device: Device = {
            id: 'd1',
            name: 'F',
            type: 'faust-x',
            bypassed: false,
            parameterValues: { gain: 0.25 },
        };
        await createFaustStrategy({} as BaseAudioContext, device);
        expect(setParamValue).toHaveBeenCalledWith('gain', 0.25);
    });
});
