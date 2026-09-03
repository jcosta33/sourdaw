/**
 * Where the shell finds the plugin-scan leaf helper (jcosta33/sourdaw#3488).
 *
 * `resolveScanHelperPath` mirrors `resolveNativeAddonPath`'s three branches —
 * env override, packaged, dev — so a rename or a dropped branch here fails a
 * targeted mutation rather than surfacing as a packaged scan that silently
 * finds no helper.
 */
import { describe, expect, it } from 'vitest';

import { NATIVE_SCAN_HELPER_FILE, NATIVE_SCAN_HELPER_PATH_ENV, resolveScanHelperPath } from '../native.js';

describe('resolveScanHelperPath', () => {
    it('prefers the env override over every other branch', () => {
        const resolved = resolveScanHelperPath({
            env: { [NATIVE_SCAN_HELPER_PATH_ENV]: '/custom/sourdaw-plugin-scan-helper' },
            isPackaged: true,
            resourcesPath: '/Applications/Sourdaw.app/Contents/Resources',
            repoRoot: '/repo',
            platform: 'darwin',
        });

        expect(resolved).toBe('/custom/sourdaw-plugin-scan-helper');
    });

    it('reads the packaged helper from resourcesPath when there is no override', () => {
        const resolved = resolveScanHelperPath({
            env: {},
            isPackaged: true,
            resourcesPath: '/Applications/Sourdaw.app/Contents/Resources',
            repoRoot: '/repo',
            platform: 'darwin',
        });

        expect(resolved).toBe('/Applications/Sourdaw.app/Contents/Resources/sourdaw-plugin-scan-helper');
    });

    it('reads the dev helper beside its crate when unpackaged', () => {
        const resolved = resolveScanHelperPath({
            env: {},
            isPackaged: false,
            resourcesPath: '/unused',
            repoRoot: '/repo',
            platform: 'darwin',
        });

        expect(resolved).toBe('/repo/crates/sourdaw-native/sourdaw-plugin-scan-helper');
    });

    it('appends .exe on win32', () => {
        expect(NATIVE_SCAN_HELPER_FILE('win32')).toBe('sourdaw-plugin-scan-helper.exe');
        expect(NATIVE_SCAN_HELPER_FILE('darwin')).toBe('sourdaw-plugin-scan-helper');

        const packaged = resolveScanHelperPath({
            env: {},
            isPackaged: true,
            resourcesPath: 'C:\\Program Files\\Sourdaw\\resources',
            repoRoot: 'C:\\repo',
            platform: 'win32',
        });
        expect(packaged.endsWith('sourdaw-plugin-scan-helper.exe')).toBe(true);

        const dev = resolveScanHelperPath({
            env: {},
            isPackaged: false,
            resourcesPath: 'unused',
            repoRoot: 'C:\\repo',
            platform: 'win32',
        });
        expect(dev.endsWith('sourdaw-plugin-scan-helper.exe')).toBe(true);
    });
});
