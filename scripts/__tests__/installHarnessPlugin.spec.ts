import { describe, expect, it } from 'vitest';

import { cdylibFileName, harnessPluginDestination } from '../installHarnessPlugin';

describe('harness plugin install', () => {
    it('should name the cargo cdylib per platform', () => {
        expect(cdylibFileName('darwin')).toBe('libsourdaw_harness_tone.dylib');
        expect(cdylibFileName('linux')).toBe('libsourdaw_harness_tone.so');
        expect(cdylibFileName('win32')).toBe('sourdaw_harness_tone.dll');
    });

    it('should install into the per-user CLAP root the scanner already trusts', () => {
        // Matches `default_plugin_scan_roots` in
        // `crates/sourdaw-native/src/host/plugin_scan_policy.rs`: darwin and
        // linux root under the user's home.
        expect(harnessPluginDestination('darwin', '/Users/musician')).toBe(
            '/Users/musician/Library/Audio/Plug-Ins/CLAP/Sourdaw Harness/Sourdaw Harness Tone.clap'
        );
        expect(harnessPluginDestination('linux', '/home/musician')).toBe(
            '/home/musician/.clap/Sourdaw Harness/Sourdaw Harness Tone.clap'
        );
    });

    it('should install win32 at the literal machine-wide root the policy reads no env var for', () => {
        // `default_plugin_scan_roots` roots win32 at the literal
        // `C:\Program Files\Common Files\CLAP`, not a `home`/env-derived
        // path — so a `home` argument the policy would never see must not
        // change the destination.
        expect(harnessPluginDestination('win32', 'Z:\\not-the-real-home')).toBe(
            'C:\\Program Files\\Common Files\\CLAP\\Sourdaw Harness\\Sourdaw Harness Tone.clap'
        );
    });
});
