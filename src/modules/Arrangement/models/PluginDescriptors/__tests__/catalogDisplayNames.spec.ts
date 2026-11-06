import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';

function findDuplicatedNames(plugins: readonly { id: string; name: string }[]): string[] {
    const idsByName = new Map<string, string[]>();
    for (const plugin of plugins) {
        idsByName.set(plugin.name, [...(idsByName.get(plugin.name) ?? []), plugin.id]);
    }
    return [...idsByName].filter(([, ids]) => ids.length > 1).map(([name, ids]) => `${name}: ${ids.join(', ')}`);
}

describe('device catalog display names', () => {
    // The Effects browser lists BUILTIN_PLUGINS through getPlatformPlugins, so two
    // cards sharing a name differ only by their parameter count.
    it('gives every plugin the browser lists its own display name', () => {
        expect(findDuplicatedNames(BUILTIN_PLUGINS)).toEqual([]);
    });
});
