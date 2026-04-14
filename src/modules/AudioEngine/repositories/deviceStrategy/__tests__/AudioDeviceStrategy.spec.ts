import { describe, it, expect, vi } from 'vitest';
import { DeviceFactoryRegistry } from '../AudioDeviceStrategy';

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
        const matcher = (type: string) => type.includes('custom');
        
        registry.register(matcher, creator);
        
        const result = await registry.createDevice({} as any, { type: 'my-custom-device' } as any);
        
        expect(creator).toHaveBeenCalled();
        expect(result).toBe('mock-strategy');
    });

    it('should throw if no matcher matches', async () => {
        const registry = new DeviceFactoryRegistry();
        registry.register('builtin-', vi.fn());
        
        await expect(registry.createDevice({} as any, { type: 'vst-plugin' } as any))
            .rejects.toThrow('No device factory registered for type: vst-plugin');
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
