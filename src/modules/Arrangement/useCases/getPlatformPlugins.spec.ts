import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PluginDescriptor } from '#/modules/Arrangement/models/DeviceParameter';
import { getPlatformPlugins } from './getPlatformPlugins';

describe('getPlatformPlugins', () => {
    it('should return plugin list from repo', () => {
        const plugins = Object.freeze([
            {
                id: 'p1',
                name: 'P',
                vendor: 'V',
                format: 'builtin',
                category: 'effect',
                parameters: [],
                hasCustomUI: false,
            } satisfies PluginDescriptor,
        ]);
        const repoGetPlatformPlugins = vi.fn(() => plugins);
        injectDependencies(getPlatformPlugins, { repoGetPlatformPlugins });

        expect(getPlatformPlugins()).toBe(plugins);
        expect(repoGetPlatformPlugins).toHaveBeenCalledTimes(1);
    });
});
