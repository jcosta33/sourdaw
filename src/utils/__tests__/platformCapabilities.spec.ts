import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DISABLED_REASONS } from '../platformCapabilities';

describe('getPlatformCapabilities', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock('../desktopRuntime');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('records missing browser Web MIDI once without claiming permission or a device', async () => {
        vi.stubGlobal('navigator', {});
        vi.doMock('../desktopRuntime', () => ({ isDesktopRuntime: () => false }));
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');

        const caps = getCaps();
        expect(caps.webMidiApiPresent).toBe(false);
        expect(caps.hasMidiInput).toBe(false);
        expect(caps.degradations).toEqual([
            { feature: 'midi-input', reason: 'api-absent', message: DISABLED_REASONS.midiInput },
        ]);

        vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn() });
        expect(getCaps()).toBe(caps);
        expect(getCaps().webMidiApiPresent).toBe(false);
    });

    it('treats the desktop marker as a possible native route, not an opened device', async () => {
        vi.stubGlobal('navigator', {});
        vi.doMock('../desktopRuntime', () => ({ isDesktopRuntime: () => true }));
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');

        expect(getCaps()).toEqual(
            expect.objectContaining({ webMidiApiPresent: false, hasMidiInput: true, degradations: [] })
        );
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
    });
});

describe('DISABLED_REASONS', () => {
    it('should define tooltip strings for gated features', () => {
        expect(DISABLED_REASONS.nativePlugins).toBe('CLAP plugins require the desktop app');
        expect(DISABLED_REASONS.midiInput).toContain('MIDI');
    });
});
