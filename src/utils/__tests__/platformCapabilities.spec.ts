import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DISABLED_REASONS } from '../platformCapabilities';

describe('getPlatformCapabilities', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should return the same cached object on repeat calls', async () => {
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');
        const a = getCaps();
        const b = getCaps();
        expect(a).toBe(b);
    });

    it('should expose browser capability flags when isDesktopRuntime is false', async () => {
        vi.doMock('../desktopRuntime', () => ({
            isDesktopRuntime: () => false,
        }));
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');
        const caps = getCaps();
        expect(caps.isDesktopApp).toBe(false);
        expect(caps.hasNativePlugins).toBe(false);
        expect(caps.hasPluginScanning).toBe(false);
        expect(caps.hasNativeFileDialogs).toBe(false);
        expect(caps.hasMultiTrackRecording).toBe(false);
        expect(typeof caps.hasMidiInput).toBe('boolean');
        expect(typeof caps.hasVoiceCommands).toBe('boolean');
    });

    it('should expose desktop capability flags when isDesktopRuntime is true', async () => {
        vi.doMock('../desktopRuntime', () => ({
            isDesktopRuntime: () => true,
        }));
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');
        const caps = getCaps();
        expect(caps.isDesktopApp).toBe(true);
        expect(caps.hasNativePlugins).toBe(true);
        expect(caps.hasPluginScanning).toBe(true);
        expect(caps.hasNativeFileDialogs).toBe(true);
        expect(caps.hasMultiTrackRecording).toBe(true);
        expect(caps.hasMidiInput).toBe(true);
        expect(caps.hasVoiceCommands).toBe(true);
    });
});

describe('DISABLED_REASONS', () => {
    it('should define tooltip strings for gated features', () => {
        expect(DISABLED_REASONS.nativePlugins).toBe('CLAP plugins require the desktop app');
        expect(DISABLED_REASONS.midiInput).toContain('MIDI');
    });
});
