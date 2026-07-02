import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Device } from '../../../models/TrackViewTypes';
import { FaustDeviceStrategy, createFaustStrategy } from '../FaustDeviceStrategy';

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
    const createFaustDevice = vi.fn();

    beforeEach(() => {
        createFaustDevice.mockReset();
    });

    it('should throw when createFaustDevice returns null', async () => {
        createFaustDevice.mockResolvedValue(null);
        const device: Device = {
            id: 'd1',
            name: 'F',
            type: 'faust-x',
            bypassed: false,
            parameterValues: {},
        };
        await expect(
            createFaustStrategy({
                ctx: {} as BaseAudioContext,
                device,
                createFaustDevice,
            })
        ).rejects.toThrow(/Failed to create Faust device/);
    });

    it('should apply initial parameter values on the Faust node', async () => {
        const setParamValue = vi.fn();
        const faustNode = { setParamValue };
        const offlineNode = {
            inputNode: faustNode as unknown as AudioNode,
            outputNode: faustNode as unknown as AudioNode,
            nodes: [faustNode as unknown as AudioNode],
        };
        createFaustDevice.mockResolvedValue(offlineNode);
        const device: Device = {
            id: 'd1',
            name: 'F',
            type: 'faust-x',
            bypassed: false,
            parameterValues: { gain: 0.25 },
        };
        const ctx = {} as BaseAudioContext;
        await createFaustStrategy({ ctx, device, createFaustDevice });
        expect(createFaustDevice).toHaveBeenCalledWith({ ctx, faustModuleId: 'faust-x' });
        expect(setParamValue).toHaveBeenCalledWith('gain', 0.25);
    });
});
