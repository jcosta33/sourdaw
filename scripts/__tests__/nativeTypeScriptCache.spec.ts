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
