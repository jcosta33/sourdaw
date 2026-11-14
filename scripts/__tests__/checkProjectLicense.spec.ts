import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    truncateSync,
    unlinkSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

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
    cargoRegistryArchiveSource,
    type CargoRuntimeInventorySnapshot,
    type DependencyLicenseProofSourceManifest,
    assertLicenseExpressionEvidence,
    expectedProofIdentities,
    collectNpmLockDependencyLicenses,
    buildDependencyLicenseArtifacts,
    CARGO_RUNTIME_FEATURE_SELECTION,
    collectCargoDependencyLicenses,
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
import { parsePnpmLock } from '../pnpmLock';
import { inspectCargoLocalPatch, type SourceManifest } from '../cargoLocalPatchProof';
import { parseJsonWithUniqueKeys } from '../strictJson';

const ownershipFiles = [
    '.dependency-cruiser.cjs',
    '.dependency-cruiser.shared.cjs',
    '.dependency-cruiser.tests.cjs',
    '.dependency-cruiser.types.cjs',
    '.dependency-cruiser.reachability.cjs',
    '.dependency-cruiser.module-tiers.cjs',
    'src/infra/store/storage/LocalStorageKeys.ts',
    'src/modules/AiRuntime/models/ToolDefinitions.ts',
    'src/modules/AiRuntime/models/Tools/Types.ts',
    'src/modules/AiGeneration/models/MidiPatternType.ts',
];

function write(root: string, path: string, contents: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
}

function writeCargoInventoryFixture(root: string): void {
    const repositoryRoot = process.cwd();
    const snapshotPaths = [
        'Cargo.lock',
        'electron-builder.yml',
        'package.json',
        DEPENDENCY_LICENSE_REPORT_PATH,
        DEPENDENCY_LICENSE_PROOFS_PATH,
    ];
    for (const path of snapshotPaths) {
        write(root, path, readFileSync(join(repositoryRoot, path), 'utf8'));
    }
    const manifest = readCargoInventoryFixtureManifest(root);
    for (const { path } of manifest.cargoRuntimeInventory?.sourceInputs ?? []) {
        write(root, path, readFileSync(join(repositoryRoot, path), 'utf8'));
    }
    restampCargoInventoryFixtureDigests(root, manifest);
}

function sha256File(root: string, path: string): string {
    return createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex');
}

// The fixture pins the digests of its own copies, so an unrelated edit to the
// live package.json, Cargo.lock or build inputs cannot fail these cases; the
// drift each case injects afterwards still moves a digest off the fixture's pin.
function restampCargoInventoryFixtureDigests(root: string, manifest: CargoInventoryFixtureManifest): void {
    const inventory = manifest.cargoRuntimeInventory;
    if (inventory === undefined) {
        throw new Error('the fixture manifest must carry a Cargo runtime inventory');
    }
    inventory.cargoLockSha256 = sha256File(root, 'Cargo.lock');
    for (const input of inventory.sourceInputs) {
        input.sha256 = sha256File(root, input.path);
    }
    writeCargoInventoryFixtureManifest(root, manifest);
}

type CargoInventoryFixtureManifest = {
    cargoRuntimeInventory?: {
        cargoLockSha256: string;
        sourceInputs: Array<{
            path: string;
            sha256: string;
        }>;
        featureSelection: {
            features: string[];
        };
        packages: Array<{
            name: string;
            version: string;
            source: string;
        }>;
    };
};

function readCargoInventoryFixtureManifest(root: string): CargoInventoryFixtureManifest {
    return JSON.parse(
        readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')
    ) as CargoInventoryFixtureManifest;
}

