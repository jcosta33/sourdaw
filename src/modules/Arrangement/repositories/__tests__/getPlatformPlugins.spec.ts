import { describe, it, expect, vi } from 'vitest';

import { getPlatformPlugins } from '../getPlatformPlugins';

vi.mock('#/modules/Arrangement/models/DeviceParameter', () => ({
    BUILTIN_PLUGINS: [
        { name: 'Web Only', platform: 'web' },
        { name: 'Both', platform: 'both' },
        { name: 'Native Only', platform: 'native' },
        { name: 'Implicit Both' },
    ],
}));

describe('getPlatformPlugins', () => {
    it('filters out native-only plugins (currently all return for web/tauri match)', () => {
        const plugins = getPlatformPlugins();

        expect(plugins.find((param) => param.name === 'Web Only')).toBeDefined();
        expect(plugins.find((param) => param.name === 'Both')).toBeDefined();
        expect(plugins.find((param) => param.name === 'Implicit Both')).toBeDefined();

        // The implementation specifically filters out p.platform !== 'native'
        expect(plugins.find((param) => param.name === 'Native Only')).toBeUndefined();
    });
});
