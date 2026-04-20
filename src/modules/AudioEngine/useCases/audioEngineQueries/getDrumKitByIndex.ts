import { getDrumKitByIndex as getDrumKitByIndexFromFactory } from '../../models/factoryDrumKits';

import { toDrumKit } from './helpers';

import type { DrumKit } from './helpers';

export function getDrumKitByIndex(index: number): DrumKit | null {
    return toDrumKit(getDrumKitByIndexFromFactory(index));
}
