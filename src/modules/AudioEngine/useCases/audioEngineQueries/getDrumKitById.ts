import { getDrumKitById as getDrumKitByIdFromFactory } from '../../models/factoryDrumKits';
import type { DrumKit } from './helpers';
import { toDrumKit } from './helpers';

/**
 * Public query contract for AudioEngine synth and drum data.
 */
export function getDrumKitById(id: string): DrumKit | null {
    return toDrumKit(getDrumKitByIdFromFactory(id));
}