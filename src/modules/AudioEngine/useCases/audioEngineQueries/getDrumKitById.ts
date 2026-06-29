import { getDrumKitById as getDrumKitByIdFromFactory } from '../../models/FactoryDrumKits';

import { toDrumKit } from './helpers';

import type { DrumKit } from './helpers';

/**
 * Public query contract for AudioEngine synth and drum data.
 */
export function getDrumKitById(id: string): DrumKit | null {
    return toDrumKit(getDrumKitByIdFromFactory(id));
}
