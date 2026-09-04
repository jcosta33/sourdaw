import { describe, expect, it } from 'vitest';

import { stripPayloadOverrides } from '../desktopLatencyProcess.ts';

describe('stripPayloadOverrides', () => {
    it('removes every payload-override key that was set', () => {
        const { env, dropped } = stripPayloadOverrides({
            SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node',
            SOURDAW_PLUGIN_SCAN_HELPER: '/tmp/other-helper',
            SOURDAW_PLUGIN_SCAN_WORKER_COMMAND: '{"program":"/tmp/other-helper","args":[],"env":{}}',
        });

        expect(env).toEqual({});
        expect(dropped.sort()).toEqual(
            ['SOURDAW_NATIVE_ADDON', 'SOURDAW_PLUGIN_SCAN_HELPER', 'SOURDAW_PLUGIN_SCAN_WORKER_COMMAND'].sort()
        );
    });

    it('leaves every other key untouched', () => {
        const { env, dropped } = stripPayloadOverrides({ PATH: '/usr/bin', HOME: '/Users/operator' });

        expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/operator' });
        expect(dropped).toEqual([]);
    });

    it('names only the override keys that were actually set, leaving the rest of the environment alone', () => {
        const { env, dropped } = stripPayloadOverrides({
            SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node',
            PATH: '/usr/bin',
        });

        expect(env).toEqual({ PATH: '/usr/bin' });
        expect(dropped).toEqual(['SOURDAW_NATIVE_ADDON']);
    });

    it('does not mutate the environment object it was given', () => {
        const original = { SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node' };

        stripPayloadOverrides(original);

        expect(original).toEqual({ SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node' });
    });
});
