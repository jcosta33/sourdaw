import { vcaGroups } from './helpers';

import type { VCAGroup } from './helpers';

/**
 * Create a new VCA group.
 */
export function createVCAGroup(name: string): VCAGroup {
    const group: VCAGroup = {
        id: `vca-${crypto.randomUUID().slice(0, 8)}`,
        name,
        gain: 1.0,
    };
    vcaGroups.set(group.id, group);
    return group;
}
