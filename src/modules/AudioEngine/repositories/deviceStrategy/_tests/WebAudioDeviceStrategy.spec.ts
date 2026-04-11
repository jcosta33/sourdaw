import { describe, it, expect, vi } from 'vitest';

vi.mock('../../deviceNodeFactory', () => ({
    applyParams: vi.fn(),
    DEVICE_FACTORIES: {
        'builtin-gain': vi.fn(() => ({
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [],
        })),
    },
}));

import { applyParams } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy, createWebAudioDevice } from '../WebAudioDeviceStrategy';
import { type Device } from '../../../models/TrackViewTypes';

describe('WebAudioDeviceStrategy', () => {
    it('should delegate setParam to applyParams with the device type', () => {
        const node = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [],
        };
        const strategy = new WebAudioDeviceStrategy(node, 'builtin-gain');

        strategy.setParam('gain', 0.75);

        expect(vi.mocked(applyParams)).toHaveBeenCalledWith(node, 'builtin-gain', { gain: 0.75 });
    });
});

describe('createWebAudioDevice', () => {
    it('should build a strategy from DEVICE_FACTORIES and apply initial params', () => {
        const ctx = {} as BaseAudioContext;
        const device: Device = {
            id: 'd1',
            name: 'Gain',
            type: 'builtin-gain',
            bypassed: false,
            parameterValues: { gain: 0.5 },
        };

        const strategy = createWebAudioDevice(ctx, device);

        expect(strategy.node).toBeDefined();
        expect(vi.mocked(applyParams)).toHaveBeenCalledWith(
            strategy.node,
            'builtin-gain',
            device.parameterValues
        );
    });

    it('should throw when the device type is unknown', () => {
        const device: Device = {
            id: 'd1',
            name: 'X',
            type: 'unknown-type',
            bypassed: false,
            parameterValues: {},
        };

        expect(() => createWebAudioDevice({} as BaseAudioContext, device)).toThrow(
            /Unknown WebAudio device type/
        );
    });
});
