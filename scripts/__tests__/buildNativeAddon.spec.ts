import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cdylibFileName, runNativeAddonBuild, scanHelperFileName } from '../buildNativeAddon';

const temporaryRoots: string[] = [];
type CargoRunner = NonNullable<NonNullable<Parameters<typeof runNativeAddonBuild>[0]>['runCargo']>;
type CargoResult = ReturnType<CargoRunner>;
const macHost = 'aarch64-apple-darwin';

function successfulVersion(host = macHost): CargoResult {
    return { status: 0, stdout: `cargo 1.92.0\nrelease: 1.92.0\nhost: ${host}\n` };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function createFixture() {
    const repoRoot = mkdtempSync(join(tmpdir(), 'native addon routing '));
    temporaryRoots.push(repoRoot);
    mkdirSync(join(repoRoot, 'crates', 'sourdaw-native'), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return repoRoot;
}

describe('native addon build', () => {
    it.each([
        {
            host: macHost,
            addon: 'libsourdaw_native.dylib',
            helper: 'sourdaw-plugin-scan-helper',
            directory: 'absolute',
            target: 'same-host',
        },
        {
            host: 'x86_64-unknown-linux-gnu',
            addon: 'libsourdaw_native.so',
            helper: 'sourdaw-plugin-scan-helper',
            directory: 'relative',
            target: 'same-host',
        },
        {
            host: 'x86_64-pc-windows-msvc',
            addon: 'sourdaw_native.dll',
            helper: 'sourdaw-plugin-scan-helper.exe',
            directory: 'absolute',
            target: 'same-host',
        },
        {
            host: macHost,
            addon: 'libsourdaw_native.dylib',
            helper: 'sourdaw-plugin-scan-helper',
            directory: 'default',
            target: 'unset',
        },
        {
            host: macHost,
            addon: 'libsourdaw_native.dylib',
            helper: 'sourdaw-plugin-scan-helper',
            directory: 'relative',
            target: 'host-tuple',
        },
    ])(
        'stages $host targeted outputs with $directory directories and $target target',
        ({ host, addon, helper, directory, target }) => {
            const repoRoot = createFixture();
            const env: NodeJS.ProcessEnv = { PATH: 'preserved Cargo selection', CARGO_PROFILE_RELEASE_LTO: 'true' };
            if (directory !== 'default') {
                env.CARGO_TARGET_DIR =
                    directory === 'relative' ? 'relative target root' : join(repoRoot, 'absolute target root');
            }
            if (target === 'same-host') {
                env.CARGO_BUILD_TARGET = host;
            }
            if (target === 'host-tuple') {
                env.CARGO_BUILD_TARGET = 'host-tuple';
            }
            const targetDir = resolve(repoRoot, env.CARGO_TARGET_DIR ?? 'target');
            const runCargo = vi.fn<CargoRunner>((args) => {
                if (args[0] === '-Vv') {
                    return successfulVersion(host);
                }
                const isHelper = args.includes('--bin');
                const outputRoot = isHelper ? join(targetDir, 'scan-helper') : targetDir;
                const output = join(outputRoot, host, 'release');
                mkdirSync(output, { recursive: true });
                const fileName = isHelper ? helper : addon;
                writeFileSync(join(output, fileName), isHelper ? 'scanner bytes' : 'addon bytes');
                chmodSync(join(output, fileName), 0o751);
                return { status: 0 };
            });

            expect(runNativeAddonBuild({ repoRoot, env, runCargo })).toBe(0);
            expect(readFileSync(join(repoRoot, 'crates/sourdaw-native/sourdaw-native.node'), 'utf8')).toBe(
                'addon bytes'
            );
            expect(readFileSync(join(repoRoot, 'crates/sourdaw-native', helper), 'utf8')).toBe('scanner bytes');
            if (process.platform !== 'win32') {
                expect(statSync(join(repoRoot, 'crates/sourdaw-native', helper)).mode & 0o777).toBe(0o751);
            }
            expect(runCargo.mock.calls[0]).toEqual([['-Vv'], { cwd: repoRoot, env, captureOutput: true }]);
            expect(runCargo.mock.calls.slice(1).map(([args]) => args)).toEqual([
                [
                    'build',
                    '--release',
                    '--lib',
                    '--package',
                    'sourdaw-native',
                    '--features',
                    'napi-addon',
                    '--target',
                    host,
                    '--target-dir',
                    targetDir,
                ],
                [
                    'build',
                    '--release',
                    '--package',
                    'sourdaw-native',
                    '--bin',
                    'sourdaw-plugin-scan-helper',
                    '--target',
                    host,
                    '--target-dir',
                    join(targetDir, 'scan-helper'),
                ],
            ]);
            expect(runCargo.mock.calls[1]?.[1]).toEqual({ cwd: repoRoot, env, captureOutput: false });
            expect(runCargo.mock.calls[2]?.[1]).toEqual({
                cwd: repoRoot,
                env: { ...env, CARGO_PROFILE_RELEASE_LTO: 'false' },
                captureOutput: false,
            });
        }
    );

    it.each([
        'x86_64-unknown-linux-gnu',
        './native.json',
        'aarch64-apple-darwin.json',
        '',
        ' ',
        `${macHost},${macHost}`,
        `${macHost} ${macHost}`,
        ` ${macHost}`,
    ])('refuses incompatible or malformed CARGO_BUILD_TARGET %j before compilation or staging', (target) => {
        const repoRoot = createFixture();
        const runCargo = vi.fn<CargoRunner>(() => successfulVersion());
        expect(runNativeAddonBuild({ repoRoot, env: { CARGO_BUILD_TARGET: target }, runCargo })).toBe(1);
        expect(runCargo.mock.calls.map(([args]) => args)).toEqual([['-Vv']]);
        expect(readdirSync(join(repoRoot, 'crates/sourdaw-native'))).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(
            `CARGO_BUILD_TARGET must be the native Cargo host ${macHost} or host-tuple`
        );
    });

    it.each(['', ' ', 'bad\0root', 'bad\nroot'])(
        'refuses invalid output directory %j before compilation or staging',
        (targetDir) => {
            const repoRoot = createFixture();
            const runCargo = vi.fn<CargoRunner>(() => successfulVersion());
            expect(runNativeAddonBuild({ repoRoot, env: { CARGO_TARGET_DIR: targetDir }, runCargo })).toBe(1);
            expect(runCargo).toHaveBeenCalledTimes(1);
            expect(readdirSync(join(repoRoot, 'crates/sourdaw-native'))).toEqual([]);
            expect(console.error).toHaveBeenCalledWith('CARGO_TARGET_DIR must be a nonempty valid output directory');
        }
    );

    it('refuses a file used as the output root before compilation or staging', () => {
        const repoRoot = createFixture();
        const targetDir = join(repoRoot, 'output-file');
        writeFileSync(targetDir, 'not a directory');
        const runCargo = vi.fn<CargoRunner>(() => successfulVersion());
        expect(runNativeAddonBuild({ repoRoot, env: { CARGO_TARGET_DIR: targetDir }, runCargo })).toBe(1);
        expect(runCargo).toHaveBeenCalledTimes(1);
        expect(readdirSync(join(repoRoot, 'crates/sourdaw-native'))).toEqual([]);
        expect(console.error).toHaveBeenCalledWith('CARGO_TARGET_DIR must name an output directory');
    });

    it.each([
        {
            label: 'missing host',
            result: { status: 0, stdout: 'cargo 1.92.0\n' },
            error: 'exactly one well-formed native host',
        },
        {
            label: 'malformed host',
            result: { status: 0, stdout: 'host: ../../foreign\n' },
            error: 'exactly one well-formed native host',
        },
        {
            label: 'multiple hosts',
            result: { status: 0, stdout: `host: ${macHost}\nhost: ${macHost}\n` },
            error: 'exactly one well-formed native host',
        },
        {
            label: 'unsupported host',
            result: successfulVersion('x86_64-unknown-freebsd'),
            error: 'unsupported native Cargo host',
        },
        {
            label: 'failed query',
            result: { status: 42, stdout: `host: ${macHost}\n` },
            error: 'cargo -Vv host query failed',
        },
        { label: 'terminated query', result: { status: null }, error: 'cargo -Vv host query failed' },
        {
            label: 'query start failure',
            result: { status: null, error: new Error('ENOENT') },
            error: 'cargo host query failed to start: ENOENT',
        },
    ])('refuses $label before compilation or staging', ({ result, error }) => {
        const repoRoot = createFixture();
        const runCargo = vi.fn<CargoRunner>(() => result);
        expect(runNativeAddonBuild({ repoRoot, env: {}, runCargo })).toBe(1);
        expect(runCargo.mock.calls.map(([args]) => args)).toEqual([['-Vv']]);
        expect(readdirSync(join(repoRoot, 'crates/sourdaw-native'))).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(error));
    });

    it.each([
        { stage: 'addon', result: { status: 9 }, missing: false },
        { stage: 'addon', result: { status: null, error: new Error('ENOENT') }, missing: false },
        { stage: 'addon', result: { status: null }, missing: false },
        { stage: 'addon', result: { status: 0 }, missing: true },
        { stage: 'helper', result: { status: 9 }, missing: false },
        { stage: 'helper', result: { status: null, error: new Error('ENOENT') }, missing: false },
        { stage: 'helper', result: { status: null }, missing: false },
        { stage: 'helper', result: { status: 0 }, missing: true },
    ])('fails closed for $stage with result $result and missing=$missing', ({ stage, result, missing }) => {
        const repoRoot = createFixture();
        const targetDir = join(repoRoot, 'target');
        // Stale outputs in the old guessed directories must never be staged.
        for (const { root, name } of [
            { root: targetDir, name: 'libsourdaw_native.dylib' },
            { root: join(targetDir, 'scan-helper'), name: 'sourdaw-plugin-scan-helper' },
        ]) {
            mkdirSync(join(root, 'release'), { recursive: true });
            writeFileSync(join(root, 'release', name), 'stale guessed artifact');
        }
        const runCargo = vi.fn<CargoRunner>((args) => {
            if (args[0] === '-Vv') {
                return successfulVersion();
            }
            const currentStage = args.includes('--bin') ? 'helper' : 'addon';
            if (currentStage === stage) {
                if (!missing) {
                    const outputRoot = stage === 'helper' ? join(targetDir, 'scan-helper') : targetDir;
                    const output = join(outputRoot, macHost, 'release');
                    mkdirSync(output, { recursive: true });
                    const name = stage === 'helper' ? 'sourdaw-plugin-scan-helper' : 'libsourdaw_native.dylib';
                    writeFileSync(join(output, name), 'artifact left by a failed build');
                }
                return result;
            }
            const output = join(targetDir, macHost, 'release');
            mkdirSync(output, { recursive: true });
            writeFileSync(join(output, 'libsourdaw_native.dylib'), 'fresh addon bytes');
            return { status: 0 };
        });
        expect(runNativeAddonBuild({ repoRoot, env: {}, runCargo })).toBe(1);
        expect(runCargo).toHaveBeenCalledTimes(stage === 'addon' ? 2 : 3);
        expect(existsSync(join(repoRoot, 'crates/sourdaw-native/sourdaw-plugin-scan-helper'))).toBe(false);
        expect(existsSync(join(repoRoot, 'crates/sourdaw-native/sourdaw-native.node'))).toBe(stage === 'helper');
        if (missing) {
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('the cargo build produced no'));
        } else if ('error' in result) {
            expect(console.error).toHaveBeenCalledWith('cargo failed to start: ENOENT');
        } else {
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining(' failed'));
        }
    });

    it('should name the cargo cdylib per platform', () => {
        expect(cdylibFileName('darwin')).toBe('libsourdaw_native.dylib');
        expect(cdylibFileName('linux')).toBe('libsourdaw_native.so');
        expect(cdylibFileName('win32')).toBe('sourdaw_native.dll');
        expect(scanHelperFileName('win32')).toBe('sourdaw-plugin-scan-helper.exe');
        expect(scanHelperFileName('linux')).toBe('sourdaw-plugin-scan-helper');
        expect(() => cdylibFileName('freebsd')).toThrow('unsupported native platform');
        expect(() => scanHelperFileName('freebsd')).toThrow('unsupported native platform');
    });

    it.each(['success', 'build-failure', 'foreign-target'])('executes the symlink-safe CLI for %s', (outcome) => {
        const repoRoot = createFixture();
        const source = resolve(import.meta.dirname, '../buildNativeAddon.ts');
        let cli = source;
        if (process.platform !== 'win32') {
            cli = join(repoRoot, 'build-native.ts');
            symlinkSync(source, cli);
        }
        const preload = join(repoRoot, 'cargo-double.mjs');
        writeFileSync(
            preload,
            `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
childProcess.spawnSync = (command, args) => {
    if (command !== 'cargo') {
        throw new Error('unexpected process');
    }
    if (args[0] === '-Vv') {
        return { status: 0, stdout: 'host: ${macHost}\\n' };
    }
    if (${outcome === 'build-failure'}) {
        return { status: 9 };
    }
    const output = join(args[args.indexOf('--target-dir') + 1], args[args.indexOf('--target') + 1], 'release');
    mkdirSync(output, { recursive: true });
    const helper = args.includes('--bin');
    writeFileSync(join(output, helper ? 'sourdaw-plugin-scan-helper' : 'libsourdaw_native.dylib'), helper ? 'CLI helper' : 'CLI addon', { mode: 0o751 });
    return { status: 0 };
};
syncBuiltinESMExports();
`
        );
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, cli], {
            cwd: repoRoot,
            env: {
                ...process.env,
                CARGO_BUILD_TARGET: outcome === 'foreign-target' ? 'wasm32-unknown-unknown' : macHost,
                CARGO_TARGET_DIR: 'CLI target root',
            },
            encoding: 'utf8',
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(outcome === 'success' ? 0 : 1);
        if (outcome === 'build-failure') {
            expect(result.stderr).toContain('cargo build --lib --package sourdaw-native --features napi-addon failed');
            expect(readdirSync(join(repoRoot, 'crates/sourdaw-native'))).toEqual([]);
        } else if (outcome === 'foreign-target') {
            expect(result.stderr).toContain(
                `CARGO_BUILD_TARGET must be the native Cargo host ${macHost} or host-tuple`
            );
            expect(readdirSync(join(repoRoot, 'crates/sourdaw-native'))).toEqual([]);
            expect(existsSync(join(repoRoot, 'CLI target root'))).toBe(false);
        } else {
            expect(readFileSync(join(repoRoot, 'crates/sourdaw-native/sourdaw-native.node'), 'utf8')).toBe('CLI addon');
            expect(readFileSync(join(repoRoot, 'crates/sourdaw-native/sourdaw-plugin-scan-helper'), 'utf8')).toBe(
                'CLI helper'
            );
        }
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
