import { vcaGroups } from './helpers';

import type { VCAGroup } from './helpers';

/**
 * Get all VCA groups.
 */
export function getAllVCAGroups(): VCAGroup[] {
    return [...vcaGroups.values()];
}
