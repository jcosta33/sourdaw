import { getDrumKitByIndex as getDrumKitByIndexFromFactory } from '../../models/factoryDrumKits';
import type { DrumKit } from './helpers';
import { toDrumKit } from './helpers';

export function getDrumKitByIndex(index: number): DrumKit | null {
    return toDrumKit(getDrumKitByIndexFromFactory(index));
}