function writeCargoInventoryFixtureManifest(root: string, manifest: CargoInventoryFixtureManifest): void {
    writeFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), `${JSON.stringify(manifest, null, 4)}\n`);
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

    it('validates the locked Cargo inventory without invoking cargo', () => {
        const unavailableCargoPath = mkdtempSync(join(tmpdir(), 'sourdaw-unavailable-cargo-'));
        const originalPath = process.env.PATH;
        const originalSentinelPath = process.env.CARGO_SENTINEL_PATH;
        const cargoPath = join(unavailableCargoPath, 'cargo');
        const sentinelPath = join(unavailableCargoPath, 'cargo-invoked');
        writeFileSync(cargoPath, '#!/bin/sh\nprintf invoked > "$CARGO_SENTINEL_PATH"\nexit 97\n');
        chmodSync(cargoPath, 0o755);
        process.env.PATH = `${unavailableCargoPath}:${originalPath ?? ''}`;
        process.env.CARGO_SENTINEL_PATH = sentinelPath;
        try {
            writeCargoInventoryFixture(root);
            const records = collectCargoDependencyLicenses(root);
            expect(records).not.toHaveLength(0);
            expect(
                buildDependencyLicenseArtifacts(process.cwd(), { collectCargoDependencies: () => records }).report
            ).toBe(readFileSync(join(process.cwd(), DEPENDENCY_LICENSE_REPORT_PATH), 'utf8'));
            expect(existsSync(sentinelPath)).toBe(false);
        } finally {
            if (originalPath === undefined) {
                delete process.env.PATH;
            } else {
                process.env.PATH = originalPath;
            }
            if (originalSentinelPath === undefined) {
                delete process.env.CARGO_SENTINEL_PATH;
            } else {
                process.env.CARGO_SENTINEL_PATH = originalSentinelPath;
            }
            rmSync(unavailableCargoPath, { recursive: true, force: true });
        }
    });

    it('reads proof identities from both current lock documents', () => {
        write(
            root,
            'pnpm-lock.yaml',
            `importers:\n  .:\n    configDependencies: {}\n    packageManagerDependencies:\n      pnpm: {specifier: 12.18.0, version: 12.18.0}\npackages:\n  pnpm@12.18.0:\n    resolution: {integrity: sha512-manager}\n---\npackages:
  fixture-production@1.0.0:
    resolution: {integrity: sha512-production}
`
        );
        const record = (name: string, version: string): DependencyLicenseRecord => ({
            ecosystem: 'npm',
            name,
            version,
            license: 'MIT',
            legalFiles: [],
            graphs: ['pnpm-lock.yaml'],
        });
        expect(expectedProofIdentities(root, record('fixture-production', '1.0.0'))).toEqual([
            {
                source: 'https://registry.npmjs.org/fixture-production/-/fixture-production-1.0.0.tgz',
                revision: 'sha512-production',
            },
        ]);
        expect(expectedProofIdentities(root, record('pnpm', '12.18.0'))).toEqual([
            { source: 'https://registry.npmjs.org/pnpm/-/pnpm-12.18.0.tgz', revision: 'sha512-manager' },
        ]);
    });

    it('parses pnpm-lock.yaml once per artifact build across repeated pnpm proof lookups', () => {
        const legalContents = readFileSync(join(process.cwd(), 'release/spdx-license-texts/MIT.txt'), 'utf8');
        const legalSha256 = createHash('sha256').update(legalContents).digest('hex');
        const legalFile = { label: 'MIT.txt', sha256: legalSha256, contents: legalContents };
        const packageNames = ['fixture-alpha', 'fixture-beta'];
        const records: DependencyLicenseRecord[] = [];
        const proofs: Record<string, DependencyLicenseProof> = {};
        const lockPackages: string[] = [];
        for (const name of packageNames) {
            const archive = gzipSync(
                Buffer.concat([
                    encodeTarEntry('package/LICENSE', 'File', Buffer.from(legalContents)),
                    Buffer.alloc(1024),
                ])
            );
            const archivePath = `release/dependency-license-proofs/${name}.tgz`;
            mkdirSync(dirname(join(root, archivePath)), { recursive: true });
            writeFileSync(join(root, archivePath), archive);
            const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
            records.push({
                ecosystem: 'npm',
                name,
                version: '1.0.0',
                license: 'MIT',
                legalFiles: [],
                graphs: ['pnpm-lock.yaml'],
            });
            proofs[`npm:${name}@1.0.0`] = {
                source: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
                revision: integrity,
                files: [{ archivePath, sourcePath: 'LICENSE', sha256: legalSha256 }],
            };
            lockPackages.push(`  "${name}@1.0.0":\n    resolution:\n      integrity: ${integrity}`);
        }
        const serverRecord: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'fixture-server',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [legalFile],
            graphs: ['server/package-lock.json'],
        };
        const cargoRecord: DependencyLicenseRecord = {
            ecosystem: 'cargo',
            name: 'fixture-cargo',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [legalFile],
            cargoSource: 'registry+https://index.crates.io/',
            graphs: ['Cargo.lock'],
        };
        const legalReference = { label: legalFile.label, sha256: legalFile.sha256 };
        write(root, 'pnpm-lock.yaml', `lockfileVersion: '9.0'\npackages:\n${lockPackages.join('\n')}\n`);
        write(root, 'server/package-lock.json', '{"packages":{}}\n');
        const cargoArchive = gzipSync(
            Buffer.concat([
                encodeTarEntry('fixture-cargo-1.0.0/LICENSE', 'File', Buffer.from(legalContents)),
                Buffer.alloc(1024),
            ])
        );
        const cargoChecksum = createHash('sha256').update(cargoArchive).digest('hex');
        write(
            root,
            'Cargo.lock',
            `[[package]]\nname = "fixture-cargo"\nversion = "1.0.0"\nsource = "registry+https://index.crates.io/"\nchecksum = "${cargoChecksum}"\n`
        );
        write(root, 'release/spdx-license-texts/MIT.txt', legalContents);
        write(
            root,
            DEPENDENCY_LICENSE_PROOFS_PATH,
            `${JSON.stringify(
                {
                    schemaVersion: 4,
                    packages: proofs,
                    cargoRuntimeInventory: {
                        cargoLockSha256: '0'.repeat(64),
                        sourceInputs: [{ path: 'Cargo.lock', sha256: '0'.repeat(64) }],
                        featureSelection: CARGO_RUNTIME_FEATURE_SELECTION,
                        packages: [
                            {
                                name: cargoRecord.name,
                                version: cargoRecord.version,
                                source: cargoRecord.cargoSource,
                                license: cargoRecord.license,
                                legalFiles: [legalReference],
                                reportedLegalFiles: [legalReference],
                            },
                        ],
                    },
                },
                null,
                4
            )}\n`
        );

        let parseCount = 0;
        let pnpmLookupCount = 0;
        const loadPnpmLockPackages = (fixtureRoot: string) => {
            parseCount += 1;
            const packages = parsePnpmLock(readFileSync(join(fixtureRoot, 'pnpm-lock.yaml'), 'utf8')).packages;
            return new Proxy(packages, {
                ownKeys: (target) => {
                    pnpmLookupCount += 1;
                    return Reflect.ownKeys(target);
                },
            });
        };

        const options = {
            loadPnpmLockPackages,
            collectNpmDependencies: () => records,
            collectNpmLockDependencies: () => [serverRecord],
            collectCargoDependencies: () => [cargoRecord],
        };
        const first = buildDependencyLicenseArtifacts(root, options);
        const firstBuildLookupCount = pnpmLookupCount;
        const second = buildDependencyLicenseArtifacts(root, options);
        const secondBuildLookupCount = pnpmLookupCount - firstBuildLookupCount;

        expect(second).toEqual(first);
        expect(firstBuildLookupCount).toBeGreaterThan(1);
        expect(secondBuildLookupCount).toBeGreaterThan(1);
        expect(parseCount).toBe(2);
    });

    it('binds the offline Cargo inventory to the shipped feature contract', () => {
        const manifest = readCargoInventoryFixtureManifest(process.cwd());
        expect(manifest.cargoRuntimeInventory?.featureSelection.features).toContain('sourdaw-native/napi-addon');
        expect(manifest.cargoRuntimeInventory?.packages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'napi' }),
                expect.objectContaining({ name: 'napi-derive' }),
            ])
        );
    });

    it('binds the Cargo resolver and desktop shipping inputs', () => {
        const manifest = readCargoInventoryFixtureManifest(process.cwd());
        const paths = manifest.cargoRuntimeInventory?.sourceInputs.map(({ path }) => path);
        expect(paths).toEqual(
            expect.arrayContaining([
                'Cargo.toml',
                'crates/sourdaw-native/Cargo.toml',
                'electron-builder.yml',
                'package.json',
                'scripts/buildNativeAddon.ts',
            ])
        );
    });

    it('rejects missing transitive packages from the generated Cargo snapshot', () => {
        writeCargoInventoryFixture(root);
        const manifest = readCargoInventoryFixtureManifest(root);
        const inventory = manifest.cargoRuntimeInventory;
        expect(inventory).toBeDefined();
        inventory!.packages = inventory!.packages.filter(({ name }) => name !== 'rtrb');
        writeCargoInventoryFixtureManifest(root, manifest);

        expect(() => collectCargoDependencyLicenses(root)).toThrow('Cargo dependency inventory drifted');
    });

    it('rejects supported Cargo license-expression drift offline', () => {
        writeCargoInventoryFixture(root);
        const reportPath = join(root, DEPENDENCY_LICENSE_REPORT_PATH);
        const report = readFileSync(reportPath, 'utf8');
        writeFileSync(
            reportPath,
            report.replace('cargo:automerge@0.12.0 | MIT |', 'cargo:automerge@0.12.0 | MIT OR Apache-2.0 |')
        );

        expect(() => collectCargoDependencyLicenses(root)).toThrow('Cargo dependency inventory drifted');
    });

    it('rejects Cargo legal-evidence reassignment offline', () => {
        writeCargoInventoryFixture(root);
        const reportPath = join(root, DEPENDENCY_LICENSE_REPORT_PATH);
        const report = readFileSync(reportPath, 'utf8');
        const automerge = /^cargo:automerge@0\.12\.0 \| MIT \| ([^|]+) \| Cargo\.lock$/mu.exec(report)?.[1];
        expect(automerge).toBeDefined();
        writeFileSync(
            reportPath,
            report.replace(/^(cargo:rtrb@0\.4\.1 \| [^|]+ \| )[^|]+( \| Cargo\.lock)$/mu, `$1${automerge!}$2`)
        );

        expect(() => collectCargoDependencyLicenses(root)).toThrow('Cargo dependency inventory drifted');
    });

    it('rejects Cargo source and lock drift offline', () => {
        writeCargoInventoryFixture(root);
        const lockPath = join(root, 'Cargo.lock');
        const lock = readFileSync(lockPath, 'utf8');
        writeFileSync(lockPath, lock.replace(/^checksum = "[0-9a-f]{64}"$/mu, `checksum = "${'0'.repeat(64)}"`));
        expect(() => collectCargoDependencyLicenses(root)).toThrow('Cargo.lock snapshot drifted');

        writeFileSync(lockPath, lock);
        const manifest = readCargoInventoryFixtureManifest(root);
        const inventory = manifest.cargoRuntimeInventory;
        expect(inventory).toBeDefined();
        inventory!.packages[0]!.source = 'registry+https://example.invalid/index';
        writeCargoInventoryFixtureManifest(root, manifest);
        expect(() => collectCargoDependencyLicenses(root)).toThrow('proof source is not the crates.io registry');
    });

    it.each([
        ['Cargo.toml', 'resolver = "2"', 'resolver = "3"'],
        ['crates/sourdaw-native/Cargo.toml', 'napi-addon =', 'napi-addon-renamed ='],
        ['electron-builder.yml', 'from: crates/sourdaw-native', 'from: crates/sourdaw-native-renamed'],
        ['package.json', 'node scripts/buildNativeAddon.ts', 'node scripts/buildNativeAddonRenamed.ts'],
        ['scripts/buildNativeAddon.ts', "'napi-addon'", "'napi-addon-renamed'"],
    ])('rejects Cargo resolution input drift in %s without invoking Cargo', (path, before, after) => {
        writeCargoInventoryFixture(root);
        expect(collectCargoDependencyLicenses(root)).not.toHaveLength(0);
        const inputPath = join(root, path);
        const input = readFileSync(inputPath, 'utf8');
        expect(input).toContain(before);
        writeFileSync(inputPath, input.replace(before, after));

        expect(() => collectCargoDependencyLicenses(root)).toThrow('Cargo source inputs drifted');
    });

    it('rejects Cargo source-input symlinks that escape the repository', () => {
        writeCargoInventoryFixture(root);
        expect(collectCargoDependencyLicenses(root)).not.toHaveLength(0);
        const outsideRoot = mkdtempSync(join(tmpdir(), 'sourdaw-cargo-source-input-'));
        const outsidePath = join(outsideRoot, 'Cargo.toml');
        writeFileSync(outsidePath, '[package]\nname = "outside"\n');
        symlinkSync(outsidePath, join(root, 'outside-Cargo.toml'));
        try {
            const manifest = readCargoInventoryFixtureManifest(root);
            manifest.cargoRuntimeInventory!.sourceInputs.push({
                path: 'outside-Cargo.toml',
                sha256: createHash('sha256').update(readFileSync(outsidePath)).digest('hex'),
            });
            manifest.cargoRuntimeInventory!.sourceInputs.sort((left, right) => {
                if (left.path === right.path) {
                    return 0;
                }
                return left.path < right.path ? -1 : 1;
            });
            writeCargoInventoryFixtureManifest(root, manifest);

            expect(() => collectCargoDependencyLicenses(root)).toThrow('Cargo source input escapes the repository');
        } finally {
            rmSync(outsideRoot, { recursive: true, force: true });
        }
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

    it('uses supplied safe inventory contents for the project-license marker scan', () => {
        rmSync(join(root, 'release/open-source-inventory.json'));
        const inventoryContents = 'pending:OS-10-project-grant';

        expect(validateProjectLicense(root, cargo, inventoryContents)).toContain(
            'release/open-source-inventory.json: stale project-license marker pending:OS-10-project-grant'
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

        const source = 'https://registry.npmjs.org/ws/-/ws-8.22.2.tgz';
        const revision =
            'sha512-/rEZ2ejown2N5gxVTHUu9bVVC7ttu0/Tgzf5hbTOixR3Fs7mbbXgn2DbdbcKgJOmpQMtrIUWivtYuVMnp/W/yA==';
        lock({
            '': { dependencies: { parent: '1.0.0' } },
            'node_modules/parent': {
                version: '1.0.0',
                license: 'MIT',
                dependencies: { ws: '8.22.2' },
            },
            'node_modules/parent/node_modules/ws': {
                version: '8.22.2',
                license: 'MIT',
                resolved: source,
                integrity: revision,
            },
        });
        const nested = collectNpmLockDependencyLicenses(root).find(({ name }) => name === 'ws')!;
        expect(nested.serverLockPath).toBe('node_modules/parent/node_modules/ws');
        const archivePath = 'release/dependency-license-proofs/ws-8.22.2.tgz';
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
            const sourceHelper = join(import.meta.dirname, '..', 'markWasmPackageInternal.ts');
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
            const scriptsDirectory = join(import.meta.dirname, '..');
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
            version: '8.22.2',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/ws',
            graphs: ['server/package-lock.json'],
        };
        const source = 'https://registry.npmjs.org/ws/-/ws-8.22.2.tgz';
        const revision =
            'sha512-/rEZ2ejown2N5gxVTHUu9bVVC7ttu0/Tgzf5hbTOixR3Fs7mbbXgn2DbdbcKgJOmpQMtrIUWivtYuVMnp/W/yA==';
        const writeLock = (integrity: string): void =>
            write(
                root,
                'server/package-lock.json',
                JSON.stringify({ packages: { 'node_modules/ws': { version: '8.22.2', resolved: source, integrity } } })
            );
        writeLock(revision);
        const archivePath = 'release/dependency-license-proofs/ws-8.22.2.tgz';
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
        proof.files![0]!.archivePath = 'ws-8.22.2.tgz';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined'
        );
    });

    it('confines checked-in proof archives to the exact proof root', () => {
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'ws',
            version: '8.22.2',
            license: 'MIT',
            legalFiles: [],
            serverLockPath: 'node_modules/ws',
            graphs: ['server/package-lock.json'],
        };
        const source = 'https://registry.npmjs.org/ws/-/ws-8.22.2.tgz';
        const revision =
            'sha512-/rEZ2ejown2N5gxVTHUu9bVVC7ttu0/Tgzf5hbTOixR3Fs7mbbXgn2DbdbcKgJOmpQMtrIUWivtYuVMnp/W/yA==';
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: { 'node_modules/ws': { version: '8.22.2', resolved: source, integrity: revision } },
            })
        );
        const proof: DependencyLicenseProof = {
            source,
            revision,
            files: [
                {
                    archivePath: 'release/dependency-license-proofs/../ws-8.22.2.tgz',
                    sourcePath: 'LICENSE',
                    sha256: '2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef',
                },
            ],
        };
        write(root, 'release/dependency-license-proofs/placeholder', 'x');
        writeFileSync(
            join(root, 'release/ws-8.22.2.tgz'),
            readFileSync(join(process.cwd(), 'release/dependency-license-proofs/ws-8.22.2.tgz'))
        );
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined under release/dependency-license-proofs/'
        );

        proof.files![0]!.archivePath = 'release/dependency-license-proofs-confused/ws-8.22.2.tgz';
        mkdirSync(dirname(join(root, proof.files![0]!.archivePath)), { recursive: true });
        writeFileSync(
            join(root, proof.files![0]!.archivePath),
            readFileSync(join(process.cwd(), 'release/dependency-license-proofs/ws-8.22.2.tgz'))
        );
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined under release/dependency-license-proofs/'
        );

        proof.files![0]!.archivePath = 'release/dependency-license-proofs/./ws-8.22.2.tgz';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof archive path must be canonical and confined under release/dependency-license-proofs/'
        );
    });

    it('rejects duplicate legal members in a locked proof archive', () => {
        const archivePath = 'release/dependency-license-proofs/example-1.0.0.tgz';
        const license = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'));
        mkdirSync(dirname(join(root, archivePath)), { recursive: true });
        const archive = gzipSync(
            Buffer.concat([
                encodeTarEntry('package/LICENSE', 'File', license),
                encodeTarEntry('./package/LICENSE', 'File', license),
                Buffer.alloc(1024),
            ])
        );
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

describe('registered locally modified Cargo source', () => {
    function localFixture() {
        const sourceRoot = process.cwd();
        const fixture = mkdtempSync(join(tmpdir(), 'sourdaw-local-cargo-license-'));
        const sources = parseJsonWithUniqueKeys<SourceManifest>(
            readFileSync(join(sourceRoot, 'vendor/rust/sources.json'), 'utf8'),
            'genuine fixture source manifest'
        );
        const source = sources.sources.find((candidate) => candidate.package === 'cexpr');
        if (!source) throw new Error('Genuine cexpr source capsule is required');
        const archive = `release/dependency-license-proofs/cexpr-${source.version}.crate`;
        const write = (path: string, bytes: string | Buffer) => {
            mkdirSync(dirname(join(fixture, path)), { recursive: true });
            writeFileSync(join(fixture, path), bytes);
        };
        cpSync(join(sourceRoot, source.directory), join(fixture, source.directory), { recursive: true });
        write(`vendor/rust/${source.patch}`, readFileSync(join(sourceRoot, 'vendor/rust', source.patch)));
        write(
            archive,
            readFileSync(
                join(sourceRoot, 'scripts/__tests__/fixtures/local-cargo-proof', `cexpr-${source.version}.crate`)
            )
        );
        write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [source] }));
        write(
            'Cargo.toml',
            `[workspace]\nresolver = "2"\n[patch.crates-io]\ncexpr = { path = "${source.directory}" }\n`
        );
        // This is the real generated lock, not hand-invented registry checksums or a Cargo execution.
        write('Cargo.lock', readFileSync(join(sourceRoot, 'Cargo.lock')));
        const pkg = {
            name: 'cexpr',
            version: source.version,
            manifestPath: join(fixture, source.directory, 'Cargo.toml'),
        };
        const inspect = () => inspectCargoLocalPatch(fixture, pkg);
        return { root: fixture, write, source, pkg, inspect, archive };
    }

    it('authenticates a genuine path-patched source without manufacturing a registry checksum', () => {
        const f = localFixture();
        try {
            const local = f.inspect();
            const record: DependencyLicenseRecord = {
                ecosystem: 'cargo',
                name: f.pkg.name,
                version: f.pkg.version,
                license: f.source.license,
                cargoSource: null,
                cargoLocalPatch: local.provenance,
                legalFiles: local.legalFiles,
                graphs: ['Cargo.lock'],
            };
            // The old expectedProofIdentities rejects this exact null source as non-registry.
            expect(expectedProofIdentities(f.root, record)).toEqual([
                { source: cargoRegistryArchiveSource(record), revision: `sha256:${f.source.upstreamArchiveSha256}` },
            ]);
            expect(record.cargoSource).toBeNull();
            expect(local.provenance.kind).toBe('local-patch');
            const originalProof: DependencyLicenseProof = {
                source: cargoRegistryArchiveSource(record),
                revision: `sha256:${f.source.upstreamArchiveSha256}`,
                localPatch: local.provenance,
                files: local.provenance.legalFiles.map((file) => ({
                    archivePath: f.archive,
                    sourcePath: file.path,
                    sha256: file.originalSha256,
                })),
            };
            const originalLegal = validateDependencyLicenseProof(f.root, record, originalProof);
            expect(originalLegal.length).toBe(local.legalFiles.length);
            expect(originalLegal.map(({ sha256 }) => sha256).sort()).toEqual(
                local.provenance.legalFiles.map(({ originalSha256 }) => originalSha256).sort()
            );
            const report = renderDependencyLicenseReport([record]);
            expect(report).toContain('locally modified vendor/rust/cexpr-');
            expect(report).toContain(`original archive sha256:${f.source.upstreamArchiveSha256}`);
            expect(report).toContain(`source tree sha256:${local.provenance.sourceTreeSha256}`);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('replays Git-format recipes when private scratch is inside a repository', () => {
        const f = localFixture();
        const previousTemp = process.env.TMPDIR;
        try {
            execFileSync('git', ['init', '--quiet', f.root]);
            process.env.TMPDIR = f.root;
            const original = gunzipSync(readFileSync(join(f.root, 'vendor/rust', f.source.patch))).toString('utf8');
            const decoded = Buffer.from(
                original.replace(
                    /^--- a\/([^\n]+)\n\+\+\+ b\/([^\n]+)$/gmu,
                    (_header, before: string, after: string) => {
                        const change = f.source.changedFiles.find(({ path }) => path === before);
                        if (!change || before !== after) throw new Error('Expected the genuine same-path recipe');
                        const prefix = `diff --git a/${before} b/${after}\n`;
                        return change.original_sha256 === null
                            ? `${prefix}new file mode 100644\n--- /dev/null\n+++ b/${after}`
                            : `${prefix}--- a/${before}\n+++ b/${after}`;
                    }
                )
            );
            expect(decoded.toString('utf8')).toContain('diff --git a/Cargo.toml b/Cargo.toml');
            const compressed = gzipSync(decoded);
            f.write(`vendor/rust/${f.source.patch}`, compressed);
            f.source.patchSha256 = createHash('sha256').update(compressed).digest('hex');
            f.source.patchContentSha256 = createHash('sha256').update(decoded).digest('hex');
            f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
            expect(f.inspect().provenance.sourceTreeSha256).toMatch(/^[a-f0-9]{64}$/u);
        } finally {
            if (previousTemp === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = previousTemp;
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('refuses a modified Rust source while the lock and source record remain unchanged', () => {
        const f = localFixture();
        try {
            const local = f.inspect();
            f.write(
                `${f.source.directory}/src/lib.rs`,
                `${readFileSync(join(f.root, f.source.directory, 'src/lib.rs'), 'utf8')}\npub fn unrecorded_source_change() {}\n`
            );
            expect(f.inspect).toThrow(/modified source capsule bytes drifted/);
            expect(() => inspectCargoLocalPatch(f.root, f.pkg, local.provenance)).toThrow(
                /modified source capsule bytes drifted/
            );
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it.each(['archive', 'compressed patch', 'decoded patch'])('refuses %s identity drift', (subject) => {
        const f = localFixture();
        try {
            f.inspect();
            if (subject === 'archive')
                f.write(f.archive, Buffer.concat([readFileSync(join(f.root, f.archive)), Buffer.from('drift')]));
            else if (subject === 'compressed patch')
                f.write(`vendor/rust/${f.source.patch}`, Buffer.from('not the recorded patch'));
            else {
                const changed = gzipSync(
                    Buffer.concat([
                        gunzipSync(readFileSync(join(f.root, 'vendor/rust', f.source.patch))),
                        Buffer.from('\nchanged recipe\n'),
                    ])
                );
                f.write(`vendor/rust/${f.source.patch}`, changed);
                f.source.patchSha256 = createHash('sha256').update(changed).digest('hex');
                f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
            }
            expect(f.inspect).toThrow(
                /archive checksum drifted|compressed patch checksum drifted|decoded patch checksum drifted/
            );
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('refuses legal wording changes even when their recipe and changed-file hashes are updated', () => {
        const f = localFixture();
        try {
            f.inspect();
            const path = 'LICENSE-MIT';
            const before = readFileSync(join(f.root, f.source.directory, path));
            const after = Buffer.concat([before, Buffer.from('Unapproved additional legal wording.\n')]);
            const oldCount = before.toString('utf8').split('\n').length - 1;
            const hunk = `--- a/${path}\n+++ b/${path}\n@@ -${oldCount},0 +${oldCount + 1} @@\n+Unapproved additional legal wording.\n`;
            const decoded = Buffer.concat([
                gunzipSync(readFileSync(join(f.root, 'vendor/rust', f.source.patch))),
                Buffer.from(hunk),
            ]);
            const compressed = gzipSync(decoded);
            f.write(`${f.source.directory}/${path}`, after);
            f.write(`vendor/rust/${f.source.patch}`, compressed);
            f.source.patchSha256 = createHash('sha256').update(compressed).digest('hex');
            f.source.patchContentSha256 = createHash('sha256').update(decoded).digest('hex');
            f.source.changedFiles.push({
                path,
                original_sha256: createHash('sha256').update(before).digest('hex'),
                patched_sha256: createHash('sha256').update(after).digest('hex'),
            });
            f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
            expect(f.inspect).toThrow(/original legal wording drifted/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('refuses unapproved EOF normalization outside the admitted reqwest capsule', () => {
        const f = localFixture();
        try {
            f.inspect();
            const path = 'LICENSE-MIT';
            const before = readFileSync(join(f.root, f.source.directory, path));
            expect(before.at(-1)).toBe(10);
            const after = before.subarray(0, -1);
            const oldCount = before.toString('utf8').split('\n').length - 1;
            const finalLine = before.toString('utf8').split('\n').at(-2)!;
            const hunk = `--- a/${path}\n+++ b/${path}\n@@ -${oldCount} +${oldCount} @@\n-${finalLine}\n+${finalLine}\n\\ No newline at end of file\n`;
            const decoded = Buffer.concat([
                gunzipSync(readFileSync(join(f.root, 'vendor/rust', f.source.patch))),
                Buffer.from(hunk),
            ]);
            const compressed = gzipSync(decoded);
            f.write(`${f.source.directory}/${path}`, after);
            f.write(`vendor/rust/${f.source.patch}`, compressed);
            f.source.patchSha256 = createHash('sha256').update(compressed).digest('hex');
            f.source.patchContentSha256 = createHash('sha256').update(decoded).digest('hex');
            f.source.changedFiles.push({
                path,
                original_sha256: createHash('sha256').update(before).digest('hex'),
                patched_sha256: createHash('sha256').update(after).digest('hex'),
            });
            f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
            expect(f.inspect).toThrow(/original legal wording drifted/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    function writeLocalSnapshot(f: ReturnType<typeof localFixture>) {
        const local = f.inspect();
        const record: DependencyLicenseRecord = {
            ecosystem: 'cargo',
            name: f.pkg.name,
            version: f.pkg.version,
            license: f.source.license,
            cargoSource: null,
            cargoLocalPatch: local.provenance,
            legalFiles: local.legalFiles,
            graphs: ['Cargo.lock'],
        };
        for (const path of [
            'electron-builder.yml',
            'package.json',
            'rust-toolchain.toml',
            'scripts/buildNativeAddon.ts',
        ])
            f.write(path, readFileSync(join(process.cwd(), path)));
        const paths = [
            'Cargo.toml',
            'electron-builder.yml',
            'package.json',
            'rust-toolchain.toml',
            'scripts/buildNativeAddon.ts',
            'vendor/rust/sources.json',
        ].sort();
        const references = local.legalFiles.map(({ label, sha256 }) => ({ label, sha256 }));
        const inventory: CargoRuntimeInventorySnapshot = {
            cargoLockSha256: createHash('sha256')
                .update(readFileSync(join(f.root, 'Cargo.lock')))
                .digest('hex'),
            sourceInputs: paths.map((path) => ({
                path,
                sha256: createHash('sha256')
                    .update(readFileSync(join(f.root, path)))
                    .digest('hex'),
            })),
            featureSelection: {
                allFeatures: false,
                noDefaultFeatures: false,
                features: [...CARGO_RUNTIME_FEATURE_SELECTION.features],
            },
            packages: [
                {
                    name: record.name,
                    version: record.version,
                    source: null,
                    localPatch: local.provenance,
                    license: record.license,
                    legalFiles: references,
                    reportedLegalFiles: references,
                },
            ],
        };
        const manifest: DependencyLicenseProofSourceManifest = {
            schemaVersion: 5,
            cargoRuntimeInventory: inventory,
            packages: {},
        };
        f.write(DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify(manifest));
        f.write(DEPENDENCY_LICENSE_REPORT_PATH, renderDependencyLicenseReport([record]));
        return { record, manifest };
    }

    it('replays a genuine local-source snapshot offline and rejects stale source bytes', () => {
        const f = localFixture();
        try {
            const { record } = writeLocalSnapshot(f);
            const collected = collectCargoDependencyLicenses(f.root);
            expect(collected).toHaveLength(1);
            expect(collected[0]?.cargoSource).toBeNull();
            expect(collected[0]?.cargoLocalPatch).toEqual(record.cargoLocalPatch);
            f.write(
                `${f.source.directory}/src/lib.rs`,
                `${readFileSync(join(f.root, f.source.directory, 'src/lib.rs'), 'utf8')}\npub fn offline_drift() {}\n`
            );
            expect(() => collectCargoDependencyLicenses(f.root)).toThrow(/modified source capsule bytes drifted/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('refuses a local source in registry-only schema 4 and a tampered schema 5 source fingerprint', () => {
        const f = localFixture();
        try {
            const { manifest } = writeLocalSnapshot(f);
            f.write(DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify({ ...manifest, schemaVersion: 4 }));
            expect(() => collectCargoDependencyLicenses(f.root)).toThrow(
                /local patch sources require schema version 5/
            );
            const proofOnlySchema4 = structuredClone(manifest);
            proofOnlySchema4.schemaVersion = 4;
            const registryRow = proofOnlySchema4.cargoRuntimeInventory!.packages[0]!;
            const localProof = registryRow.localPatch!;
            registryRow.source = 'registry+https://index.crates.io/';
            delete registryRow.localPatch;
            f.write(DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify(proofOnlySchema4));
            expect(readDependencyLicenseProofManifest(f.root).schemaVersion).toBe(4);
            proofOnlySchema4.packages[`cargo:cexpr@${f.pkg.version}`] = {
                source: cargoRegistryArchiveSource(f.pkg),
                revision: `sha256:${f.source.upstreamArchiveSha256}`,
                localPatch: localProof,
            };
            f.write(DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify(proofOnlySchema4));
            expect(() => readDependencyLicenseProofManifest(f.root)).toThrow(
                /local patch sources require schema version 5/
            );
            const local = manifest.cargoRuntimeInventory?.packages[0]?.localPatch;
            if (!local) throw new Error('Local fixture snapshot is missing its subject');
            local.sourceTreeSha256 = '0'.repeat(64);
            f.write(DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify(manifest));
            // Keep report assignment in sync so the subject is the authenticated bytes, not row text.
            const record: DependencyLicenseRecord = {
                ecosystem: 'cargo',
                name: f.pkg.name,
                version: f.pkg.version,
                license: f.source.license,
                cargoSource: null,
                cargoLocalPatch: local,
                legalFiles: f.inspect().legalFiles,
                graphs: ['Cargo.lock'],
            };
            f.write(DEPENDENCY_LICENSE_REPORT_PATH, renderDependencyLicenseReport([record]));
            expect(() => collectCargoDependencyLicenses(f.root)).toThrow(
                /Snapshot-bound local patch provenance drifted/
            );
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('keeps arbitrary path and git sources refused', () => {
        const f = localFixture();
        try {
            const local = f.inspect();
            const common: DependencyLicenseRecord = {
                ecosystem: 'cargo',
                name: 'cexpr',
                version: f.pkg.version,
                license: f.source.license,
                legalFiles: local.legalFiles,
            };
            expect(() => expectedProofIdentities(f.root, { ...common, cargoSource: null })).toThrow(
                /local patch provenance is missing/
            );
            expect(() =>
                expectedProofIdentities(f.root, {
                    ...common,
                    cargoSource: 'git+https://example.invalid/cexpr#revision',
                })
            ).toThrow(/not the crates.io registry/);
            expect(() =>
                inspectCargoLocalPatch(f.root, { ...f.pkg, manifestPath: join(f.root, 'Cargo.toml') })
            ).toThrow(/manifest path drifted/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
    function archiveFixture(f: ReturnType<typeof localFixture>, members: Buffer[]) {
        const bytes = gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
        f.write(f.archive, bytes);
        f.source.upstreamArchiveSha256 = createHash('sha256').update(bytes).digest('hex');
        f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
    }
    it.each([
        'traversal',
        'directory traversal',
        'duplicate',
        'symbolic link',
        'hard link',
        'FIFO',
        'special permission',
        'outside package',
        'malformed tail',
    ])('refuses real %s archive entries before patch replay', (subject) => {
        const f = localFixture();
        try {
            const prefix = `cexpr-${f.pkg.version}`;
            const manifest = encodeTarEntry(
                `${prefix}/Cargo.toml`,
                'File',
                readFileSync(join(f.root, f.source.directory, 'Cargo.toml'))
            );
            let bad: Buffer;
            if (subject === 'duplicate') bad = manifest;
            else if (subject === 'special permission') {
                bad = Buffer.alloc(512);
                new Header({ path: `${prefix}/setuid`, type: 'File', size: 0, mode: 0o4755 }).encode(bad);
            } else if (
                subject === 'symbolic link' ||
                subject === 'hard link' ||
                subject === 'FIFO' ||
                subject === 'directory traversal'
            ) {
                bad = Buffer.alloc(512);
                new Header({
                    path: `${prefix}/${subject === 'directory traversal' ? '../escaped/' : 'link'}`,
                    type:
                        subject === 'symbolic link'
                            ? 'SymbolicLink'
                            : subject === 'hard link'
                              ? 'Link'
                              : subject === 'FIFO'
                                ? 'FIFO'
                                : 'Directory',
                    linkpath: subject === 'directory traversal' || subject === 'FIFO' ? '' : '../outside',
                    size: 0,
                    mode: 0o644,
                }).encode(bad);
            } else if (subject === 'malformed tail') bad = Buffer.alloc(512, 65);
            else
                bad = encodeTarEntry(
                    subject === 'traversal' ? `${prefix}/../../escaped` : 'elsewhere/file',
                    'File',
                    Buffer.from('payload')
                );
            archiveFixture(f, [manifest, bad]);
            expect(f.inspect).toThrow(/archive|Noncanonical|TAR_ENTRY_INVALID: checksum failure/);
            expect(existsSync(join(f.root, 'escaped'))).toBe(false);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
    it('refuses executable-bit drift and source symlinks with unchanged bytes', () => {
        const f = localFixture();
        try {
            f.inspect();
            const path = join(f.root, f.source.directory, 'src/lib.rs');
            chmodSync(path, 0o755);
            expect(f.inspect).toThrow(/modified source capsule bytes drifted/);
            chmodSync(path, 0o644);
            const bytes = readFileSync(path);
            f.write('aliased-source.rs', bytes);
            unlinkSync(path);
            symlinkSync(join(f.root, 'aliased-source.rs'), path);
            expect(f.inspect).toThrow(/source symlink is unsupported/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
    it('refuses symlinked metadata aliases and incomplete root patch registrations', () => {
        const f = localFixture();
        try {
            symlinkSync(f.pkg.manifestPath, join(f.root, 'manifest-alias.toml'));
            expect(() =>
                inspectCargoLocalPatch(f.root, { ...f.pkg, manifestPath: join(f.root, 'manifest-alias.toml') })
            ).toThrow(/manifest path drifted/);
            f.write(
                'Cargo.toml',
                `[workspace]\n[patch.crates-io]\ncexpr = { path = "${f.source.directory}" }\nunregistered = { path = "vendor/rust/unregistered" }\n`
            );
            expect(f.inspect).toThrow(/complete root patch table/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
    it('refuses oversized compressed archives before reading their contents', () => {
        const f = localFixture();
        try {
            truncateSync(join(f.root, f.archive), 64 * 1024 * 1024 + 1);
            expect(f.inspect).toThrow(/regular-file size bound/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
    it('refuses gzip expansion beyond the original source size bound', () => {
        const f = localFixture();
        try {
            const bomb = gzipSync(Buffer.alloc(256 * 1024 * 1024 + 1), { level: 1 });
            f.write(f.archive, bomb);
            f.source.upstreamArchiveSha256 = createHash('sha256').update(bomb).digest('hex');
            f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
            expect(f.inspect).toThrow(/Cannot create a Buffer larger|larger than|output length|size/i);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('refuses unrecorded recipe outputs after real native Git patch replay', () => {
        const f = localFixture();
        try {
            const decoded = Buffer.concat([
                gunzipSync(readFileSync(join(f.root, 'vendor/rust', f.source.patch))),
                Buffer.from('--- /dev/null\n+++ b/unrecorded.rs\n@@ -0,0 +1 @@\n+not recorded\n'),
            ]);
            const compressed = gzipSync(decoded);
            f.write(`vendor/rust/${f.source.patch}`, compressed);
            f.source.patchSha256 = createHash('sha256').update(compressed).digest('hex');
            f.source.patchContentSha256 = createHash('sha256').update(decoded).digest('hex');
            f.write('vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [f.source] }));
            expect(f.inspect).toThrow(/modifies an unrecorded input: unrecorded.rs/);
            expect(existsSync(join(f.root, 'unrecorded.rs'))).toBe(false);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
    it('refuses local license metadata drift even when the offline report row agrees', () => {
        const f = localFixture();
        try {
            const { manifest, record } = writeLocalSnapshot(f);
            manifest.cargoRuntimeInventory!.packages[0]!.license = 'MIT';
            f.write(DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify(manifest));
            f.write(DEPENDENCY_LICENSE_REPORT_PATH, renderDependencyLicenseReport([{ ...record, license: 'MIT' }]));
            expect(() => collectCargoDependencyLicenses(f.root)).toThrow(/local patch license declaration drifted/);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
});
