import { describe, it, expect, vi } from 'vitest';

import { type PluginDescriptor } from '../../models/DeviceParameter';
import { getPlatformPlugins as repoGetPlatformPlugins } from '../../repositories/getPlatformPlugins';
import { getPlatformPlugins } from '../getPlatformPlugins';

vi.mock('../../repositories/getPlatformPlugins', () => ({
    getPlatformPlugins: vi.fn(),
}));

describe('getPlatformPlugins', () => {
    it('should return plugin list from repo', () => {
        const plugins: PluginDescriptor[] = [
            {
                id: 'p1',
                name: 'P',
                vendor: 'V',
                format: 'builtin',
                category: 'effect',
                parameters: [],
                hasCustomUI: false,
            },
        ];
        vi.mocked(repoGetPlatformPlugins).mockReturnValue(plugins);

        expect(getPlatformPlugins()).toBe(plugins);
        expect(repoGetPlatformPlugins).toHaveBeenCalledTimes(1);
    });
});
