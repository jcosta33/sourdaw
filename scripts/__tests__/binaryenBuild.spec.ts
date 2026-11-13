import { createHash } from 'node:crypto';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    writeFileSync,
    symlinkSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    assertArchiveDigest,
    assertArchiveEntries,
    assertBinaryenIdentity,
    assertRecordedBinaryenIdentity,
    buildCommand,
    generationInputsHash,
    wasmGenerationEnvironment,
    parseBinaryenIdentity,
    parseBuildGeneration,
    readBoundedArchive,
    validateBuildReceipt,
} from '../binaryenBuild.ts';

import { snapshotImportSpecifiers, trustedLocalImportClosure } from '../trustedGithubWriteBootstrap.ts';
import { wasmArtifacts } from '../wasm-artifacts.ts';

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

const packageIds = ['daw-dsp', 'proof-chamber', 'scoring', 'daw-wasm-decoder'];
function producerEntries(id: string): string[] {
    const entries = [
        'scripts/buildWasmPackage.ts',
        'scripts/markWasmPackageInternal.ts',
        'scripts/gen-wasm-manifest.ts',
    ];
    if (id !== 'daw-wasm-decoder') {
        entries.push(`scripts/gen-${id}-worklet.ts`);
    }
    return entries;
}
function actualProducerClosure(id: string): string[] {
    return [
        ...new Set(
            producerEntries(id).flatMap((entry) => [
                ...trustedLocalImportClosure(entry, (path) => readFileSync(join(wasmArtifacts.repoRoot, path), 'utf8')),
            ])
        ),
    ].sort();
}
function writeFixture(root: string, path: string, contents: string): void {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
}
function generationFixture(id = 'scoring'): string {
    const root = temporaryRoot('wasm-selected-generation-');
    mkdirSync(join(root, 'node_modules'));
    cpSync(realpathSync(join(wasmArtifacts.repoRoot, 'node_modules/yaml')), join(root, 'node_modules/yaml'), {
        recursive: true,
    });
    for (const path of new Set([...actualProducerClosure(id), 'scripts/pnpmLock.ts'])) {
        writeFixture(root, path, readFileSync(join(wasmArtifacts.repoRoot, path), 'utf8'));
    }
    const live = JSON.parse(readFileSync(join(wasmArtifacts.repoRoot, 'package.json'), 'utf8'));
    writeFixture(
        root,
        'package.json',
        JSON.stringify({
            type: 'module',
            packageManager: live.packageManager,
            engines: live.engines,
            scripts: live.scripts,
            dependencies: { unrelated: '1.0.0' },
            devDependencies: { yaml: '2.9.1' },
        })
    );
    writeFixture(root, '.node-version', '26.13.1\n');
    writeFixture(root, '.cargo/config.toml', '[build]\nrustflags = ["--cfg", "fixture"]\n');
    writeFixture(root, 'rust-toolchain.toml', '[toolchain]\nchannel = "1.100.0"\n');
    writeFixture(
        root,
        'Cargo.toml',
        '[workspace]\nmembers = ["crates/scoring"]\nresolver = "2"\n[workspace.dependencies]\nactive = "1.0.0"\n[profile.release]\nopt-level = 3\n'
    );
    writeFixture(
        root,
        'crates/scoring/Cargo.toml',
        '[package]\nname = "scoring"\nversion = "0.1.0"\n[dependencies]\nactive = { workspace = true }\n'
    );
    writeFixture(root, 'crates/scoring/src/lib.rs', 'pub fn value() -> u32 { 7 }\n');
    writeFixture(
        root,
        'Cargo.lock',
        `version = 4
[[package]]
name = "scoring"
version = "0.1.0"
dependencies = ["active"]
[[package]]
name = "active"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${'a'.repeat(64)}"
[[package]]
name = "native-unrelated"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${'b'.repeat(64)}"
`
    );
    writeFixture(
        root,
        'pnpm-lock.yaml',
        `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      unrelated: {specifier: 1.0.0, version: 1.0.0}
    devDependencies:
      yaml: {specifier: 2.9.1, version: 2.9.1}
packages:
  yaml@2.9.1:
    resolution: {integrity: sha512-Zml4dHVyZQ==}
  unrelated@1.0.0:
    resolution: {integrity: sha512-dW5yZWxhdGVk}
snapshots:
  yaml@2.9.1: {}
  unrelated@1.0.0: {}
`
    );
    return root;
}
function editFixture(root: string, path: string, edit: (text: string) => string): void {
    writeFixture(root, path, edit(readFileSync(join(root, path), 'utf8')));
}
function fixtureSourceHash(root: string): string {
    return wasmArtifacts.hashCrateClosure('crates/scoring', readFileSync(join(root, 'Cargo.toml'), 'utf8'), root);
}
function fixtureReceipt(root: string) {
    return {
        version: 1,
        packageId: 'scoring',
        head: 'e'.repeat(40),
        sourceHash: fixtureSourceHash(root),
        inputsHash: generationInputsHash(root, 'scoring'),
        command: buildCommand('scoring'),
        artifacts: { 'out.wasm': `sha256:${'c'.repeat(64)}` },
        optimizer: official,
    };
}

