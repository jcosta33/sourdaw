import { getDrumKitByIndex as getDrumKitByIndexFromFactory } from '../../models/FactoryDrumKits';

import { toDrumKit } from './toDrumKit';

import type { DrumKit } from './helpers';

export function getDrumKitByIndex(index: number): DrumKit | null {
    return toDrumKit(getDrumKitByIndexFromFactory(index));
}
