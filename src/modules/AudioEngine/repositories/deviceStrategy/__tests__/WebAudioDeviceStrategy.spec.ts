import { describe, it, expect, vi } from 'vitest';

vi.mock('../../applyParams', () => ({
    applyParams: vi.fn(),
}));

vi.mock('../../deviceNodeFactory', () => ({
    createOfflineDeviceNode: vi.fn(({ deviceType }: { deviceType: string }) => {
        if (deviceType === 'builtin-gain') {
            return {
                inputNode: {} as AudioNode,
                outputNode: {} as AudioNode,
                nodes: [],
            };
        }

        return null;
    }),
}));

import { type Device } from '../../../models/TrackViewTypes';
import { applyParams } from '../../applyParams';
import { isUnsupportedDeviceTypeError, type UnsupportedDeviceTypeError } from '../unsupportedDeviceTypeError';
import { WebAudioDeviceStrategy, createWebAudioDevice } from '../WebAudioDeviceStrategy';

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
    it('should build a strategy from the offline device resolver and apply initial params', () => {
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
        expect(vi.mocked(applyParams)).toHaveBeenCalledWith(strategy.node, 'builtin-gain', device.parameterValues);
    });

    it('should throw when the device type is unknown', () => {
        const device: Device = {
            id: 'd1',
            name: 'X',
            type: 'unknown-type',
            bypassed: false,
            parameterValues: {},
        };

        // A builtin id the node factory cannot build is a coverage hole, not a
        // runtime failure, so it must carry the type `buildDeviceChain` aborts
        // the export on rather than the type it degrades past.
        let failure: unknown = null;
        try {
            createWebAudioDevice({} as BaseAudioContext, device);
        } catch (error) {
            failure = error;
        }

        expect(isUnsupportedDeviceTypeError(failure)).toBe(true);
        expect((failure as UnsupportedDeviceTypeError).deviceType).toBe('unknown-type');
    });
});
