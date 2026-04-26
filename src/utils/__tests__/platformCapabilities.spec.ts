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

    it('should expose boolean capability flags', async () => {
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');
        const caps = getCaps();
        expect(typeof caps.hasNativePlugins).toBe('boolean');
        expect(typeof caps.hasMidiInput).toBe('boolean');
        expect(typeof caps.isDesktopApp).toBe('boolean');
    });

    it('should reflect desktop when isTauri is true', async () => {
        vi.doMock('#/utils/tauriBridge', () => ({
            isTauri: () => true,
        }));
        const { getPlatformCapabilities: getCaps } = await import('../platformCapabilities');
        const caps = getCaps();
        expect(caps.isDesktopApp).toBe(true);
        expect(caps.hasNativePlugins).toBe(true);
    });
});

describe('DISABLED_REASONS', () => {
    it('should define tooltip strings for gated features', () => {
        expect(DISABLED_REASONS.nativePlugins.length).toBeGreaterThan(10);
        expect(DISABLED_REASONS.midiInput).toContain('MIDI');
    });
});
