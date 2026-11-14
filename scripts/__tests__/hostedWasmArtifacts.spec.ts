import { createHash } from 'node:crypto';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Zip, ZipDeflate, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { buildCommand, generationInputsHash } from '../binaryenBuild';

import {
    buildHostedWasmArtifacts,
    collectHostedArtifacts,
    hostedArtifactPaths,
    planHostedWasmBuild,
    readHostedBuildIdentity,
    selectHostedWasmPackages,
    verifyHostedWasmReturn,
} from '../hostedWasmArtifacts';
import { readHostedArtifactZip as decodeHostedArtifactZip } from '../hostedWasmZip';
import { hostedWasmTriggerPaths } from '../hostedWasmWorkflowContract';
import { wasmArtifacts } from '../wasm-artifacts';

const readHostedArtifactZip = (zip: Buffer) =>
    decodeHostedArtifactZip(zip, hostedArtifactPaths(['scoring', 'proof-chamber']).length + 1);
const fixedZipFixtureMtime = new Date(Date.UTC(2026, 0, 1, 12));

describe('hosted WASM package selection', () => {
    const manifest = wasmArtifacts.readManifest();
    const sourceHashes = Object.fromEntries(
        wasmArtifacts.packages.map((spec) => [spec.id, manifest.packages[spec.id]!.crateSourceHash])
    );

    it('does not build or stamp a current package', () => {
        expect(selectHostedWasmPackages({ manifest, sourceHashes, changedPaths: [] })).toEqual([]);
    });

    it('admits vendored source changes at the trigger while selecting only packages with changed reachable hashes', () => {
        expect(hostedWasmTriggerPaths()).toContain('vendor/rust/**');
        const changedPaths = ['vendor/rust/visibility-0.1.1/src/lib.rs'];
        expect(selectHostedWasmPackages({ manifest, sourceHashes, changedPaths })).toEqual([]);
        expect(
            selectHostedWasmPackages({
                manifest,
                sourceHashes: { ...sourceHashes, scoring: `sha256:${'c'.repeat(64)}` },
                changedPaths,
            })
        ).toEqual(['scoring']);
    });

    it('selects only the stale supported package', () => {
        expect(
            selectHostedWasmPackages({
                manifest,
                sourceHashes: { ...sourceHashes, scoring: `sha256:${'a'.repeat(64)}` },
                changedPaths: [],
            })
        ).toEqual(['scoring']);
    });

    it('builds all supported packages when the hosted workflow is introduced', () => {
        expect(
            selectHostedWasmPackages({ manifest, sourceHashes, changedPaths: ['.github/workflows/wasm-artifacts.yml'] })
        ).toEqual(['scoring', 'proof-chamber', 'daw-dsp']);
    });

    it.each([
        '.cargo/config.toml',
        '.node-version',
        'scripts/hostedWasmArtifacts.ts',
        'scripts/hostedWasmSourceContext.ts',
        'scripts/hostedWasmZip.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/pnpmLock.ts',
        'scripts/binaryenBuild.ts',
        'scripts/strictJson.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/workletPolyfills.ts',
        'scripts/gen-wasm-manifest.ts',
        'scripts/buildWasmPackage.ts',
        'scripts/markWasmPackageInternal.ts',
        'scripts/verify-wasm-artifacts.ts',
        'rust-toolchain.toml',
        'package.json',
        'pnpm-lock.yaml',
    ])('selects all supported packages for shared input %s', (path) => {
        expect(selectHostedWasmPackages({ manifest, sourceHashes, changedPaths: [path] })).toEqual([
            'scoring',
            'proof-chamber',
            'daw-dsp',
        ]);
    });

    it('selects the owner of a changed generator', () => {
        expect(
            selectHostedWasmPackages({ manifest, sourceHashes, changedPaths: ['scripts/gen-proof-chamber-worklet.ts'] })
        ).toEqual(['proof-chamber']);
    });

    it('selects only stale daw-dsp and never selects unchanged decoder', () => {
        expect(
            selectHostedWasmPackages({
                manifest,
                sourceHashes: { ...sourceHashes, 'daw-dsp': `sha256:${'b'.repeat(64)}` },
                changedPaths: [],
            })
        ).toEqual(['daw-dsp']);
    });

    it('selects daw-dsp for its worklet generator', () => {
        expect(
            selectHostedWasmPackages({ manifest, sourceHashes, changedPaths: ['scripts/gen-daw-dsp-worklet.ts'] })
        ).toEqual(['daw-dsp']);
    });

    it('refuses stale decoder sources without expanding the build', () => {
        expect(() =>
            selectHostedWasmPackages({
                manifest,
                sourceHashes: { ...sourceHashes, 'daw-wasm-decoder': `sha256:${'b'.repeat(64)}` },
                changedPaths: [],
            })
        ).toThrow('Unsupported stale WASM package: daw-wasm-decoder');
    });

    it('refuses missing provenance', () => {
        expect(() => selectHostedWasmPackages({ manifest, sourceHashes: {}, changedPaths: [] })).toThrow(
            'Invalid WASM source provenance'
        );
    });
});

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const path of temporaryDirectories.splice(0)) {
        rmSync(path, { recursive: true, force: true });
    }
});

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const identity = readHostedBuildIdentity({
    BUILD_REPOSITORY: 'owner/sourdaw',
    BUILD_PR: '12',
    BUILD_HEAD_SHA: headSha,
    BUILD_BASE_SHA: baseSha,
    BUILD_WORKFLOW_REF: 'owner/sourdaw/.github/workflows/wasm-artifacts.yml@refs/pull/12/merge',
    BUILD_WORKFLOW_SHA: 'c'.repeat(40),
    BUILD_RUN_ID: '100',
    BUILD_RUN_ATTEMPT: '1',
});

