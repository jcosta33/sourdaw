import { describe, it, expect, vi } from 'vitest';
import { DeviceFactoryRegistry, type AudioDeviceStrategy } from '../AudioDeviceStrategy';
import { type Device } from '../../../models/TrackViewTypes';

function mockDevice(type: string): Device {
    return {
        id: 'dev-1',
        name: 'Test',
        type,
        bypassed: false,
        parameterValues: {},
    };
}

describe('DeviceFactoryRegistry', () => {
    it('should use the first registered matcher that applies', async () => {
        const registry = new DeviceFactoryRegistry();
        const first = vi.fn(
            async (): Promise<AudioDeviceStrategy> =>
                ({ node: {} as never, setParam: vi.fn() }) as AudioDeviceStrategy
        );
        const second = vi.fn(
            async (): Promise<AudioDeviceStrategy> =>
                ({ node: {} as never, setParam: vi.fn() }) as AudioDeviceStrategy
        );

        registry.register('foo', first);
        registry.register('foobar', second);

        const ctx = {} as BaseAudioContext;
        await registry.createDevice(ctx, mockDevice('foobar'));

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });

    it('should match device types by string prefix', async () => {
        const registry = new DeviceFactoryRegistry();
        const creator = vi.fn(
            async (): Promise<AudioDeviceStrategy> =>
                ({ node: {} as never, setParam: vi.fn() }) as AudioDeviceStrategy
        );
        registry.register('builtin-', creator);

        await registry.createDevice({} as BaseAudioContext, mockDevice('builtin-eq'));

        expect(creator).toHaveBeenCalledTimes(1);
    });

    it('should match device types using a predicate', async () => {
        const registry = new DeviceFactoryRegistry();
        const creator = vi.fn(
            async (): Promise<AudioDeviceStrategy> =>
                ({ node: {} as never, setParam: vi.fn() }) as AudioDeviceStrategy
        );
        registry.register((type) => type === 'custom-x', creator);

        await registry.createDevice({} as BaseAudioContext, mockDevice('custom-x'));

        expect(creator).toHaveBeenCalledTimes(1);
    });

    it('should throw when no factory matches', async () => {
        const registry = new DeviceFactoryRegistry();
        registry.register('only-this-', vi.fn());

        await expect(
            registry.createDevice({} as BaseAudioContext, mockDevice('other'))
        ).rejects.toThrow(/No device factory registered/);
    });
});
