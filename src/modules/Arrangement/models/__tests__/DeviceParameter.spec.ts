import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS, getPluginById, isDeviceSupportedOnCurrentPlatform } from '../DeviceParameter';

describe('getPluginById', () => {
    it('returns a descriptor for a known built-in id', () => {
        const eq = getPluginById('builtin-eq');
        expect(eq).toBeDefined();
        expect(eq!.id).toBe('builtin-eq');
    });

    it('returns undefined for unknown ids', () => {
        expect(getPluginById('not-a-real-plugin-id')).toBeUndefined();
    });
});

describe('isDeviceSupportedOnCurrentPlatform', () => {
    it('allows unknown device types to pass through', () => {
        expect(isDeviceSupportedOnCurrentPlatform('third-party-vst-instance')).toBe(true);
    });

    it('treats every catalog entry as supported here (descriptors use platform both)', () => {
        expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0);
        const first = BUILTIN_PLUGINS[0]!;
        expect(isDeviceSupportedOnCurrentPlatform(first.id)).toBe(true);
    });

    it('reports a built-in plugin as supported when running under the native Tauri runtime', () => {
        // The native runtime gate is the presence of __TAURI_INTERNALS__ on the
        // global window; simulating it must let any catalog entry through.
        const first = BUILTIN_PLUGINS[0]!;
        (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

        try {
            expect(isDeviceSupportedOnCurrentPlatform(first.id)).toBe(true);
        } finally {
            delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        }
    });
});
