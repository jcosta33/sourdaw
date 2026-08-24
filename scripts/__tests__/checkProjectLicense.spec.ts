import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { Header, Pax } from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    DISTRIBUTION_PROJECT_NOTICE,
    PROJECT_LICENSE_ID,
    PROJECT_NOTICE,
    PROJECT_AUTHOR,
    SPDX_OWNERSHIP_HEADER,
    validateDependencyLicenseReport,
    validateProjectLicense,
    validateServerThirdPartyNotices,
} from '../checkProjectLicense';
import {
    assertLicenseExpressionEvidence,
    collectNpmLockDependencyLicenses,
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    assertPlatformRestrictedNpmPackage,
    isPlatformRestrictedPackage,
    readLegalFile,
    readDependencyLicenseProofManifest,
    normalizeProofArchiveMemberPath,
    renderDependencyLicenseReport,
    renderServerThirdPartyNotices,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    validateDependencyLicenseProof,
    type DependencyLicenseProof,
    type DependencyLicenseRecord,
} from '../dependencyLicenseReport';

const ownershipFiles = [
    '.dependency-cruiser.cjs',
    '.dependency-cruiser.shared.cjs',
    '.dependency-cruiser.tests.cjs',
    '.dependency-cruiser.types.cjs',
    '.dependency-cruiser.reachability.cjs',
    'src/infra/store/storage/LocalStorageKeys.ts',
    'src/modules/AiRuntime/models/ToolDefinitions.ts',
    'src/modules/AiRuntime/models/Tools/Types.ts',
    'src/modules/AiGeneration/models/MidiPatternType.ts',
];

function write(root: string, path: string, contents: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
}

function encodeTarEntry(path: string, type: 'File' | 'NextFileHasLongPath', contents: Buffer): Buffer {
    const header = Buffer.alloc(512);
    new Header({ path, type, mode: 0o644, uid: 0, gid: 0, size: contents.length, mtime: new Date(0) }).encode(header);
    const padding = Buffer.alloc((512 - (contents.length % 512)) % 512);
    return Buffer.concat([header, contents, padding]);
}

function encodeExtendedPathArchive(format: 'pax' | 'gnu', path: string, contents: Buffer): Buffer {
    const extension =
        format === 'pax'
            ? new Pax({ path }).encode()
            : encodeTarEntry('././@LongLink', 'NextFileHasLongPath', Buffer.from(`${path}\0`));
    return gzipSync(
        Buffer.concat([extension, encodeTarEntry('package/LICENSE', 'File', contents), Buffer.alloc(1024)])
    );
}