function fixture(selected = ['scoring', 'proof-chamber']) {
    const directory = mkdtempSync(join(tmpdir(), 'hosted-wasm-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'source');
    mkdirSync(root);
    mkdirSync(join(root, 'node_modules'));
    cpSync(realpathSync(join(wasmArtifacts.repoRoot, 'node_modules/yaml')), join(root, 'node_modules/yaml'), {
        recursive: true,
    });
    for (const path of [
        'Cargo.toml',
        'Cargo.lock',
        'pnpm-lock.yaml',
        '.node-version',
        '.cargo/config.toml',
        'rust-toolchain.toml',
        'scripts/binaryenBuild.ts',
        'scripts/pnpmLock.ts',
        'scripts/strictJson.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/workletPolyfills.ts',
        'scripts/gen-wasm-manifest.ts',
        'scripts/buildWasmPackage.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/markWasmPackageInternal.ts',
        'scripts/gen-daw-dsp-worklet.ts',
        'scripts/gen-proof-chamber-worklet.ts',
        'scripts/gen-scoring-worklet.ts',
    ]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), readFileSync(join(wasmArtifacts.repoRoot, path)));
    }
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            ...JSON.parse(readFileSync(join(wasmArtifacts.repoRoot, 'package.json'), 'utf8')),
            packageManager: 'pnpm@11.6.0',
        })
    );
    for (const path of hostedArtifactPaths(selected)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), `generated ${path}`);
    }
    // Generated child output is the process boundary; real hosted qualification parses/binds it.
    const packages = Object.fromEntries(
        selected.map((id) => {
            const spec = wasmArtifacts.packages.find((candidate) => candidate.id === id);
            if (!spec) throw new Error('Missing package fixture');
            const artifacts = Object.fromEntries(
                spec.artifacts.map((path) => [
                    path,
                    `sha256:${createHash('sha256')
                        .update(readFileSync(join(root, path)))
                        .digest('hex')}`,
                ])
            );
            return [
                id,
                {
                    generation: {
                        version: 1,
                        packageId: id,
                        head: headSha,
                        sourceHash: wasmArtifacts.hashCrateClosure(spec.crateDir),
                        inputsHash: generationInputsHash(root, id),
                        command: buildCommand(id),
                        artifacts,
                        optimizer: {
                            host: 'linux-x64',
                            release: 'version_133',
                            archive: 'binaryen-version_133-x86_64-linux.tar.gz',
                            archiveSha256: '2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489',
                            executable: 'binaryen-version_133/bin/wasm-opt',
                            executableSha256: 'd'.repeat(64),
                            version: 'wasm-opt version 133',
                        },
                    },
                },
            ];
        })
    );
    writeFileSync(join(root, 'public/wasm/manifest.json'), JSON.stringify({ packages }));
    const commands: string[][] = [];
    let changed: string[] = [];
    const capture = (command: string, args: string[]) => {
        if (command === 'git') {
            if (args[0] === 'rev-parse') {
                return headSha;
            }
            if (args[0] === 'diff') {
                return changed.join('\0');
            }
            if (args[0] === 'ls-files') {
                return '';
            }
        }
        const versions: Record<string, string> = {
            'wasm-pack': `wasm-pack ${wasmArtifacts.pinnedToolchain.wasmPack}`,
            rustup: `${wasmArtifacts.rustToolchainChannel()}-x86_64-unknown-linux-gnu (overridden)`,
            rustc: 'rustc 1.96.0-nightly',
            pnpm: '11.6.0',
            node: 'v24.19.0',
        };
        const version = versions[command];
        if (version) {
            return version;
        }
        throw new Error(`Unexpected capture ${command} ${args.join(' ')}`);
    };
    const run = (command: string, args: string[]) => {
        commands.push([command, ...args]);
    };
    return {
        root,
        outputDirectory: join(directory, 'qualified'),
        selected,
        identity,
        commands,
        capture,
        run,
        setChanged: (paths: string[]) => {
            changed = paths;
        },
    };
}

