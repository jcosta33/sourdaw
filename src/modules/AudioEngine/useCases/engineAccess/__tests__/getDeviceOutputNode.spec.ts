import { describe, it, expect, vi } from 'vitest';

import { asAudioNode, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getDeviceOutputNode } from '../getDeviceOutputNode';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('getDeviceOutputNode', () => {
    it('should return the output node the engine finds for the device id', () => {
        const node = asAudioNode(createMockAudioNode('gain'));
        const engineFind = vi.fn<AudioEngine['findDeviceOutputNode']>(() => node);
        const engine: Pick<AudioEngine, 'findDeviceOutputNode'> = { findDeviceOutputNode: engineFind };
        const run = injectDependencies(getDeviceOutputNode, { audioEngine: engine });

        expect(run('device-1')).toBe(node);
        expect(engineFind).toHaveBeenCalledTimes(1);
        expect(engineFind).toHaveBeenCalledWith('device-1');
    });

    it('should return null when the engine has no such device', () => {
        const engine: Pick<AudioEngine, 'findDeviceOutputNode'> = {
            findDeviceOutputNode: vi.fn<AudioEngine['findDeviceOutputNode']>(() => null),
        };
        const run = injectDependencies(getDeviceOutputNode, { audioEngine: engine });

        expect(run('missing')).toBeNull();
    });
});
