import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cdylibFileName } from '../buildNativeAddon';

describe('native addon build', () => {
    it('should name the cargo cdylib per platform', () => {
        expect(cdylibFileName('darwin')).toBe('libsourdaw_native.dylib');
        expect(cdylibFileName('linux')).toBe('libsourdaw_native.so');
        expect(cdylibFileName('win32')).toBe('sourdaw_native.dll');
    });

    it('should run in every desktop packaging chain', () => {
        // electron-builder packages whatever `crates/sourdaw-native/*.node`
        // exists; without this step a DMG ships no native surface, silently.
        const repoRoot = resolve(import.meta.dirname, '../..');
        const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(packageJson.scripts['desktop:build']).toContain('buildNativeAddon.ts');
        expect(packageJson.scripts['desktop:dev']).toContain('buildNativeAddon.ts');
    });
});