describe('selected WASM generation freshness', () => {
    it.each([
        'unreachable Cargo lock record',
        'workspace member',
        'workspace comment',
        'application dependency',
        'unselected script',
        'unrelated npm lock record',
        'documentation',
    ])('preserves a current receipt after an unrelated %s change', (change) => {
        const root = generationFixture();
        const receipt = fixtureReceipt(root);
        switch (change) {
            case 'unreachable Cargo lock record':
                editFixture(root, 'Cargo.lock', (text) => text.replace('b'.repeat(64), 'd'.repeat(64)));
                break;
            case 'workspace member':
                editFixture(root, 'Cargo.toml', (text) =>
                    text.replace(
                        'members = ["crates/scoring"]',
                        'members = ["crates/scoring", "crates/native-unrelated"]'
                    )
                );
                break;
            case 'workspace comment':
                editFixture(root, 'Cargo.toml', (text) => `${text}# unrelated documentation\n`);
                break;
            case 'application dependency':
                editFixture(root, 'package.json', (text) => {
                    const data = JSON.parse(text);
                    data.dependencies.unrelated = '2.0.0';
                    return JSON.stringify(data);
                });
                break;
            case 'unselected script':
                editFixture(root, 'package.json', (text) => {
                    const data = JSON.parse(text);
                    data.scripts['wasm:dsp'] += ' --unselected';
                    return JSON.stringify(data);
                });
                break;
            case 'unrelated npm lock record':
                editFixture(root, 'pnpm-lock.yaml', (text) =>
                    text.replace('sha512-dW5yZWxhdGVk', 'sha512-bmV3dW5yZWxhdGVk')
                );
                break;
            case 'documentation':
                writeFixture(root, 'README.md', 'Documentation changed\n');
                break;
        }
        expect(fixtureSourceHash(root)).toBe(receipt.sourceHash);
        expect(generationInputsHash(root, 'scoring')).toBe(receipt.inputsHash);
        expect(() =>
            validateBuildReceipt(receipt, {
                ...receipt,
                sourceHash: fixtureSourceHash(root),
                inputsHash: generationInputsHash(root, 'scoring'),
            })
        ).not.toThrow();
    });
    it.each([
        'selected source',
        'reachable Cargo dependency',
        'used workspace dependency',
        'release profile',
        'root flags',
        'selected script',
        'Node pin',
        'selected yaml archive',
        'polyfill',
        'nested marker helper',
    ])('refuses a stale receipt after a %s change', (change) => {
        const root = generationFixture();
        const receipt = fixtureReceipt(root);
        switch (change) {
            case 'selected source':
                editFixture(root, 'crates/scoring/src/lib.rs', (text) => text.replace('7', '8'));
                break;
            case 'reachable Cargo dependency':
                editFixture(root, 'Cargo.lock', (text) => text.replace('a'.repeat(64), 'd'.repeat(64)));
                break;
            case 'used workspace dependency':
                editFixture(root, 'Cargo.toml', (text) => text.replace('active = "1.0.0"', 'active = "2.0.0"'));
                break;
            case 'release profile':
                editFixture(root, 'Cargo.toml', (text) => text.replace('opt-level = 3', 'opt-level = 2'));
                break;
            case 'root flags':
                editFixture(root, '.cargo/config.toml', (text) => text.replace('fixture', 'changed'));
                break;
            case 'selected script':
                editFixture(root, 'package.json', (text) => {
                    const data = JSON.parse(text);
                    data.scripts['wasm:scoring'] += ' --changed';
                    return JSON.stringify(data);
                });
                break;
            case 'Node pin':
                writeFixture(root, '.node-version', '26.14.0\n');
                break;
            case 'selected yaml archive':
                editFixture(root, 'pnpm-lock.yaml', (text) =>
                    text.replace('sha512-Zml4dHVyZQ==', 'sha512-Y2hhbmdlZA==')
                );
                break;
            case 'polyfill':
                editFixture(root, 'scripts/workletPolyfills.ts', (text) => `${text}\n// relevant producer edit\n`);
                break;
            case 'nested marker helper':
                editFixture(root, 'scripts/strictJson.ts', (text) => `${text}\n// relevant producer edit\n`);
                break;
        }
        expect(() =>
            validateBuildReceipt(receipt, {
                ...receipt,
                sourceHash: fixtureSourceHash(root),
                inputsHash: generationInputsHash(root, 'scoring'),
            })
        ).toThrow();
    });
    it('refuses an unmodelled yaml runtime dependency instead of silently shrinking the producer closure', () => {
        const root = generationFixture();
        editFixture(root, 'pnpm-lock.yaml', (text) =>
            text.replace('yaml@2.9.1: {}', 'yaml@2.9.1:\n    dependencies: {new-runtime: 1.0.0}')
        );
        expect(() => generationInputsHash(root, 'scoring')).toThrow('explicit closure update');
    });
    it.each(packageIds)(
        'binds every actual local producer import for %s without importing the graph at runtime',
        (id) => {
            const root = generationFixture(id);
            const baseline = generationInputsHash(root, id);
            const closure = actualProducerClosure(id);
            const externals = new Set(
                closure
                    .flatMap((path) =>
                        snapshotImportSpecifiers(readFileSync(join(wasmArtifacts.repoRoot, path), 'utf8'))
                    )
                    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
            );
            expect([...externals].sort()).toEqual(['yaml']);
            for (const path of closure) {
                const previous = readFileSync(join(root, path), 'utf8');
                editFixture(root, path, (text) => `${text}\n// producer mutation\n`);
                expect(generationInputsHash(root, id), path).not.toBe(baseline);
                writeFixture(root, path, previous);
            }
        }
    );
});

