import { inject } from '#/infra/di/inject';
import { getPlatformPlugins as repoGetPlatformPlugins } from '../repositories/getPlatformPlugins';
import { type PluginDescriptor } from '../models/DeviceParameter';

export const getPlatformPlugins = inject({ repoGetPlatformPlugins })(
    ({ repoGetPlatformPlugins }) =>
        function getPlatformPlugins(): readonly PluginDescriptor[] {
            return repoGetPlatformPlugins();
        }
);
