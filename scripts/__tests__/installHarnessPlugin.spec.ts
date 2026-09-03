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
        // linux root under the user's home, win32 under the machine-wide
        // Common Files folder.
        expect(harnessPluginDestination('darwin', '/Users/musician')).toBe(
            '/Users/musician/Library/Audio/Plug-Ins/CLAP/Sourdaw Harness/Sourdaw Harness Tone.clap'
        );
        expect(harnessPluginDestination('linux', '/home/musician')).toBe(
            '/home/musician/.clap/Sourdaw Harness/Sourdaw Harness Tone.clap'
        );
        expect(harnessPluginDestination('win32', 'C:\\Program Files\\Common Files')).toBe(
            'C:\\Program Files\\Common Files\\CLAP\\Sourdaw Harness\\Sourdaw Harness Tone.clap'
        );
    });
});
