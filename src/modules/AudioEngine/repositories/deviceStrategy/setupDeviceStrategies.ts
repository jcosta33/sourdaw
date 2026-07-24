import { type OfflineDeviceNode } from '../devices/types';

import { DeviceFactoryRegistry } from './AudioDeviceStrategy';
import { createFaustStrategy } from './FaustDeviceStrategy';
import { isNativeDspDevice } from './nativeDspDeviceFactories';
import { createNativeDspStrategy } from './NativeDspDeviceStrategy';
import { createWebAudioDevice } from './WebAudioDeviceStrategy';

type CreateDeviceRegistryInput = {
    faustModuleMatcher: (type: string) => boolean;
    createFaustDevice: (input: { ctx: BaseAudioContext; faustModuleId: string }) => Promise<OfflineDeviceNode | null>;
};

export function createDeviceRegistry({
    faustModuleMatcher,
    createFaustDevice,
}: CreateDeviceRegistryInput): DeviceFactoryRegistry {
    const registry = new DeviceFactoryRegistry();

    // eslint-disable-next-line @typescript-eslint/require-await -- registry callback signature is async; createWebAudioDevice is currently synchronous
    registry.register('builtin-', async (ctx, device) => createWebAudioDevice(ctx, device));

    registry.register(faustModuleMatcher, (ctx, device) => createFaustStrategy({ ctx, device, createFaustDevice }));

    // The matcher and the factory read the same table, so a native device can
    // never be buildable yet unclaimed by the registry (MD-4 review: that gap
    // silently dropped GrandBoule out of every device chain).
    registry.register(isNativeDspDevice, createNativeDspStrategy);

    return registry;
}

export type { AudioDeviceStrategy, DeviceCreator, DeviceFactoryRegistry } from './AudioDeviceStrategy';