describe('hosted build qualification', () => {
    it.each(['optimizer', 'head', 'artifacts'])('refuses altered actual build %s before upload', (field) => {
        const input = fixture(['scoring']);
        const path = join(input.root, 'public/wasm/manifest.json');
        const data = JSON.parse(readFileSync(path, 'utf8'));
        data.packages.scoring.generation[field] = 'invalid';
        writeFileSync(path, JSON.stringify(data));
        expect(() => buildHostedWasmArtifacts(input)).toThrow();
        expect(existsSync(input.outputDirectory)).toBe(false);
    });

    it('builds daw-dsp with its worklet generator and qualifies every declared output', () => {
        const input = fixture(['daw-dsp']);
        const receipt = buildHostedWasmArtifacts(input);
        expect(input.commands).toEqual([
            ['pnpm', 'wasm:dsp'],
            ['pnpm', 'wasm:manifest', '--package', 'daw-dsp'],
            ['pnpm', 'wasm:verify'],
        ]);
        expect(Object.keys(receipt?.files ?? {}).sort()).toEqual(hostedArtifactPaths(['daw-dsp']));
        expect(receipt?.packages).toEqual(['daw-dsp']);
        for (const path of hostedArtifactPaths(['daw-dsp'])) {
            expect(readFileSync(join(input.outputDirectory, path))).toEqual(readFileSync(join(input.root, path)));
        }
    });

    it('runs selected scripts sequentially then stamps only those builds and verifies before returning files', () => {
        const input = fixture();
        const receipt = buildHostedWasmArtifacts(input);
        expect(input.commands).toEqual([
            ['pnpm', 'wasm:scoring'],
            ['pnpm', 'wasm:proof-chamber'],
            ['pnpm', 'wasm:manifest', '--package', 'scoring', '--package', 'proof-chamber'],
            ['pnpm', 'wasm:verify'],
        ]);
        expect(receipt?.headSha).toBe(headSha);
        expect(receipt?.runId).toBe('100');
        expect(Object.keys(receipt?.files ?? {}).sort()).toEqual(hostedArtifactPaths(input.selected));
        expect(JSON.parse(readFileSync(join(input.outputDirectory, 'receipt.json'), 'utf8'))).toEqual(receipt);
    });

    it('stamps only one package when only one built', () => {
        const input = fixture();
        buildHostedWasmArtifacts({ ...input, selected: ['scoring'] });
        expect(input.commands).toEqual([
            ['pnpm', 'wasm:scoring'],
            ['pnpm', 'wasm:manifest', '--package', 'scoring'],
            ['pnpm', 'wasm:verify'],
        ]);
    });

    it('takes generation toolchain pins from the admitted source context', () => {
        const input = fixture();
        const source = {
            root: realpathSync(input.root),
            toolkit: {
                ...wasmArtifacts,
                pinnedToolchain: { ...wasmArtifacts.pinnedToolchain, wasmPack: '9.9.9' },
                rustToolchainChannel: () => 'nightly-source',
                wasmBindgenLockVersion: () => '0.2.source',
            },
        };
        const receipt = buildHostedWasmArtifacts({
            ...input,
            source,
            capture: (command, args) => {
                if (command === 'wasm-pack') {
                    return 'wasm-pack 9.9.9';
                }
                if (command === 'rustup') {
                    return 'nightly-source-x86_64-unknown-linux-gnu';
                }
                return input.capture(command, args);
            },
        });
        expect(receipt?.toolchain).toMatchObject({
            wasmPack: 'wasm-pack 9.9.9',
            rustToolchain: 'nightly-source-x86_64-unknown-linux-gnu',
            wasmBindgen: '0.2.source',
        });
    });

    it('does no command or output work when nothing is selected', () => {
        const input = fixture();
        expect(buildHostedWasmArtifacts({ ...input, selected: [] })).toBeUndefined();
        expect(input.commands).toEqual([]);
        expect(existsSync(input.outputDirectory)).toBe(false);
    });

    it.each(['wasm:scoring', 'wasm:proof-chamber', 'wasm:manifest', 'wasm:verify'])(
        'refuses upload qualification after %s failure',
        (failure) => {
            const input = fixture();
            expect(() =>
                buildHostedWasmArtifacts({
                    ...input,
                    run: (command, args) => {
                        input.run(command, args);
                        if (args[0] === failure) {
                            throw new Error('failed command');
                        }
                    },
                })
            ).toThrow('failed command');
            expect(existsSync(input.outputDirectory)).toBe(false);
            if (failure.startsWith('wasm:scoring') || failure.startsWith('wasm:proof-chamber')) {
                expect(input.commands.some((command) => command.includes('wasm:manifest'))).toBe(false);
            }
        }
    );

    it.each(['Cargo.lock', 'crates/scoring/src/lib.rs', 'surprise.txt'])(
        'refuses generated source/untracked drift: %s',
        (path) => {
            const input = fixture();
            expect(() =>
                buildHostedWasmArtifacts({
                    ...input,
                    run: (command, args) => {
                        input.run(command, args);
                        input.setChanged([path]);
                    },
                })
            ).toThrow('changed source or undeclared files');
            expect(existsSync(input.outputDirectory)).toBe(false);
        }
    );

    it('refuses a different checkout head', () => {
        const input = fixture();
        expect(() => buildHostedWasmArtifacts({ ...input, identity: { ...identity, headSha: baseSha } })).toThrow(
            'requested source head'
        );
        expect(input.commands).toEqual([]);
    });

    it('compares generator changes against the actual merge base, not the advancing base tip', () => {
        const calls: string[][] = [];
        const mergeBase = 'd'.repeat(40);
        const recorded = {
            comment: 'current source fixture',
            toolchain: { wasmPack: 'fixture', wasmBindgen: 'fixture', rustToolchain: 'fixture', wasmOpt: 'fixture' },
            packages: Object.fromEntries(
                wasmArtifacts.packages.map((spec, index) => [
                    spec.id,
                    {
                        crate: spec.crateDir,
                        crateSourceHash: `sha256:${String(index + 1).repeat(64)}`,
                        schemaHash: 'fixture',
                        artifacts: {},
                    },
                ])
            ),
        };
        const source = {
            root: wasmArtifacts.repoRoot,
            toolkit: {
                ...wasmArtifacts,
                readManifest: () => recorded,
                hashCrateClosure: (crateDir: string) => {
                    const spec = wasmArtifacts.packages.find((candidate) => candidate.crateDir === crateDir);
                    const hash = spec === undefined ? undefined : recorded.packages[spec.id]?.crateSourceHash;
                    if (hash === undefined) {
                        throw new Error(`Missing current source fixture: ${crateDir}`);
                    }
                    return hash;
                },
            },
        };
        planHostedWasmBuild(
            identity,
            (command, args) => {
                calls.push([command, ...args]);
                if (args[0] === 'rev-parse') {
                    return headSha;
                }
                if (args[0] === 'merge-base') {
                    return mergeBase;
                }
                return '';
            },
            source
        );
        expect(calls).toContainEqual(['git', 'diff', '--name-only', '-z', mergeBase, headSha]);
        expect(calls).not.toContainEqual(['git', 'diff', '--name-only', '-z', baseSha, headSha]);
    });

    it('refuses an omitted declared artifact despite a successful verification command', () => {
        const input = fixture();
        rmSync(join(input.root, 'public/wasm/scoring/scoring.d.ts'));
        expect(() => buildHostedWasmArtifacts(input)).toThrow();
        expect(existsSync(input.outputDirectory)).toBe(false);
    });

    it('refuses symlinks and oversize output before staging', () => {
        const input = fixture();
        const path = join(input.root, 'public/wasm/scoring/scoring.d.ts');
        rmSync(path);
        symlinkSync(join(input.root, 'package.json'), path);
        expect(() => collectHostedArtifacts(input.root, ['scoring'])).toThrow('regular file');
        rmSync(path);
        writeFileSync(path, Buffer.alloc(10 * 1024 * 1024 + 1));
        expect(() => collectHostedArtifacts(input.root, ['scoring'])).toThrow('10 MiB');
    });
});

