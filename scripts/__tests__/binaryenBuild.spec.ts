import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    assertArchiveDigest,
    assertArchiveEntries,
    assertBinaryenIdentity,
    assertRecordedBinaryenIdentity,
    buildCommand,
    parseBinaryenIdentity,
    parseBuildGeneration,
    readBoundedArchive,
    validateBuildReceipt,
} from '../binaryenBuild.ts';

const temporary: string[] = [];
afterEach(() => {
    for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function temporaryRoot(prefix: string): string {
    const path = mkdtempSync(join(tmpdir(), prefix));
    temporary.push(path);
    return path;
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const official = {
    host: 'darwin-arm64',
    release: 'version_133',
    archive: 'binaryen-version_133-arm64-macos.tar.gz',
    archiveSha256: 'ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8',
    executable: 'binaryen-version_133/bin/wasm-opt',
    executableSha256: 'a'.repeat(64),
    version: 'wasm-opt version 133',
};

describe('Binaryen build provenance', () => {
    it('covers every package route without shell-interpolated arguments', () => {
        for (const id of ['daw-dsp', 'proof-chamber', 'scoring', 'daw-wasm-decoder']) {
            const args = buildCommand(id);
            expect(args.slice(0, 5)).toEqual(['build', '--target', 'web', '--out-dir', `../../public/wasm/${id}`]);
            expect(args.includes('--no-typescript')).toBe(id === 'daw-wasm-decoder');
        }
        expect(() => buildCommand('scoring; injection')).toThrow();
    });
    it('rejects an absent optimizer rather than falling back to PATH', () => {
        const root = temporaryRoot('binaryen-absent-');
        expect(() =>
            assertBinaryenIdentity({ ...official, executablePath: join(root, 'absent') }, () => 'wasm-opt version 133')
        ).toThrow();
    });
    it('accepts a regular contained archive listing and a matching digest', () => {
        const bytes = Buffer.from('checksum fixture');
        expect(() => assertArchiveDigest(bytes, digest(bytes))).not.toThrow();
        expect(() =>
            assertArchiveEntries(
                ['binaryen-version_133/', 'binaryen-version_133/bin/wasm-opt'],
                ['drwxr-xr-x root', '-rwxr-xr-x binary']
            )
        ).not.toThrow();
    });
    it('rejects checksum mismatch before extraction or execution', () => {
        expect(() => assertArchiveDigest(Buffer.from('untrusted'), official.archiveSha256)).toThrow('checksum');
    });
    it.each(['../escape', '/absolute', 'binaryen-version_133/../../escape', 'binaryen-version_133/bin\\wasm-opt'])(
        'rejects archive path %s',
        (entry) => {
            expect(() => assertArchiveEntries([entry], ['-rwxr-xr-x payload'])).toThrow();
        }
    );
    it.each(['l', 'h'])('rejects archive link type %s', (type) => {
        expect(() => assertArchiveEntries(['binaryen-version_133/bin/wasm-opt'], [`${type}rwxr-xr-x payload`])).toThrow(
            'regular'
        );
    });
    it('refuses private absolute paths in a published optimizer identity', () => {
        expect(() => parseBinaryenIdentity({ ...official, executablePath: '/Users/private/.cache/wasm-opt' })).toThrow(
            'private'
        );
        expect(() => parseBinaryenIdentity({ ...official, executable: '/Users/private/.cache/wasm-opt' })).toThrow();
    });
    it('checks offline executable identity against the hash extracted from the authenticated official asset', () => {
        const authenticated = {
            ...official,
            executableSha256: '81041e09f332df94db1c2009a64d8f3b85f0431a2c920ccd014d3ceebb343402',
        };
        expect(assertRecordedBinaryenIdentity(authenticated)).toEqual(authenticated);
        expect(() => assertRecordedBinaryenIdentity(official)).toThrow('executable pin');
    });
    it('accepts only the official host archive digest, regardless of a claimed runtime version', () => {
        expect(() => parseBinaryenIdentity({ ...official, archiveSha256: 'b'.repeat(64) })).toThrow();
        expect(() => parseBinaryenIdentity({ ...official, host: 'linux-x64' })).toThrow();
        expect(parseBinaryenIdentity(official)).toEqual(official);
    });
    it('rejects a substituted executable even when it would print version 133', () => {
        const root = temporaryRoot('binaryen-binding-');
        const binary = join(root, 'wasm-opt');
        writeFileSync(binary, '#!/bin/sh\necho "wasm-opt version 133"\n', { mode: 0o700 });
        expect(() =>
            assertBinaryenIdentity({ ...official, executablePath: binary }, () => 'wasm-opt version 133')
        ).toThrow('bytes');
    });
    it('rejects symlink executable before invoking it', () => {
        const root = temporaryRoot('binaryen-link-');
        const binary = join(root, 'real');
        writeFileSync(binary, 'fixture');
        const link = join(root, 'wasm-opt');
        symlinkSync(binary, link);
        expect(() =>
            assertBinaryenIdentity(
                { ...official, executablePath: link, executableSha256: digest(readFileSync(binary)) },
                () => 'wasm-opt version 133'
            )
        ).toThrow('symlink');
    });
    it('compares executable bytes and observes version at the process boundary', () => {
        const root = temporaryRoot('binaryen-positive-');
        const binary = join(root, 'wasm-opt');
        writeFileSync(binary, 'archive-derived fixture');
        const identity = { ...official, executablePath: binary, executableSha256: digest(readFileSync(binary)) };
        expect(assertBinaryenIdentity(identity, () => 'wasm-opt version 133')).toEqual(identity);
        expect(() => assertBinaryenIdentity(identity, () => 'wasm-opt version 130')).toThrow('version');
    });
    it('refuses executable mutation during the observed version call', () => {
        const root = temporaryRoot('binaryen-version-tamper-');
        const path = join(root, 'wasm-opt');
        writeFileSync(path, 'authentic fixture');
        const identity = { ...official, executablePath: path, executableSha256: digest(readFileSync(path)) };
        expect(() =>
            assertBinaryenIdentity(identity, () => {
                writeFileSync(path, 'changed during version call');
                return official.version;
            })
        ).toThrow('changed during version');
    });
    const expected = {
        head: 'a'.repeat(40),
        sourceHash: 'sha256:' + 'b'.repeat(64),
        inputsHash: 'sha256:' + 'e'.repeat(64),
        command: ['build'],
        artifacts: { 'out.wasm': 'sha256:' + 'c'.repeat(64) },
    };
    const receipt = { version: 1, packageId: 'scoring', ...expected, optimizer: official };
    it('publishes only logical optimizer identity while dropping the local runtime path', () => {
        const published = parseBuildGeneration({ ...receipt, optimizerPath: '/Users/private/.cache/wasm-opt' });
        expect(JSON.stringify(published)).not.toContain('/Users/private');
        expect(published.optimizer.executable).toBe('binaryen-version_133/bin/wasm-opt');
    });
    it('accepts a helper success receipt only when head, command, source and outputs agree', () => {
        expect(validateBuildReceipt(receipt, expected)).toEqual(receipt);
    });
    it.each(['head', 'sourceHash', 'inputsHash', 'command', 'artifacts'])(
        'rejects a receipt with altered %s',
        (field) => {
            const changed = { ...receipt };
            Reflect.set(changed, field, 'changed');
            expect(() => validateBuildReceipt(changed, expected)).toThrow();
        }
    );
    it('rejects caller-only version claims and absent receipt', () => {
        expect(() => validateBuildReceipt({ version: '133' }, expected)).toThrow();
        expect(() => validateBuildReceipt(undefined, expected)).toThrow();
    });
});

describe('bounded Binaryen archive response', () => {
    const bytes = Buffer.from('verified archive fixture');
    it('streams exactly the official size and digest', async () => {
        await expect(
            readBoundedArchive(new Response(bytes), bytes.length, digest(bytes), new AbortController().signal)
        ).resolves.toEqual(bytes);
    });
    it.each(['oversize', 'short', 'header', 'checksum'])('refuses %s before returning an archive', async (failure) => {
        const response = new Response(
            failure === 'short' ? bytes.subarray(1) : failure === 'oversize' ? Buffer.concat([bytes, bytes]) : bytes,
            failure === 'header' ? { headers: { 'content-length': '1' } } : {}
        );
        await expect(
            readBoundedArchive(
                response,
                bytes.length,
                failure === 'checksum' ? '0'.repeat(64) : digest(bytes),
                new AbortController().signal
            )
        ).rejects.toThrow();
    });
    it('cancels an unfinished stream when its explicit signal aborts', async () => {
        const controller = new AbortController();
        let admitted: (() => void) | undefined;
        const ready = new Promise<void>((resolve) => {
            admitted = resolve;
        });
        const stream = new ReadableStream<Uint8Array>({
            pull: () => {
                admitted?.();
            },
        });
        const pending = readBoundedArchive(new Response(stream), bytes.length, digest(bytes), controller.signal);
        await ready;
        controller.abort(new Error('qualification timeout'));
        await expect(pending).rejects.toThrow('qualification timeout');
    });
});
