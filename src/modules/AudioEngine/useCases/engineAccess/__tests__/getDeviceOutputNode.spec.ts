import { describe, it, expect, vi } from 'vitest';

import { asAudioNode, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getDeviceOutputNode } from '../getDeviceOutputNode';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('getDeviceOutputNode', () => {
    it('should return, per device id, the output node the engine finds for that id', () => {
        const nodes = new Map([
            ['device-1', asAudioNode(createMockAudioNode('gain'))],
            ['device-2', asAudioNode(createMockAudioNode('gain'))],
        ]);
        const engineFind = vi.fn<AudioEngine['findDeviceOutputNode']>((deviceId) => nodes.get(deviceId) ?? null);
        const engine: Pick<AudioEngine, 'findDeviceOutputNode'> = { findDeviceOutputNode: engineFind };
        const run = injectDependencies(getDeviceOutputNode, { audioEngine: engine });

        expect(run('device-1')).toBe(nodes.get('device-1'));
        expect(engineFind).toHaveBeenLastCalledWith('device-1');
        expect(run('device-2')).toBe(nodes.get('device-2'));
        expect(engineFind).toHaveBeenLastCalledWith('device-2');
        expect(engineFind).toHaveBeenCalledTimes(2);
    });

    it('should return null and ask the engine for the missing id when the engine has no such device', () => {
        const engineFind = vi.fn<AudioEngine['findDeviceOutputNode']>(() => null);
        const engine: Pick<AudioEngine, 'findDeviceOutputNode'> = { findDeviceOutputNode: engineFind };
        const run = injectDependencies(getDeviceOutputNode, { audioEngine: engine });

        expect(run('missing')).toBeNull();
        expect(engineFind).toHaveBeenCalledWith('missing');
    });
});
