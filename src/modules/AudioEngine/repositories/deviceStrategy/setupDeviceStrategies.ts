import { isBacteriaDevice } from '../../engine/BacteriaNode';
import { isFermenterDevice } from '../../engine/FermenterNode';
import { isGlutenDevice } from '../../engine/GlutenNode';
import { isGrinderDevice } from '../../engine/GrinderNode';
import { isKneadDevice } from '../../engine/KneadNode';
import { isLevainDevice } from '../../engine/LevainNode';
import { isProofChamberDevice } from '../../engine/ProofChamberNode';
import { isProofDevice } from '../../engine/ProofNode';
import { isScoringDevice } from '../../engine/ScoringNode';
import { isToasterDevice } from '../../engine/ToasterNode';
import { type OfflineDeviceNode } from '../devices/types';

import { DeviceFactoryRegistry } from './AudioDeviceStrategy';
import { createFaustStrategy } from './FaustDeviceStrategy';
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

    registry.register(isNativeDevice, createNativeDspStrategy);

    return registry;
}

function isNativeDevice(type: string) {
    return (
        isFermenterDevice(type) ||
        isToasterDevice(type) ||
        isLevainDevice(type) ||
        isGlutenDevice(type) ||
        isBacteriaDevice(type) ||
        isGrinderDevice(type) ||
        isProofDevice(type) ||
        isProofChamberDevice(type) ||
        isScoringDevice(type) ||
        isKneadDevice(type)
    );
}

export type { AudioDeviceStrategy, DeviceCreator, DeviceFactoryRegistry } from './AudioDeviceStrategy';
