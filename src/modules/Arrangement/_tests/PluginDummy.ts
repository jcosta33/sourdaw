import { type PluginDescriptor } from '../models/DeviceParameter';

export const PluginDummy = {
    create: (overrides?: Partial<PluginDescriptor>): PluginDescriptor => ({
        id: 'builtin-reverb',
        name: 'Reverb',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        parameters: [],
        hasCustomUI: false,
        ...overrides,
    }),
};
