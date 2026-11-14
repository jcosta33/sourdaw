// @vitest-environment node

import {
    chmodSync,
    constants,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    ensurePrivateNativeTypeScriptDirectory,
    getPreparedNativeTypeScriptPath,
    nativeTypeScriptCacheDirectory,
    nativeTypeScriptIdentity,
} from '../nativeTypeScript/compiler.mjs';

let root: string;
let directory: string;
let binary: string;
let previous: string | undefined;
let originalBinary: string;

beforeEach(() => {
    originalBinary = getPreparedNativeTypeScriptPath();
    const receipt = readFileSync(join(dirname(originalBinary), 'receipt.json'));
    root = mkdtempSync(join(tmpdir(), 'sourdaw-native-cache-'));
    previous = process.env.SOURDAW_NATIVE_TS_CACHE;
    process.env.SOURDAW_NATIVE_TS_CACHE = root;
    directory = nativeTypeScriptCacheDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    binary = join(directory, process.platform === 'win32' ? 'tsgo.exe' : 'tsgo');
    copyFileSync(originalBinary, binary, constants.COPYFILE_FICLONE);
    chmodSync(binary, 0o700);
    writeFileSync(join(directory, 'receipt.json'), receipt, { mode: 0o600 });
    expect(getPreparedNativeTypeScriptPath()).toBe(binary);
});

afterEach(() => {
    if (previous === undefined) delete process.env.SOURDAW_NATIVE_TS_CACHE;
    else process.env.SOURDAW_NATIVE_TS_CACHE = previous;
    rmSync(root, { recursive: true, force: true });
});

describe.runIf(process.platform !== 'win32')('native compiler private cache on Unix', () => {
    it('accepts the genuine prepared binary and matching original receipt in a private owned fence', () => {
        expect(getPreparedNativeTypeScriptPath()).toBe(binary);
    });

    it('binds the cache directory to the complete patched graph identity', () => {
        const identity = nativeTypeScriptIdentity();
        expect(identity.patchedGoModSha256).not.toBe(identity.goModSha256);
        expect(identity.patchedGoSumSha256).not.toBe(identity.goSumSha256);
        expect(nativeTypeScriptCacheDirectory({ ...identity, patchedGoModSha256: identity.goModSha256 })).not.toBe(
            directory
        );
    });

    it('refuses original module hashes presented as the patched build outputs', () => {
        const path = join(directory, 'receipt.json');
        const receipt = JSON.parse(readFileSync(path, 'utf8'));
        receipt.patchedGoModSha256 = receipt.goModSha256;
        receipt.patchedGoSumSha256 = receipt.goSumSha256;
        writeFileSync(path, JSON.stringify(receipt));
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a selected graph change even when that module is absent from the actual binary dependencies', () => {
        const path = join(directory, 'receipt.json');
        const receipt = JSON.parse(readFileSync(path, 'utf8'));
        const module = receipt.goModules.find(
            (module: { path: string }) =>
                !receipt.compiledGoModules.some((compiled: { path: string }) => compiled.path === module.path)
        );
        expect(module).toBeDefined();
        if (!module) throw new Error('Expected a tool or test dependency outside this host binary');
        module.version = 'v0.0.0';
        writeFileSync(path, JSON.stringify(receipt));
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses the old actual compiler dependency graph with an otherwise matching genuine binary receipt', () => {
        const path = join(directory, 'receipt.json');
        const receipt = JSON.parse(readFileSync(path, 'utf8'));
        const module = receipt.compiledGoModules.find(
            (module: { path: string }) => module.path === 'github.com/go-json-experiment/json'
        );
        expect(module?.version).toBe('v1.27.2');
        receipt.buildInfo = receipt.buildInfo.replace(
            '\tgithub.com/go-json-experiment/json\tv1.27.2\t',
            '\tgithub.com/go-json-experiment/json\tv0.0.0-20260623181947-01eb4420fa68\t'
        );
        module.version = 'v0.0.0-20260623181947-01eb4420fa68';
        writeFileSync(path, JSON.stringify(receipt));
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a public executable even when its bytes and receipt are genuine', () => {
        chmodSync(binary, 0o755);
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a writable cache fence even when its binary and receipt are genuine', () => {
        chmodSync(root, 0o777);
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a writable existing root before preparation creates any descendant', () => {
        chmodSync(root, 0o777);
        const child = join(root, 'must-not-be-created');
        expect(() => ensurePrivateNativeTypeScriptDirectory(child)).toThrow('not owned/private');
        expect(existsSync(child)).toBe(false);
    });

    it('refuses an intermediate symlink before creating anything in its target', () => {
        const outside = mkdtempSync(join(tmpdir(), 'sourdaw-outside-cache-'));
        try {
            symlinkSync(outside, join(root, 'linked'));
            expect(() => ensurePrivateNativeTypeScriptDirectory(join(root, 'linked', 'child'))).toThrow(
                'not owned/private'
            );
            expect(existsSync(join(outside, 'child'))).toBe(false);
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    it('refuses a preparation target outside its private fence', () => {
        expect(() => ensurePrivateNativeTypeScriptDirectory(dirname(root))).toThrow('outside the private cache');
    });

    it('refuses a symlinked executable that resolves to the exact genuine prepared bytes', () => {
        unlinkSync(binary);
        symlinkSync(originalBinary, binary);
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a symlinked receipt that points to the exact original private receipt', () => {
        const receipt = join(directory, 'receipt.json');
        unlinkSync(receipt);
        symlinkSync(join(dirname(originalBinary), 'receipt.json'), receipt);
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a stock protocol identity even when the prepared binary bytes match', () => {
        const receipt = join(directory, 'receipt.json');
        const original = readFileSync(receipt, 'utf8');
        expect(original).toContain('sourdaw-native-typescript-getAwaitedType-v1');
        writeFileSync(
            receipt,
            original.replace('sourdaw-native-typescript-getAwaitedType-v1', 'unmodified-upstream-protocol')
        );
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });
});
