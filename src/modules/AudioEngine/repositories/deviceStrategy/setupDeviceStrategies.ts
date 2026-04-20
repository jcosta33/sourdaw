import { deviceRegistry } from './AudioDeviceStrategy';
import { createWebAudioDevice } from './WebAudioDeviceStrategy';
import { createFaustStrategy } from './FaustDeviceStrategy';
import { createNativeDspStrategy } from './NativeDspDeviceStrategy';

import { isFaustModule } from '../faustDeviceFactory';
import { isKneadDevice } from '../../engine/KneadNode';
import { isFermenterDevice } from '../../engine/FermenterNode';
import { isToasterDevice } from '../../engine/ToasterNode';
import { isLevainDevice } from '../../engine/LevainNode';
import { isGlutenDevice } from '../../engine/GlutenNode';
import { isBacteriaDevice } from '../../engine/BacteriaNode';
import { isGrinderDevice } from '../../engine/GrinderNode';
import { isProofDevice } from '../../engine/ProofNode';
import { isProofChamberDevice } from '../../engine/ProofChamberNode';
import { isScoringDevice } from '../../engine/ScoringNode';

deviceRegistry.register('builtin-', async (ctx, device) => createWebAudioDevice(ctx, device));

deviceRegistry.register(isFaustModule, createFaustStrategy);

const isNativeDevice = (type: string) => {
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
};

deviceRegistry.register(isNativeDevice, createNativeDspStrategy);

export { deviceRegistry };
export type { AudioDeviceStrategy, DeviceCreator, DeviceFactoryRegistry } from './AudioDeviceStrategy';
