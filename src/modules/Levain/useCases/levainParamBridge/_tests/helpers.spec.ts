import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { camelToSnake, createLevainBridge } from '../helpers';

describe('camelToSnake', () => {
    it('should convert camelCase segments to snake_case', () => {
        expect(camelToSnake('masterGain')).toBe('master_gain');
        expect(camelToSnake('legatoEnabled')).toBe('legato_enabled');
        expect(camelToSnake('a')).toBe('a');
        expect(camelToSnake('')).toBe('');
    });

    it('should insert underscores before each capital in a longer camelCase string', () => {
        expect(camelToSnake('fooBarBaz')).toBe('foo_bar_baz');
    });
});

describe('createLevainBridge', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            return 1 as unknown as number;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should unregister without throwing when no device was active', () => {
        const bridge = createLevainBridge({
            getAllTracks: () => [],
            persistDeviceParam: vi.fn(),
            autoLoadLevainSamples: vi.fn().mockResolvedValue(undefined),
        });

        expect(() => bridge.unregisterLevainDevice()).not.toThrow();
    });
});
