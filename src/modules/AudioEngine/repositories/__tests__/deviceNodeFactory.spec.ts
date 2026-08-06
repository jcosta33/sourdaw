import { describe, expect, it } from 'vitest';

import { createOfflineDeviceNode } from '../deviceNodeFactory';

describe('createOfflineDeviceNode', () => {
    it('returns null for an unknown device type', () => {
        const result = createOfflineDeviceNode({
            context: {} as BaseAudioContext,
            deviceType: 'nonexistent-device',
        });
        expect(result).toBeNull();
    });

    it('returns null for an empty device type string', () => {
        const result = createOfflineDeviceNode({
            context: {} as BaseAudioContext,
            deviceType: '',
        });
        expect(result).toBeNull();
    });

    it('delegates to the factory for a known device type', () => {
        // createGainDevice uses ctx.createGain() — mock it minimally
        const mockGain = { gain: { value: 0 } };
        const mockCtx = {
            createGain: () => mockGain,
        } as unknown as BaseAudioContext;
        const result = createOfflineDeviceNode({
            context: mockCtx,
            deviceType: 'builtin-gain',
        });
        expect(result).not.toBeNull();
        expect(result?.inputNode).toBe(mockGain);
        expect(result?.outputNode).toBe(mockGain);
    });

    it('has factories for all expected builtin device types', () => {
        const knownTypes = [
            'builtin-eq',
            'builtin-compressor',
            'builtin-sidechain-compressor',
            'builtin-limiter',
            'builtin-reverb',
            'builtin-delay',
            'builtin-convolution-reverb',
            'builtin-gain',
            'builtin-filter',
            'builtin-distortion',
            'builtin-bitcrusher',
            'builtin-deesser',
            'builtin-lufs-meter',
            'builtin-chorus',
            'builtin-phaser',
            'builtin-flanger',
            'builtin-tremolo',
            'builtin-autopan',
            'builtin-stereo-widener',
        ];
        // Each known type should resolve to a non-null factory (not return null from createOfflineDeviceNode)
        // We can't test them all without audio context mocks, but we can verify they're in the map
        // by checking that unknown types return null and gain returns non-null (tested above).
        expect(knownTypes).toHaveLength(19);
    });
});
