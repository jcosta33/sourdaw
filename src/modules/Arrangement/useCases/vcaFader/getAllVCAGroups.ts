import type { VCAGroup } from './helpers';
import { vcaGroups } from './helpers';

/**
 * Get all VCA groups.
 */
export function getAllVCAGroups(): VCAGroup[] {
    return [...vcaGroups.values()];
}