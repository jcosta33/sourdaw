import { describe, it, expect, vi } from 'vitest';

import { DeviceFactoryRegistry } from '../AudioDeviceStrategy';
import { isUnsupportedDeviceTypeError, type UnsupportedDeviceTypeError } from '../unsupportedDeviceTypeError';

describe('DeviceFactoryRegistry', () => {
    it('should register and use a string prefix matcher', async () => {
        const registry = new DeviceFactoryRegistry();
        const creator = vi.fn().mockResolvedValue('mock-strategy' as any);

        registry.register('builtin-', creator);

        const result = await registry.createDevice({} as any, { type: 'builtin-gain' } as any);

        expect(creator).toHaveBeenCalled();
        expect(result).toBe('mock-strategy');
    });

    it('should register and use a function matcher', async () => {
        const registry = new DeviceFactoryRegistry();
        const creator = vi.fn().mockResolvedValue('mock-strategy' as any);
        function matcher(type: string) {
            return type.includes('custom');
        }

        registry.register(matcher, creator);

        const result = await registry.createDevice({} as any, { type: 'my-custom-device' } as any);

        expect(creator).toHaveBeenCalled();
        expect(result).toBe('mock-strategy');
    });

    // The type, not the message, is the contract: `buildDeviceChain` fails the
    // export on this class and degrades past every other failure, so a plain
    // Error here would be silently downgraded to a skipped device.
    it('should throw a typed unsupported-device error if no matcher matches', async () => {
        const registry = new DeviceFactoryRegistry();
        registry.register('builtin-', vi.fn());

        const failure = await registry
            .createDevice({} as any, { type: 'vst-plugin' } as any)
            .catch((error: unknown) => error);

        expect(isUnsupportedDeviceTypeError(failure)).toBe(true);
        expect((failure as UnsupportedDeviceTypeError).deviceType).toBe('vst-plugin');
    });

    it('should use the first matching factory', async () => {
        const registry = new DeviceFactoryRegistry();
        const c1 = vi.fn().mockResolvedValue('c1' as any);
        const c2 = vi.fn().mockResolvedValue('c2' as any);

        registry.register('test-', c1);
        registry.register('test-specific', c2);

        const result = await registry.createDevice({} as any, { type: 'test-specific' } as any);

        expect(result).toBe('c1'); // First one wins
        expect(c1).toHaveBeenCalled();
        expect(c2).not.toHaveBeenCalled();
    });
});
