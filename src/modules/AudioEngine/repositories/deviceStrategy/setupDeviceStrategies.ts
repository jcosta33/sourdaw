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
import { isFaustModule } from '../faustDeviceFactory';

import { deviceRegistry } from './AudioDeviceStrategy';
import { createFaustStrategy } from './FaustDeviceStrategy';
import { createNativeDspStrategy } from './NativeDspDeviceStrategy';
import { createWebAudioDevice } from './WebAudioDeviceStrategy';

// eslint-disable-next-line @typescript-eslint/require-await -- registry callback signature is async; createWebAudioDevice is currently synchronous
deviceRegistry.register('builtin-', async (ctx, device) => createWebAudioDevice(ctx, device));

deviceRegistry.register(isFaustModule, createFaustStrategy);

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

deviceRegistry.register(isNativeDevice, createNativeDspStrategy);

export { deviceRegistry };
export type { AudioDeviceStrategy, DeviceCreator, DeviceFactoryRegistry } from './AudioDeviceStrategy';
