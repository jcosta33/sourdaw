import { afterEach, describe, expect, it } from 'vitest';

import { getPlatformPlugins } from '../getPlatformPlugins';

/**
 * This runs against the real catalog rather than a mocked one. A mocked
 * `BUILTIN_PLUGINS` would let the descriptors and the filter drift apart — the
 * previous version of this file asserted the filter's shape against four fake
 * entries and so said nothing about whether any real device was offered on a
 * platform that cannot run it.
 */
function withDesktopRuntime(run: () => void): void {
    Object.defineProperty(window, 'sourdaw', { value: {}, configurable: true });
    try {
        run();
    } finally {
        Reflect.deleteProperty(window, 'sourdaw');
    }
}

describe('getPlatformPlugins', () => {
    afterEach(() => {
        Reflect.deleteProperty(window, 'sourdaw');
    });

    it('offers devices that run anywhere on a plain browser build', () => {
        const ids = getPlatformPlugins().map((plugin) => plugin.id);

        expect(ids).toContain('builtin-eq');
        expect(ids).toContain('fermenter');
    });

    // Crumbs has no WebAudio implementation at all: its engine is native,
    // reached through the `crumbs_*` desktop commands. Offering it in a browser
    // build put a device in the Content Browser that provably cannot make a
    // sound.
    it('hides a native-only device on a plain browser build', () => {
        const ids = getPlatformPlugins().map((plugin) => plugin.id);

        expect(ids).not.toContain('builtin-crumbs');
    });

    // The old filter dropped `platform: 'native'` unconditionally, with no
    // runtime check — so marking a device native-only would have hidden it from
    // the native build too, which is the one place its engine exists.
    it('offers that same native-only device under the desktop runtime', () => {
        withDesktopRuntime(() => {
            const ids = getPlatformPlugins().map((plugin) => plugin.id);

            expect(ids).toContain('builtin-crumbs');
            expect(ids).toContain('builtin-eq');
        });
    });
});
