import { describe, it, expect, vi } from 'vitest';

import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('buildDeviceChain', () => {
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
});
