import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DISABLED_REASONS } from '../platformCapabilities';

describe('DISABLED_REASONS', () => {
    it('should define a user-facing string for each gated capability', () => {
        expect(DISABLED_REASONS.nativePlugins.length).toBeGreaterThan(0);
        expect(DISABLED_REASONS.pluginScanning.length).toBeGreaterThan(0);
        expect(DISABLED_REASONS.midiInput.length).toBeGreaterThan(0);
        expect(DISABLED_REASONS.voiceCommands.length).toBeGreaterThan(0);
        expect(DISABLED_REASONS.multiTrackRecording.length).toBeGreaterThan(0);
    });
});

describe('getPlatformCapabilities', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should mark desktop-only features when running as Tauri', async () => {
        vi.doMock('#/helpers/tauriBridge', () => ({
            isTauri: () => true,
        }));
        const { getPlatformCapabilities } = await import('../platformCapabilities');
        const caps = getPlatformCapabilities();

        expect(caps.isDesktopApp).toBe(true);
        expect(caps.hasNativePlugins).toBe(true);
        expect(caps.hasPluginScanning).toBe(true);
        expect(caps.hasNativeFileDialogs).toBe(true);
        expect(caps.hasMultiTrackRecording).toBe(true);
    });

    it('should disable native desktop features when not running as Tauri', async () => {
        vi.doMock('#/helpers/tauriBridge', () => ({
            isTauri: () => false,
        }));
        const { getPlatformCapabilities } = await import('../platformCapabilities');
        const caps = getPlatformCapabilities();

        expect(caps.isDesktopApp).toBe(false);
        expect(caps.hasNativePlugins).toBe(false);
        expect(caps.hasPluginScanning).toBe(false);
        expect(caps.hasNativeFileDialogs).toBe(false);
        expect(caps.hasMultiTrackRecording).toBe(false);
    });

    it('should return the same cached object on subsequent calls', async () => {
        vi.doMock('#/helpers/tauriBridge', () => ({
            isTauri: () => false,
        }));
        const { getPlatformCapabilities } = await import('../platformCapabilities');
        const a = getPlatformCapabilities();
        const b = getPlatformCapabilities();
        expect(a).toBe(b);
    });
});