describe('generation loader environment', () => {
    it('removes inherited loader substitution while preserving PATH and compiler flags without mutating its source', () => {
        const input = {
            PATH: '/verified/toolchain',
            CARGO_ENCODED_RUSTFLAGS: '-Cembed-bitcode=no',
            LD: 'custom-linker',
            DYLD_INSERT_LIBRARIES: '/foreign/sentinel.dylib',
            DYLD_LIBRARY_PATH: '/foreign/lib',
            DYLD_FALLBACK_LIBRARY_PATH: '/foreign/fallback',
            DYLD_FRAMEWORK_PATH: '/foreign/frameworks',
            DYLD_FALLBACK_FRAMEWORK_PATH: '/foreign/fallback-frameworks',
            DYLD_VERSIONED_LIBRARY_PATH: '/foreign/versioned-lib',
            DYLD_VERSIONED_FRAMEWORK_PATH: '/foreign/versioned-frameworks',
            DYLD_IMAGE_SUFFIX: '_foreign',
            DYLD_ROOT_PATH: '/foreign/root',
            DYLD_SHARED_CACHE_DIR: '/foreign/cache',
            DYLD_SHARED_REGION: 'private',
            LD_PRELOAD: '/foreign/injected.so',
            LD_LIBRARY_PATH: '/foreign/libs',
            LD_AUDIT: '/foreign/audit.so',
        };
        expect(wasmGenerationEnvironment(input)).toEqual({
            PATH: input.PATH,
            CARGO_ENCODED_RUSTFLAGS: input.CARGO_ENCODED_RUSTFLAGS,
            LD: input.LD,
        });
        expect(input.DYLD_INSERT_LIBRARIES).toBe('/foreign/sentinel.dylib');
    });
});
