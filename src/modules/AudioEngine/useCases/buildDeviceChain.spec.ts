import { describe, it, expect } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { buildDeviceChain } from './buildDeviceChain';
import { type Logger } from '#/helpers/Logger/Logger';
import { type Device } from '#/modules/AudioEngine/models/TrackViewTypes';

describe('buildDeviceChain', () => {
    it('should connect input to output when there are no active devices', async () => {
        const logger = createMock<Logger>();
        injectDependencies(buildDeviceChain, { logger });

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
