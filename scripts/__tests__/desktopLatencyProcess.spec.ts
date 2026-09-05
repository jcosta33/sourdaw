import { existsSync, mkdtempSync, mkdirSync, writeFileSync, type rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { removeDirectoryWithRetries, removeProfileDir, stripPayloadOverrides } from '../desktopLatencyProcess.ts';

describe('stripPayloadOverrides', () => {
    it('removes every payload-override key that was set', () => {
        const { env, dropped } = stripPayloadOverrides({
            SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node',
            SOURDAW_PLUGIN_SCAN_HELPER: '/tmp/other-helper',
            SOURDAW_PLUGIN_SCAN_WORKER_COMMAND: '{"program":"/tmp/other-helper","args":[],"env":{}}',
        });

        expect(env).toEqual({});
        expect(dropped.sort()).toEqual(
            ['SOURDAW_NATIVE_ADDON', 'SOURDAW_PLUGIN_SCAN_HELPER', 'SOURDAW_PLUGIN_SCAN_WORKER_COMMAND'].sort()
        );
    });

    it('leaves every other key untouched', () => {
        const { env, dropped } = stripPayloadOverrides({ PATH: '/usr/bin', HOME: '/Users/operator' });

        expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/operator' });
        expect(dropped).toEqual([]);
    });

    it('names only the override keys that were actually set, leaving the rest of the environment alone', () => {
        const { env, dropped } = stripPayloadOverrides({
            SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node',
            PATH: '/usr/bin',
        });

        expect(env).toEqual({ PATH: '/usr/bin' });
        expect(dropped).toEqual(['SOURDAW_NATIVE_ADDON']);
    });

    it('does not mutate the environment object it was given', () => {
        const original = { SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node' };

        stripPayloadOverrides(original);

        expect(original).toEqual({ SOURDAW_NATIVE_ADDON: '/tmp/other-addon.node' });
    });
});

describe('removeProfileDir', () => {
    it('removes a real directory containing a nested file with the default remover', () => {
        const profileDir = mkdtempSync(join(tmpdir(), 'sourdaw-desktop-measure-spec-'));
        mkdirSync(join(profileDir, 'nested'));
        writeFileSync(join(profileDir, 'nested', 'file.txt'), 'content');

        const removal = removeProfileDir(profileDir);

        expect(removal).toEqual({ removed: true });
        expect(existsSync(profileDir)).toBe(false);
    });

    it('returns removed: true for a path that does not exist, matching force semantics', () => {
        const missingDir = join(tmpdir(), 'sourdaw-desktop-measure-spec-missing-does-not-exist');

        const removal = removeProfileDir(missingDir);

        expect(removal).toEqual({ removed: true });
    });

    it('reports the error message instead of throwing when the injected remover fails', () => {
        const remove = (): void => {
            throw Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' });
        };

        const removal = removeProfileDir('/tmp/sourdaw-desktop-measure-spec-fake', remove);

        expect(removal).toEqual({ removed: false, reason: 'ENOTEMPTY: directory not empty' });
    });

    it('calls the injected remover exactly once with the profile directory path', () => {
        const calls: string[] = [];
        const remove = (path: string): void => {
            calls.push(path);
        };

        removeProfileDir('/tmp/sourdaw-desktop-measure-spec-fake', remove);

        expect(calls).toEqual(['/tmp/sourdaw-desktop-measure-spec-fake']);
    });
});

describe('removeDirectoryWithRetries', () => {
    it('calls the injected rm exactly once with the retry schedule Node 24 actually runs', () => {
        const calls: Array<[string, unknown]> = [];
        const rm: typeof rmSync = (path, options) => {
            calls.push([path as string, options]);
        };

        removeDirectoryWithRetries('/tmp/sourdaw-desktop-measure-spec-fake', rm);

        expect(calls).toEqual([
            [
                '/tmp/sourdaw-desktop-measure-spec-fake',
                { recursive: true, force: true, maxRetries: 2, retryDelay: 1000 },
            ],
        ]);
    });
});
