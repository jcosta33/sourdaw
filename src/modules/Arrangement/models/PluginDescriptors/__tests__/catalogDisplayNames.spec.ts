import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';

function findDuplicatedNames(plugins: readonly { id: string; name: string }[]): string[] {
    const duplicates: string[] = [];
    for (const [name, group] of Map.groupBy(plugins, (plugin) => plugin.name)) {
        if (group.length > 1) {
            duplicates.push(`${name}: ${group.map((plugin) => plugin.id).join(', ')}`);
        }
    }
    return duplicates;
}

describe('device catalog display names', () => {
    // The Effects browser lists BUILTIN_PLUGINS through getPlatformPlugins, so two
    // cards sharing a name differ only by their parameter count.
    it('gives every plugin the browser lists its own display name', () => {
        expect(findDuplicatedNames(BUILTIN_PLUGINS)).toEqual([]);
    });
});