function returnedFixture(selected = ['scoring', 'proof-chamber']) {
    const input = fixture(selected);
    const receipt = buildHostedWasmArtifacts(input);
    if (!receipt) {
        throw new Error('Expected receipt');
    }
    const files = Object.fromEntries(
        [...hostedArtifactPaths(input.selected), 'receipt.json'].map((path) => [
            path,
            readFileSync(join(input.outputDirectory, path)),
        ])
    );
    const zip = Buffer.from(zipSync(files, { level: 1, mtime: fixedZipFixtureMtime }));
    const hash = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const run = {
        id: 100,
        run_attempt: 1,
        head_sha: headSha,
        event: 'pull_request',
        path: '.github/workflows/wasm-artifacts.yml',
        status: 'completed',
        conclusion: 'success',
        repository: { id: 50, full_name: 'owner/sourdaw' },
        head_repository: { id: 50, full_name: 'owner/sourdaw' },
        pull_requests: [{ number: 12, head: { sha: headSha } }],
    };
    const artifact = {
        id: 200,
        name: `wasm-${headSha}-100-1`,
        expired: false,
        size_in_bytes: zip.length,
        digest: hash(zip),
        workflow_run: { id: 100, repository_id: 50, head_repository_id: 50, head_sha: headSha },
    };
    return {
        ...input,
        outputDirectory: join(dirname(input.root), 'verified'),
        zip,
        files,
        run,
        artifact,
        repository: 'owner/sourdaw',
        pullRequest: 12,
        runId: '100',
        artifactId: '200',
        hash,
        receipt,
    };
}