describe('project license', () => {
    let root: string;
    const cargo = {
        packages: [{ name: 'crate-one', license: PROJECT_LICENSE_ID, authors: [PROJECT_AUTHOR] }],
    };

    it.each([
        ['./package/LICENSE', 'package/LICENSE'],
        ['package//LICENSE', 'package/LICENSE'],
        ['package/legal/../LICENSE', 'package/LICENSE'],
        ['package\\LICENSE', 'package/LICENSE'],
    ])('normalizes proof archive member alias %s', (path, expected) => {
        expect(normalizeProofArchiveMemberPath(path)).toBe(expected);
    });

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'sourdaw-project-license-'));
        const license = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const distributedLicense = readFileSync(join(process.cwd(), 'public/legal/Apache-2.0.txt'), 'utf8');
        const serverThirdPartyNotices = readFileSync(join(process.cwd(), 'server/THIRD-PARTY-NOTICES.md'), 'utf8');
        const adaptedSourceLicense = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const originalSourceLicense = readFileSync(
            join(process.cwd(), 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt'),
            'utf8'
        );
        write(root, 'LICENSE', license);
        write(root, 'public/legal/Apache-2.0.txt', distributedLicense);
        write(root, 'server/LICENSE', license);
        write(root, 'NOTICE', PROJECT_NOTICE);
        write(root, 'public/legal/SOURDAW-NOTICE.txt', DISTRIBUTION_PROJECT_NOTICE);
        write(root, 'server/NOTICE', DISTRIBUTION_PROJECT_NOTICE);
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '# Third-Party Notices\n');
        write(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt', adaptedSourceLicense);
        write(root, 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt', originalSourceLicense);
        write(root, 'server/THIRD-PARTY-NOTICES.md', serverThirdPartyNotices);
        write(root, 'package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: PROJECT_LICENSE_ID } } }));
        for (const path of ownershipFiles) {
            write(root, path, `${SPDX_OWNERSHIP_HEADER}export {};\n`);
        }
        for (const path of [
            'release/open-source-inventory.json',
            'public/samples/levain/provenance.tsv',
            'scripts/checkLevainProvenance.ts',
            'scripts/checkReleaseInventory.ts',
        ]) {
            write(root, path, 'current');
        }
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('accepts one project grant across source and shipped metadata', () => {
        expect(validateProjectLicense(root, cargo)).toEqual([]);
    });

    it('rejects canonical LICENSE drift independently', () => {
        write(root, 'LICENSE', 'wrong');
        expect(validateProjectLicense(root, cargo)).toContain('LICENSE: Apache-2.0 text drifted');
    });

    it('rejects shipped license and notice drift', () => {
        write(root, 'public/legal/Apache-2.0.txt', 'wrong');
        write(root, 'server/LICENSE', 'wrong');
        write(root, 'NOTICE', 'wrong');
        write(root, 'public/legal/SOURDAW-NOTICE.txt', 'wrong');
        write(root, 'server/NOTICE', 'wrong');
        write(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt', 'wrong');
        write(root, 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt', 'wrong');
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                'public/legal/Apache-2.0.txt: Apache-2.0 text drifted',
                'server/LICENSE: Apache-2.0 text drifted',
                'NOTICE: project attribution drifted',
                'public/legal/SOURDAW-NOTICE.txt: project attribution drifted',
                'server/NOTICE: project attribution drifted',
                'public/legal/MI-PLAITS-DSP-RS-MIT.txt: upstream MIT license drifted',
                'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt: original upstream MIT license drifted',
            ])
        );
    });

    it('rejects package and crate metadata drift', () => {
        write(root, 'package.json', JSON.stringify({ license: 'MIT' }));
        expect(
            validateProjectLicense(root, {
                packages: [{ name: 'crate-one', license: null, authors: [] }],
            })
        ).toEqual(
            expect.arrayContaining([
                'package.json: license must be Apache-2.0',
                'crate-one: Cargo license must be Apache-2.0',
                'crate-one: Cargo authors must include Jose Costa',
            ])
        );
    });

    it('rejects duplicate keys in every project package manifest', () => {
        write(root, 'package.json', '{"license":"MIT","license":"Apache-2.0"}');
        expect(() => validateProjectLicense(root, cargo)).toThrow('package.json: duplicate key');

        write(root, 'package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package.json', '{"license":"MIT","license":"Apache-2.0"}');
        expect(() => validateProjectLicense(root, cargo)).toThrow('server/package.json: duplicate key');

        write(root, 'server/package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package-lock.json', '{"packages":{"":{"license":"MIT","license":"Apache-2.0"}}}');
        expect(() => validateProjectLicense(root, cargo)).toThrow('server/package-lock.json: duplicate key');
    });

    it('rejects server/package.json drift independently', () => {
        write(root, 'server/package.json', JSON.stringify({ license: 'MIT' }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package.json: license must be Apache-2.0');
    });

    it('rejects server/package-lock.json drift independently', () => {
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: 'MIT' } } }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package-lock.json: license must be Apache-2.0');
    });

    it('rejects stale proprietary headers and retired project-grant obligations', () => {
        write(root, ownershipFiles[0]!, 'all rights reserved');
        write(
            root,
            'release/open-source-inventory.json',
            'pending:OS-10-project-grant\nComplete the OS-10 project grant before public release.\n' +
                'apply the OS-10 project license\nApply the project license in OS-10'
        );
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                `${ownershipFiles[0]}: SPDX ownership header drifted`,
                `${ownershipFiles[0]}: stale proprietary ownership claim`,
                'release/open-source-inventory.json: stale project-license marker pending:OS-10-project-grant',
                'release/open-source-inventory.json: stale project-license marker Complete the OS-10 project grant before public release.',
                'release/open-source-inventory.json: stale project-license marker apply the OS-10 project license',
                'release/open-source-inventory.json: stale project-license marker Apply the project license in OS-10',
            ])
        );
    });

    it('renders dependency identities and deduplicated exact legal files', () => {
        const legalFile = { label: 'LICENSE', sha256: 'a'.repeat(64), contents: 'exact terms\n' };
        const records: DependencyLicenseRecord[] = [
            { ecosystem: 'npm', name: 'zeta', version: '1.0.0', license: 'MIT', legalFiles: [legalFile] },
            { ecosystem: 'cargo', name: 'alpha', version: '2.0.0', license: 'Apache-2.0', legalFiles: [legalFile] },
            { ecosystem: 'npm', name: 'beta', version: '3.0.0', license: 'MIT', legalFiles: [legalFile] },
        ];

        const report = renderDependencyLicenseReport(records);
        expect(report).toContain('cargo:alpha@2.0.0 | Apache-2.0 | sha256:');
        expect(report).not.toContain('metadata-only');
        expect(report.match(/exact terms/gu)).toHaveLength(1);
    });

    it('fails dependency generation when exact legal text is unavailable', () => {
        expect(() =>
            renderDependencyLicenseReport([
                { ecosystem: 'npm', name: 'missing', version: '1.0.0', license: 'MIT', legalFiles: [] },
            ])
        ).toThrow('npm:missing@1.0.0: required dependency license record is unavailable');
    });

    it('binds the report to both JavaScript lock graphs', () => {
        const legalFile = { label: 'LICENSE', sha256: 'a'.repeat(64), contents: 'exact terms\n' };
        const report = renderDependencyLicenseReport(
            [{ ecosystem: 'npm', name: 'alpha', version: '1.0.0', license: 'MIT', legalFiles: [legalFile] }],
            {
                'pnpm-lock.yaml': 'b'.repeat(64),
                'server/package-lock.json': 'c'.repeat(64),
            }
        );
        expect(report).toContain(`- pnpm-lock.yaml sha256:${'b'.repeat(64)}`);
        expect(report).toContain(`- server/package-lock.json sha256:${'c'.repeat(64)}`);
    });

    it('collects root server dependencies and optional dependencies without server/node_modules', () => {
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: {
                    '': { dependencies: { ws: '8.21.1' }, optionalDependencies: { optional: '2.0.0' } },
                    'node_modules/ws': {
                        version: '8.21.1',
                        license: 'MIT',
                        resolved: 'https://registry.npmjs.org/ws/-/ws-8.21.1.tgz',
                        integrity: 'sha512-ws',
                    },
                    'node_modules/optional': {
                        version: '2.0.0',
                        license: 'MIT',
                        resolved: 'https://registry.npmjs.org/optional/-/optional-2.0.0.tgz',
                        integrity: 'sha512-optional',
                    },
                    'node_modules/dev-only': { version: '1.0.0', license: 'MIT', dev: true },
                    'node_modules/unreachable': { version: '1.0.0', license: 'MIT' },
                },
            })
        );
        expect(collectNpmLockDependencyLicenses(root)).toEqual([
            expect.objectContaining({ name: 'optional', version: '2.0.0', serverLockPath: 'node_modules/optional' }),
            expect.objectContaining({
                ecosystem: 'npm',
                name: 'ws',
                version: '8.21.1',
                serverLockPath: 'node_modules/ws',
                graphs: ['server/package-lock.json'],
                legalFiles: [],
            }),
        ]);
    });

    it('rejects incomplete server closures and preserves nested lock identity', () => {
        const lock = (packages: Record<string, unknown>): void =>
            write(root, 'server/package-lock.json', JSON.stringify({ packages }));

        lock({ '': { dependencies: { missing: '1.0.0' } } });
        expect(() => collectNpmLockDependencyLicenses(root)).toThrow('server production dependency is missing');

        lock({ '': { dependencies: { dev: '1.0.0' } }, 'node_modules/dev': { version: '1.0.0', dev: true } });
        expect(() => collectNpmLockDependencyLicenses(root)).toThrow('server production dependency is marked dev-only');

        lock({
            '': { dependencies: { native: '1.0.0' } },
            'node_modules/native': { version: '1.0.0', license: 'MIT', os: ['darwin'] },
        });
        expect(() => collectNpmLockDependencyLicenses(root)).toThrow('platform-restricted server dependency may ship');

        const source = 'https://registry.npmjs.org/ws/-/ws-8.21.1.tgz';
        const revision =
            'sha512-+0NTnW77fFN/DjQi6k/Sq/Yvk4Sgajw7urW8V+asjXnRgDs9gyGkdb7EzgfhA4goXsRIZKE28fzIXBHEzhuiWw==';
        lock({
            '': { dependencies: { parent: '1.0.0' } },
            'node_modules/parent': {
                version: '1.0.0',
                license: 'MIT',
                dependencies: { ws: '8.21.1' },
            },
            'node_modules/parent/node_modules/ws': {
                version: '8.21.1',
                license: 'MIT',
                resolved: source,
                integrity: revision,
            },
        });
        const nested = collectNpmLockDependencyLicenses(root).find(({ name }) => name === 'ws')!;
        expect(nested.serverLockPath).toBe('node_modules/parent/node_modules/ws');
        const archivePath = 'release/dependency-license-proofs/ws-8.21.1.tgz';
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        writeFileSync(join(root, archivePath), readFileSync(join(process.cwd(), archivePath)));
        expect(
            validateDependencyLicenseProof(root, nested, {
                source,
                revision,
                files: [
                    {
                        archivePath,
                        sourcePath: 'LICENSE',
                        sha256: '2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef',
                    },
                ],
            })
        ).toHaveLength(1);
    });

    it('excludes host-selected package archives from the cross-platform dependency report', () => {
        expect(isPlatformRestrictedPackage({ os: ['darwin'], cpu: ['arm64'] })).toBe(true);
        expect(isPlatformRestrictedPackage({ libc: ['glibc'] })).toBe(true);
        expect(isPlatformRestrictedPackage({ os: 'darwin' })).toBe(true);
        expect(isPlatformRestrictedPackage({ cpu: 'arm64' })).toBe(true);
        expect(isPlatformRestrictedPackage({ libc: 'musl' })).toBe(true);
        expect(isPlatformRestrictedPackage({})).toBe(false);
        expect(() => assertPlatformRestrictedNpmPackage('unknown-native@1.0.0')).toThrow(
            'platform-restricted production package has no audited shipped-closure classification'
        );
        expect(() => assertPlatformRestrictedNpmPackage('@rollup/rollup-linux-x64-gnu@4.60.1')).not.toThrow();
        expect(() => assertPlatformRestrictedNpmPackage('@rollup/rollup-win32-x64-msvc@4.60.1')).not.toThrow();
        expect(() => assertPlatformRestrictedNpmPackage('fsevents@2.3.3')).not.toThrow();
        expect(() => assertPlatformRestrictedNpmPackage('@rollup/rollup-linux-x64-gnu@4.60.2')).toThrow(
            'platform-restricted production package has no audited shipped-closure classification'
        );
    });

    it('rejects an empty installed legal file directly', () => {
        const path = join(root, 'empty-LICENSE');
        write(root, 'empty-LICENSE', '');
        expect(() => readLegalFile(path, 'empty-LICENSE')).toThrow('empty-LICENSE: legal file is empty');
    });

    it('marks the intended WASM package when run from a crate directory', () => {
        const helperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-mark-wasm-package-'));
        try {
            const sourceHelper = join(dirname(fileURLToPath(import.meta.url)), '..', 'markWasmPackageInternal.ts');
            const helper = join(helperRoot, 'scripts/markWasmPackageInternal.ts');
            const packagePath = join(helperRoot, 'public/wasm/daw-dsp/package.json');
            const crateDirectory = join(helperRoot, 'crates/daw-dsp');
            mkdirSync(dirname(helper), { recursive: true });
            mkdirSync(dirname(packagePath), { recursive: true });
            mkdirSync(crateDirectory, { recursive: true });
            mkdirSync(join(helperRoot, 'node_modules'), { recursive: true });
            symlinkSync(join(process.cwd(), 'node_modules/yaml'), join(helperRoot, 'node_modules/yaml'), 'dir');
            writeFileSync(helper, readFileSync(sourceHelper));
            writeFileSync(
                join(helperRoot, 'scripts/strictJson.ts'),
                readFileSync(join(dirname(sourceHelper), 'strictJson.ts'))
            );
            writeFileSync(packagePath, '{"name":"daw-dsp","private":false}\n');

            execFileSync(process.execPath, [helper, 'daw-dsp'], { cwd: crateDirectory, encoding: 'utf8' });

            expect(JSON.parse(readFileSync(packagePath, 'utf8'))).toMatchObject({ private: true });
            expect(existsSync(join(crateDirectory, 'public/wasm/daw-dsp/package.json'))).toBe(false);
        } finally {
            rmSync(helperRoot, { recursive: true, force: true });
        }
    });

    it('rejects duplicate WASM package metadata before marking it internal', () => {
        const helperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-mark-wasm-duplicate-'));
        try {
            const scriptsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
            const helper = join(helperRoot, 'scripts/markWasmPackageInternal.ts');
            const packagePath = join(helperRoot, 'public/wasm/daw-dsp/package.json');
            const crateDirectory = join(helperRoot, 'crates/daw-dsp');
            mkdirSync(dirname(helper), { recursive: true });
            mkdirSync(dirname(packagePath), { recursive: true });
            mkdirSync(crateDirectory, { recursive: true });
            mkdirSync(join(helperRoot, 'node_modules'), { recursive: true });
            symlinkSync(join(process.cwd(), 'node_modules/yaml'), join(helperRoot, 'node_modules/yaml'), 'dir');
            writeFileSync(helper, readFileSync(join(scriptsDirectory, 'markWasmPackageInternal.ts')));
            writeFileSync(
                join(helperRoot, 'scripts/strictJson.ts'),
                readFileSync(join(scriptsDirectory, 'strictJson.ts'))
            );
            writeFileSync(packagePath, '{"name":"daw-dsp","private":false,"private":true}\n');

            expect(() =>
                execFileSync(process.execPath, [helper, 'daw-dsp'], { cwd: crateDirectory, encoding: 'utf8' })
            ).toThrow(/duplicate key/);
        } finally {
            rmSync(helperRoot, { recursive: true, force: true });
        }
    });

    it('binds fallback proof evidence to the locked package archive', () => {
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'ws',
            version: '8.21.1',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/ws',
            graphs: ['server/package-lock.json'],
        };
        const source = 'https://registry.npmjs.org/ws/-/ws-8.21.1.tgz';
        const revision =
            'sha512-+0NTnW77fFN/DjQi6k/Sq/Yvk4Sgajw7urW8V+asjXnRgDs9gyGkdb7EzgfhA4goXsRIZKE28fzIXBHEzhuiWw==';
        const writeLock = (integrity: string): void =>
            write(
                root,
                'server/package-lock.json',
                JSON.stringify({ packages: { 'node_modules/ws': { version: '8.21.1', resolved: source, integrity } } })
            );
        writeLock(revision);
        const archivePath = 'release/dependency-license-proofs/ws-8.21.1.tgz';
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        writeFileSync(join(root, archivePath), readFileSync(join(process.cwd(), archivePath)));
        const proof: DependencyLicenseProof = {
            source,
            revision,
            files: [
                {
                    archivePath,
                    sourcePath: 'LICENSE',
                    sha256: '2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef',
                },
            ],
        };

        expect(validateDependencyLicenseProof(root, record, proof)).toHaveLength(1);

        proof.files![0]!.sha256 = '0'.repeat(64);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('dependency proof drifted');

        proof.files![0]!.sha256 = '2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef';
        const archive = readFileSync(join(root, archivePath));
        archive[archive.length - 1] = archive[archive.length - 1]! ^ 1;
        writeFileSync(join(root, archivePath), archive);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive does not match the locked package'
        );

        const truncated = archive.subarray(0, -1);
        const truncatedRevision = `sha512-${createHash('sha512').update(truncated).digest('base64')}`;
        writeFileSync(join(root, archivePath), truncated);
        writeLock(truncatedRevision);
        proof.revision = truncatedRevision;
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('proof archive is malformed');

        writeFileSync(join(root, archivePath), readFileSync(join(process.cwd(), archivePath)));
        writeLock(revision);
        proof.revision = 'sha512-stale';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof source identity does not match'
        );

        proof.revision = revision;
        proof.files![0]!.archivePath = 'ws-8.21.1.tgz';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined'
        );
    });

    it('confines checked-in proof archives to the exact proof root', () => {
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'ws',
            version: '8.21.1',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/ws',
            graphs: ['server/package-lock.json'],
        };
        const source = 'https://registry.npmjs.org/ws/-/ws-8.21.1.tgz';
        const revision =
            'sha512-+0NTnW77fFN/DjQi6k/Sq/Yvk4Sgajw7urW8V+asjXnRgDs9gyGkdb7EzgfhA4goXsRIZKE28fzIXBHEzhuiWw==';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/ws': { version: '8.21.1', resolved: source, integrity: revision } },
            })
        );
        const proof: DependencyLicenseProof = {
            source,
            revision,
            files: [
                {
                    archivePath: 'release/dependency-license-proofs/../ws-8.21.1.tgz',
                    sourcePath: 'LICENSE',
                    sha256: '2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef',
                },
            ],
        };
        write(root, 'release/dependency-license-proofs/placeholder', 'x');
        writeFileSync(
            join(root, 'release/ws-8.21.1.tgz'),
            readFileSync(join(process.cwd(), 'release/dependency-license-proofs/ws-8.21.1.tgz'))
        );
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined under release/dependency-license-proofs/'
        );

        proof.files![0]!.archivePath = 'release/dependency-license-proofs-confused/ws-8.21.1.tgz';
        mkdirSync(dirname(join(root, proof.files![0]!.archivePath)), { recursive: true });
        writeFileSync(
            join(root, proof.files![0]!.archivePath),
            readFileSync(join(process.cwd(), 'release/dependency-license-proofs/ws-8.21.1.tgz'))
        );
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined under release/dependency-license-proofs/'
        );

        proof.files![0]!.archivePath = 'release/dependency-license-proofs/./ws-8.21.1.tgz';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined under release/dependency-license-proofs/'
        );
    });

    it('rejects duplicate legal members in a locked proof archive', () => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.tgz';
        const license = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'));
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        writeFileSync(
            join(root, archivePath),
            gzipSync(
                Buffer.concat([
                    encodeTarEntry('package/LICENSE', 'File', license),
                    encodeTarEntry('./package/LICENSE', 'File', license),
                    Buffer.alloc(1024),
                ])
            )
        );
        const archive = readFileSync(join(root, archivePath));
        const revision = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
        const source = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/example': { version: '1.0.0', resolved: source, integrity: revision } },
            })
        );
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/example',
            graphs: ['server/package-lock.json'],
        };
        const proof: DependencyLicenseProof = {
            source,
            revision,
            files: [
                {
                    archivePath,
                    sourcePath: 'LICENSE',
                    sha256: createHash('sha256').update(license).digest('hex'),
                },
            ],
        };

        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('proof archive repeats LICENSE');
    });

    it.each(['pax', 'gnu'] as const)('reads an explicit %s long path from a locked proof archive', (format) => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.tgz';
        const sourcePath = `${'legal/'.repeat(18)}LICENSE`;
        const memberPath = `package/${sourcePath}`;
        const license = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'));
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        const archive = encodeExtendedPathArchive(format, memberPath, license);
        writeFileSync(join(root, archivePath), archive);
        const revision = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
        const source = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/example': { version: '1.0.0', resolved: source, integrity: revision } },
            })
        );
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/example',
            graphs: ['server/package-lock.json'],
        };

        const [legal] = validateDependencyLicenseProof(root, record, {
            source,
            revision,
            files: [{ archivePath, sourcePath, sha256: createHash('sha256').update(license).digest('hex') }],
        });

        expect(legal?.contents).toBe(license.toString('utf8'));
    });

    it('binds Cargo proof evidence to its locked crate archive', () => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.crate';
        const license = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'));
        const archive = gzipSync(
            Buffer.concat([encodeTarEntry('example-1.0.0/LICENSE', 'File', license), Buffer.alloc(1024)])
        );
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        writeFileSync(join(root, archivePath), archive);
        const checksum = createHash('sha256').update(archive).digest('hex');
        write(
            root,
            'Cargo.lock',
            `[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`
        );
        const record: DependencyLicenseRecord = {
            ecosystem: 'cargo',
            name: 'example',
            version: '1.0.0',
            cargoSource: 'registry+https://github.com/rust-lang/crates.io-index',
            license: 'MIT',
            legalFiles: [],
            graphs: ['Cargo.lock'],
        };

        const proof: DependencyLicenseProof = {
            source: 'https://crates.io/api/v1/crates/example/1.0.0/download',
            revision: `sha256:${checksum}`,
            files: [
                {
                    archivePath,
                    sourcePath: 'LICENSE',
                    sha256: createHash('sha256').update(license).digest('hex'),
                },
            ],
        };

        expect(validateDependencyLicenseProof(root, record, proof)).toHaveLength(1);

        write(
            root,
            'Cargo.lock',
            `[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "git+https://example.com/example"\nchecksum = "${checksum}"\n`
        );
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('Cargo.lock checksum is missing');
    });

    it('rejects proof source traversal after separator normalization', () => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.tgz';
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        writeFileSync(join(root, archivePath), gzipSync(Buffer.alloc(1024)));
        const archive = readFileSync(join(root, archivePath));
        const revision = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
        const source = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/example': { version: '1.0.0', resolved: source, integrity: revision } },
            })
        );
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/example',
            graphs: ['server/package-lock.json'],
        };

        expect(() =>
            validateDependencyLicenseProof(root, record, {
                source,
                revision,
                files: [{ archivePath, sourcePath: '..\\LICENSE', sha256: '0'.repeat(64) }],
            })
        ).toThrow('proof source path must be canonical and relative');
    });

    it('rejects a malformed member after valid legal evidence', () => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.tgz';
        const license = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'));
        mkdirSync(join(root, 'package'), { recursive: true });
        writeFileSync(join(root, 'package/LICENSE'), license);
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        const malformedHeader = Buffer.alloc(512);
        malformedHeader.write('package/BROKEN');
        const malformedArchive = gzipSync(
            Buffer.concat([encodeTarEntry('package/LICENSE', 'File', license), malformedHeader, Buffer.alloc(1024)])
        );
        writeFileSync(join(root, archivePath), malformedArchive);
        const revision = `sha512-${createHash('sha512').update(malformedArchive).digest('base64')}`;
        const source = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/example': { version: '1.0.0', resolved: source, integrity: revision } },
            })
        );
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/example',
            graphs: ['server/package-lock.json'],
        };

        expect(() =>
            validateDependencyLicenseProof(root, record, {
                source,
                revision,
                files: [
                    {
                        archivePath,
                        sourcePath: 'LICENSE',
                        sha256: createHash('sha256').update(license).digest('hex'),
                    },
                ],
            })
        ).toThrow('proof archive is malformed');
    });

    it('rejects non-regular legal members in a locked proof archive', () => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.tgz';
        mkdirSync(join(root, 'package'), { recursive: true });
        write(root, 'package/LICENSE', 'target');
        symlinkSync('LICENSE', join(root, 'package/LICENSE-LINK'));
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        execFileSync('tar', ['-czf', join(root, archivePath), 'package/LICENSE-LINK'], { cwd: root });
        const archive = readFileSync(join(root, archivePath));
        const revision = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
        const source = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/example': { version: '1.0.0', resolved: source, integrity: revision } },
            })
        );
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/example',
            graphs: ['server/package-lock.json'],
        };

        expect(() =>
            validateDependencyLicenseProof(root, record, {
                source,
                revision,
                files: [{ archivePath, sourcePath: 'LICENSE-LINK', sha256: '0'.repeat(64) }],
            })
        ).toThrow('is not a regular file');
    });

    it('enforces SPDX AND, OR, and WITH semantics against full terms', () => {
        const mit = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const apache = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const legal = (contents: string) => [{ label: 'LICENSE', sha256: 'a'.repeat(64), contents }];

        expect(() => assertLicenseExpressionEvidence('npm:example@1', 'MIT AND Apache-2.0', legal(mit))).toThrow(
            'does not substantiate'
        );
        expect(() => assertLicenseExpressionEvidence('npm:example@1', 'MIT OR Apache-2.0', legal(mit))).not.toThrow();
        expect(() =>
            assertLicenseExpressionEvidence('npm:example@1', 'Apache-2.0 WITH LLVM-exception', legal(apache))
        ).toThrow('does not substantiate');
        expect(() =>
            assertLicenseExpressionEvidence(
                'npm:example@1',
                'Apache-2.0 WITH LLVM-exception',
                legal(
                    `${apache}\nLLVM Exceptions to the Apache 2.0 License\nlimitations under the License with the following exceptions`
                )
            )
        ).not.toThrow();
    });

    it('rejects false-positive words and metadata-only evidence', () => {
        const legal = (contents: string) => [{ label: 'package.json', sha256: 'a'.repeat(64), contents }];
        expect(() =>
            assertLicenseExpressionEvidence('npm:example@1', 'MIT', legal('license copyright permission'))
        ).toThrow('does not substantiate');
        expect(() =>
            assertLicenseExpressionEvidence(
                'npm:example@1',
                'ISC',
                legal('{"name":"example","license":"ISC","author":"Example"}')
            )
        ).toThrow('does not substantiate');
    });

    it('builds honest assembled evidence from locked metadata and pinned SPDX text', () => {
        const metadataContents = '{"name":"example","version":"1.0.0","author":"Example","license":"MIT"}\n';
        const metadata = {
            label: 'package.json',
            sha256: createHash('sha256').update(metadataContents).digest('hex'),
            contents: metadataContents,
        };
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [
                {
                    label: 'NOTICE',
                    sha256: createHash('sha256').update('Copyright Example\n').digest('hex'),
                    contents: 'Copyright Example\n',
                },
            ],
            metadataFiles: [metadata],
            serverLockPath: 'node_modules/example',
            graphs: ['pnpm-lock.yaml', 'server/package-lock.json'],
        };
        write(
            root,
            'pnpm-lock.yaml',
            'lockfileVersion: 9.0\npackages:\n  example@1.0.0:\n    resolution:\n      integrity: sha512-example\n'
        );
        const source = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: {
                    'node_modules/example': {
                        version: '1.0.0',
                        resolved: source,
                        integrity: 'sha512-example',
                    },
                },
            })
        );
        write(
            root,
            'release/spdx-license-texts/MIT.txt',
            readFileSync(join(process.cwd(), 'release/spdx-license-texts/MIT.txt'), 'utf8')
        );
        const proof: DependencyLicenseProof = {
            source,
            revision: 'sha512-example',
            assembled: {
                metadata: [{ sourcePath: metadata.label, sha256: metadata.sha256 }],
                licenses: ['MIT'],
            },
        };

        const [upstreamNotice, notice] = validateDependencyLicenseProof(root, record, proof);
        expect(upstreamNotice?.label).toBe('NOTICE');
        expect(notice?.contents).toContain('does not authenticate an upstream copyright holder');
        expect(notice?.contents).toContain(metadataContents.trim());
        expect(notice?.contents).toContain('canonical SPDX MIT');

        proof.assembled!.metadata[0]!.sha256 = '0'.repeat(64);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('assembled proof metadata drifted');

        proof.assembled!.metadata[0]!.sha256 = metadata.sha256;
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: {
                    'node_modules/example': {
                        version: '1.0.0',
                        resolved: 'https://registry.npmjs.org/example/-/other.tgz',
                        integrity: 'sha512-example',
                    },
                },
            })
        );
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof source identity does not match the locked package'
        );
    });

    it('rejects duplicate keys in the dependency proof manifest', () => {
        write(root, DEPENDENCY_LICENSE_PROOFS_PATH, '{"schemaVersion":3,"schemaVersion":3,"packages":{}}');
        expect(() => readDependencyLicenseProofManifest(root)).toThrow('duplicate key');
        try {
            readDependencyLicenseProofManifest(root);
        } catch (error) {
            expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
        }

        write(root, DEPENDENCY_LICENSE_PROOFS_PATH, '{"schemaVersion":3');
        expect(() => readDependencyLicenseProofManifest(root)).toThrow('invalid JSON');
        try {
            readDependencyLicenseProofManifest(root);
        } catch (error) {
            expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
        }
    });

    it('validates the current aws-lc compound expression branch by branch', () => {
        const apache = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const mit = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const isc =
            'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n' +
            'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY.\n';
        const bsd =
            'Redistribution and use in source and binary forms are permitted. Redistributions of source code must retain this notice. ' +
            'Redistributions in binary form must reproduce this notice. Neither the name of Example nor the names of its contributors may be used to endorse. ' +
            'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".\n';
        const mitZero =
            'MIT No Attribution\nPermission is hereby granted, free of charge. THE SOFTWARE IS PROVIDED "AS IS".\n';
        const files = [
            { label: 'LICENSE', sha256: 'a'.repeat(64), contents: `${apache}\n${mit}\n${isc}\n${bsd}\n${mitZero}` },
        ];
        expect(() =>
            assertLicenseExpressionEvidence(
                'cargo:aws-lc-sys@0.44.0',
                'ISC AND (Apache-2.0 OR ISC) AND Apache-2.0 AND MIT AND BSD-3-Clause AND ' +
                    '(Apache-2.0 OR ISC OR MIT) AND (Apache-2.0 OR ISC OR MIT-0)',
                files
            )
        ).not.toThrow();
    });

    it('rejects dependency report drift and absence', () => {
        write(root, DEPENDENCY_LICENSE_REPORT_PATH, 'current');
        expect(validateDependencyLicenseReport(root, 'current')).toEqual([]);
        expect(validateDependencyLicenseReport(root, 'expected')).toEqual([
            `${DEPENDENCY_LICENSE_REPORT_PATH}: dependency license report drifted`,
        ]);
        rmSync(join(root, DEPENDENCY_LICENSE_REPORT_PATH));
        expect(validateDependencyLicenseReport(root, 'expected')).toEqual([
            `${DEPENDENCY_LICENSE_REPORT_PATH}: dependency license report missing`,
        ]);
    });

    it('generates the standalone server notice from the same exact dependency records', () => {
        const legalFile = { label: 'LICENSE', sha256: 'a'.repeat(64), contents: 'exact ws terms\n' };
        const expected = renderServerThirdPartyNotices([
            {
                ecosystem: 'npm',
                name: 'ws',
                version: '8.21.1',
                license: 'MIT',
                legalFiles: [legalFile],
                graphs: ['server/package-lock.json'],
            },
        ]);
        write(root, SERVER_THIRD_PARTY_NOTICES_PATH, expected);
        expect(validateServerThirdPartyNotices(root, expected)).toEqual([]);

        write(root, SERVER_THIRD_PARTY_NOTICES_PATH, expected.replace('exact ws terms', 'replacement'));
        expect(validateServerThirdPartyNotices(root, expected)).toEqual([
            `${SERVER_THIRD_PARTY_NOTICES_PATH}: third-party notices drifted`,
        ]);

        rmSync(join(root, SERVER_THIRD_PARTY_NOTICES_PATH));
        expect(validateServerThirdPartyNotices(root, expected)).toEqual([
            `${SERVER_THIRD_PARTY_NOTICES_PATH}: third-party notices missing`,
        ]);
    });
});
