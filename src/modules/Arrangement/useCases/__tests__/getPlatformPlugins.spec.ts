import { describe, it, expect, vi } from 'vitest';
import { type PluginDescriptor } from '../../models/DeviceParameter';
import { getPlatformPlugins } from '../getPlatformPlugins';
import { getPlatformPlugins as repoGetPlatformPlugins } from '../../repositories/getPlatformPlugins';

vi.mock('../../repositories/getPlatformPlugins', () => ({
    getPlatformPlugins: vi.fn(),
}));

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
        vi.mocked(repoGetPlatformPlugins).mockReturnValue(plugins as any);

        expect(getPlatformPlugins()).toBe(plugins);
        expect(repoGetPlatformPlugins).toHaveBeenCalledTimes(1);
    });
});