describe('verified artifact return', () => {
    it('accepts a complete daw-dsp archive at the unchanged source head', () => {
        const input = returnedFixture(['daw-dsp']);
        const receipt = verifyHostedWasmReturn(input);
        expect(receipt).toEqual(input.receipt);
        for (const path of hostedArtifactPaths(['daw-dsp'])) {
            expect(readFileSync(join(input.outputDirectory, path))).toEqual(input.files[path]);
        }
    });

    it('accepts streamed ZIP data descriptors and rejects a mismatched descriptor', () => {
        const chunks: Buffer[] = [];
        const archive = new Zip((error, bytes) => {
            if (error) {
                throw error;
            }
            chunks.push(Buffer.from(bytes));
        });
        const entry = new ZipDeflate('one.txt');
        entry.mtime = fixedZipFixtureMtime;
        archive.add(entry);
        entry.push(Buffer.from('streamed'), true);
        archive.end();
        const zip = Buffer.concat(chunks);
        const central = zip.readUInt32LE(zip.length - 6);
        expect(readHostedArtifactZip(zip).get('one.txt')?.toString()).toBe('streamed');
        zip.writeUInt32LE(0, central - 12);
        expect(() => readHostedArtifactZip(zip)).toThrow('data descriptor disagrees');
    });
    it('bounds the compressed ZIP before parsing', () => {
        expect(() => readHostedArtifactZip(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow('ZIP size');
    });

    it('bounds aggregate declared output before inflating any member', () => {
        const zip = Buffer.from(
            zipSync({ 'one.txt': Buffer.from('one'), 'two.txt': Buffer.from('two') }, { mtime: fixedZipFixtureMtime })
        );
        const central = zip.readUInt32LE(zip.length - 6);
        const second = central + 46 + zip.readUInt16LE(central + 28);
        for (const entry of [central, second]) {
            zip.writeUInt32LE(6 * 1024 * 1024, entry + 24);
            zip.writeUInt32LE(6 * 1024 * 1024, zip.readUInt32LE(entry + 42) + 22);
        }
        zip[37] = 255;
        expect(() => readHostedArtifactZip(zip)).toThrow('ZIP exceeds output bound');
    });

    it.each(['size', 'crc', 'inflation'])(
        'checks actual decompressed %s independently of central claims',
        (mutation) => {
            const zip = Buffer.from(
                zipSync({ 'one.txt': Buffer.from('one'.repeat(1000)) }, { mtime: fixedZipFixtureMtime })
            );
            const central = zip.readUInt32LE(zip.length - 6);
            if (mutation === 'crc') {
                zip.writeUInt32LE(0, 14);
                zip.writeUInt32LE(0, central + 16);
            } else {
                const size = mutation === 'inflation' ? 1 : 3001;
                zip.writeUInt32LE(size, 22);
                zip.writeUInt32LE(size, central + 24);
            }
            expect(() => readHostedArtifactZip(zip)).toThrow();
        }
    );
    it('stages complete verified files privately without changing source', () => {
        const input = returnedFixture();
        const receipt = verifyHostedWasmReturn(input);
        expect(receipt).toEqual(input.receipt);
        expect(readFileSync(join(input.outputDirectory, 'public/wasm/scoring/scoring.d.ts'))).toEqual(
            input.files['public/wasm/scoring/scoring.d.ts']
        );
        expect(readFileSync(join(input.root, 'package.json'), 'utf8')).toContain('pnpm@11.6.0');
    });

    it.each(['identity', 'digest', 'attempt', 'head', 'dirty'])('refuses wrong %s before staging', (failure) => {
        const input = returnedFixture();
        if (failure === 'identity') {
            input.artifactId = '201';
        }
        if (failure === 'digest') {
            input.artifact.digest = `sha256:${'0'.repeat(64)}`;
        }
        if (failure === 'attempt') {
            input.run.run_attempt = 2;
        }
        if (failure === 'head') {
            input.run.head_sha = baseSha;
        }
        if (failure === 'dirty') {
            input.setChanged(['untracked-source.ts']);
        }
        expect(() => verifyHostedWasmReturn(input)).toThrow();
        expect(existsSync(input.outputDirectory)).toBe(false);
    });

    it.each(['omitted', 'extra', 'hash', 'receipt'])(
        'refuses %s file-set mutation even with a matching archive digest',
        (mutation) => {
            const input = returnedFixture();
            const path = 'public/wasm/scoring/scoring.d.ts';
            if (mutation === 'omitted') {
                delete input.files[path];
            }
            if (mutation === 'extra') {
                input.files['evil.ts'] = Buffer.from('unexpected');
            }
            if (mutation === 'hash') {
                input.files[path] = Buffer.from('wrong bytes');
            }
            if (mutation === 'receipt') {
                delete input.files['receipt.json'];
            }
            input.zip = Buffer.from(zipSync(input.files, { mtime: fixedZipFixtureMtime }));
            input.artifact.digest = input.hash(input.zip);
            input.artifact.size_in_bytes = input.zip.length;
            expect(() => verifyHostedWasmReturn(input)).toThrow();
            expect(existsSync(input.outputDirectory)).toBe(false);
        }
    );

    it.each(['symlink', 'encrypted', 'zip64', 'local-name', 'size', 'traversal', 'duplicate'])(
        'rejects unsafe ZIP %s before staging',
        (mutation) => {
            const input = returnedFixture();
            const zip = Buffer.from(
                zipSync(
                    { 'one.txt': Buffer.from('one'), 'two.txt': Buffer.from('two') },
                    { level: 0, mtime: fixedZipFixtureMtime }
                )
            );
            const central = zip.readUInt32LE(zip.length - 6);
            const secondCentral = central + 46 + zip.readUInt16LE(central + 28);
            const secondLocal = zip.readUInt32LE(secondCentral + 42);
            if (mutation === 'symlink') {
                zip.writeUInt32LE(0xa1ff0000, central + 38);
            }
            if (mutation === 'encrypted') {
                zip.writeUInt16LE(1, central + 8);
            }
            if (mutation === 'zip64') {
                zip.writeUInt16LE(45, central + 6);
            }
            if (mutation === 'local-name') {
                zip[30] = 120;
            }
            if (mutation === 'size') {
                zip.writeUInt32LE(11 * 1024 * 1024, central + 24);
                zip.writeUInt32LE(11 * 1024 * 1024, 22);
            }
            if (mutation === 'traversal') {
                zip.write('../evil', 30);
                zip.write('../evil', central + 46);
            }
            if (mutation === 'duplicate') {
                zip.write('one.txt', secondLocal + 30);
                zip.write('one.txt', secondCentral + 46);
            }
            expect(() => readHostedArtifactZip(zip)).toThrow();
            expect(existsSync(input.outputDirectory)).toBe(false);
        }
    );
});
