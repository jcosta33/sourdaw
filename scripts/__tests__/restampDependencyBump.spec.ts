import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    loadRepositorySnapshot,
    projectLicenseDistributionReleaseInventoryContract,
    REQUIRED_SNAPSHOT_PATHS,
    validateReleaseInventory,
    type ReleaseInventory,
} from '../checkReleaseInventory';
import {
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    readLegalFile,
    selectCanonicalSpdxLicenses,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    type DependencyLicenseProof,
    type DependencyLicenseRecord,
} from '../dependencyLicenseReport';
import { writeDependencyLicenseArtifacts } from '../generateDependencyLicenseReport';
import {
    RELEASE_INVENTORY_PATH,
    restampDependencyBump,
    UNRESTAMPED_DIGEST_CLASSES,
    type RestampOptions,
    type RestampResult,
} from '../restampDependencyBump';

const GRAND_BOULE_DIGEST_PATH = 'crates/daw-dsp/src/grand_boule';
const CARGO_REGISTRY = 'index.crates.io-6f17d22bba15001f';
const GENERATED_ARTIFACT_SNAPSHOT_PATHS = [
    'public/wasm/manifest.json',
    'src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.generated.json',
] as const;
const MIT_TEXT_PATH = 'release/spdx-license-texts/MIT.txt';
const SPDX_TEXT_PATHS = [MIT_TEXT_PATH, 'release/spdx-license-texts/Apache-2.0.txt'] as const;
const repositoryRoot = join(import.meta.dirname, '../..');
const staleDigest = 'c'.repeat(64);

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function write(root: string, path: string, contents: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
}

function digestOf(root: string, path: string): string {
    return createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex');
}

function trackedFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(path);
                continue;
            }
            found.push(relative(root, path));
        }
    };
    walk(root);
    return found.sort();
}

function fixtureSurface(id: string, digests: string[]): ReleaseInventory['surfaces'][number] {
    return {
        id,
        kind: 'source',
        retention: 'keep',
        owner: 'OS-01',
        releaseModes: ['source'],
        paths: ['**'],
        sources: ['git:example/repository'],
        revisions: ['deadbeef'],
        digests,
        licenses: ['Apache-2.0'],
        productSurfaces: ['source distribution'],
        evidence: ['package.json'],
        obligations: ['Preserve attribution.'],
    };
}

function currentInventory(root: string): ReleaseInventory {
    const contract = projectLicenseDistributionReleaseInventoryContract(root);
    return {
        schemaVersion: 1,
        surfaces: [
            fixtureSurface('javascript-dependencies', [
                `sha256:${digestOf(root, 'pnpm-lock.yaml')}`,
                `sha256:${digestOf(root, 'server/package-lock.json')}`,
                `sha256:${digestOf(root, SERVER_THIRD_PARTY_NOTICES_PATH)}:${SERVER_THIRD_PARTY_NOTICES_PATH}`,
                `sha256:${digestOf(root, 'Cargo.toml')}:Cargo.toml`,
            ]),
            fixtureSurface('collaboration-server', [`sha256:${digestOf(root, 'server/package-lock.json')}`]),
            fixtureSurface('rust-dependencies', [`sha256:${digestOf(root, 'Cargo.lock')}`]),
            { ...fixtureSurface('project-license-distribution', []), ...contract },
            fixtureSurface('grand-boule', [
                `tracked-set-sha256:${digestOf(root, GRAND_BOULE_DIGEST_PATH)}:${GRAND_BOULE_DIGEST_PATH}`,
            ]),
        ],
        snapshots: REQUIRED_SNAPSHOT_PATHS.map((path) => ({ path, sha256: digestOf(root, path) })),
        externalReferences: [],
        marks: [],
    };
}

function writeInventory(root: string, inventory: ReleaseInventory): void {
    write(root, RELEASE_INVENTORY_PATH, `${JSON.stringify(inventory, null, 4)}\n`);
}

function readInventory(root: string): ReleaseInventory {
    return JSON.parse(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')) as ReleaseInventory;
}

function readProofPackages(root: string): Record<string, DependencyLicenseProof> {
    return (
        JSON.parse(readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')) as {
            packages: Record<string, DependencyLicenseProof>;
        }
    ).packages;
}

function writeProofs(root: string, packages: Record<string, DependencyLicenseProof>): void {
    write(
        root,
        DEPENDENCY_LICENSE_PROOFS_PATH,
        `${JSON.stringify(
            {
                schemaVersion: 4,
                cargoRuntimeInventory: {
                    cargoLockSha256: digestOf(root, 'Cargo.lock'),
                    sourceInputs: [],
                    featureSelection: { allFeatures: false, noDefaultFeatures: false, features: [] },
                    packages: [],
                },
                packages,
            },
            null,
            4
        )}\n`
    );
}

/** A fixture whose every restampable digest already matches the file it addresses. */
function createFixture(packages: Record<string, DependencyLicenseProof> = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-restamp-'));
    roots.push(root);
    for (const path of REQUIRED_SNAPSHOT_PATHS) {
        write(root, path, `${path} fixture\n`);
    }
    write(root, 'LICENSE', 'fixture license\n');
    write(root, 'NOTICE', 'fixture notice\n');
    write(root, DEPENDENCY_LICENSE_REPORT_PATH, 'fixture dependency licenses\n');
    write(root, SERVER_THIRD_PARTY_NOTICES_PATH, 'fixture server notices\n');
    write(root, GRAND_BOULE_DIGEST_PATH, 'fixture grand boule source\n');
    // The canonical SPDX texts are what an assembled proof's elected licenses are read back from.
    for (const path of SPDX_TEXT_PATHS) {
        write(root, path, readFileSync(join(repositoryRoot, path), 'utf8'));
    }
    writeProofs(root, packages);
    writeInventory(root, currentInventory(root));
    return root;
}

function digestDriftErrors(root: string): string[] {
    const inventory = readInventory(root);
    const snapshot = loadRepositorySnapshot(root, inventory, trackedFiles(root));
    return validateReleaseInventory(inventory, snapshot).filter((error) => /drifted|digest must match/u.test(error));
}

function restamp(root: string, overrides: RestampOptions = {}): RestampResult {
    return restampDependencyBump(root, {
        resolveInstalled: () => ({ records: [], cargoSourceDirectories: {} }),
        writeArtifacts: () => undefined,
        verify: () => [],
        ...overrides,
    });
}

function cargoRecord(sourceDirectory: string, license: string): DependencyLicenseRecord {
    return {
        ecosystem: 'cargo',
        name: 'demo',
        version: '2.0.0',
        license,
        legalFiles: [],
        metadataFiles: [readLegalFile(join(sourceDirectory, 'Cargo.toml'), 'Cargo.toml')],
        cargoSource: 'registry+https://github.com/rust-lang/crates.io-index',
        graphs: ['Cargo.lock'],
    };
}

function writeCrateFixture(root: string, { archive }: { archive: boolean }): string {
    const sourcePath = `cargo-home/registry/src/${CARGO_REGISTRY}/demo-2.0.0/Cargo.toml`;
    write(root, sourcePath, '[package]\nname = "demo"\nversion = "2.0.0"\n');
    if (archive) {
        write(root, `cargo-home/registry/cache/${CARGO_REGISTRY}/demo-2.0.0.crate`, 'demo crate archive bytes');
    }
    return join(root, dirname(sourcePath));
}

const staleAssembledProof: DependencyLicenseProof = {
    source: 'https://crates.io/api/v1/crates/demo/1.0.0/download',
    revision: `sha256:${'d'.repeat(64)}`,
    assembled: { metadata: [{ sourcePath: 'Cargo.toml', sha256: 'e'.repeat(64) }], licenses: ['MIT'] },
};

describe('restamp dependency bump', () => {
    it('rewrites a drifted lockfile snapshot and the surface digest bound to it', () => {
        const root = createFixture();
        write(root, 'pnpm-lock.yaml', 'bumped pnpm lock\n');
        const digest = digestOf(root, 'pnpm-lock.yaml');
        expect(digestDriftErrors(root)).toEqual(
            expect.arrayContaining([
                'pnpm-lock.yaml: snapshot drifted',
                `javascript-dependencies: digest must match pnpm-lock.yaml snapshot (sha256:${digest})`,
            ])
        );

        const result = restamp(root);

        expect(result.ok).toBe(true);
        const written = readInventory(root);
        expect(written.snapshots.find((entry) => entry.path === 'pnpm-lock.yaml')?.sha256).toBe(digest);
        expect(written.surfaces.find((surface) => surface.id === 'javascript-dependencies')?.digests).toContain(
            `sha256:${digest}`
        );
        expect(digestDriftErrors(root)).toEqual([]);
    });

    it('rewrites a path-addressed digest it owns and leaves every other one alone', () => {
        const root = createFixture();
        write(root, SERVER_THIRD_PARTY_NOTICES_PATH, 'regenerated server notices\n');
        write(root, 'Cargo.toml', 'bumped workspace manifest\n');
        const staleCargoToml = readInventory(root).surfaces.find((surface) => surface.id === 'javascript-dependencies')
            ?.digests[3];

        expect(restamp(root).ok).toBe(true);

        const digests = readInventory(root).surfaces.find(
            (surface) => surface.id === 'javascript-dependencies'
        )?.digests;
        expect(digests).toContain(
            `sha256:${digestOf(root, SERVER_THIRD_PARTY_NOTICES_PATH)}:${SERVER_THIRD_PARTY_NOTICES_PATH}`
        );
        expect(digests).toContain(staleCargoToml);
        expect(digests).not.toContain(`sha256:${digestOf(root, 'Cargo.toml')}:Cargo.toml`);
    });

    it('carries an assembled cargo proof forward to the resolved version', () => {
        const root = createFixture({ 'cargo:demo@1.0.0': staleAssembledProof });
        const sourceDirectory = writeCrateFixture(root, { archive: true });

        const result = restamp(root, {
            cargoHome: join(root, 'cargo-home'),
            resolveInstalled: () => ({
                records: [cargoRecord(sourceDirectory, 'Apache-2.0')],
                cargoSourceDirectories: { 'cargo:demo@2.0.0': sourceDirectory },
            }),
        });

        expect(result.ok).toBe(true);
        expect(readProofPackages(root)).toEqual({
            'cargo:demo@2.0.0': {
                source: 'https://crates.io/api/v1/crates/demo/2.0.0/download',
                revision: `sha256:${digestOf(root, `cargo-home/registry/cache/${CARGO_REGISTRY}/demo-2.0.0.crate`)}`,
                assembled: {
                    metadata: [
                        {
                            sourcePath: 'Cargo.toml',
                            sha256: digestOf(root, `cargo-home/registry/src/${CARGO_REGISTRY}/demo-2.0.0/Cargo.toml`),
                        },
                    ],
                    licenses: ['Apache-2.0'],
                },
            },
        });
    });

    it('pins a proof for a resolved cargo package whose own files leave its license unsubstantiated', () => {
        const root = createFixture();
        const sourceDirectory = writeCrateFixture(root, { archive: true });

        const result = restamp(root, {
            cargoHome: join(root, 'cargo-home'),
            resolveInstalled: () => ({
                records: [cargoRecord(sourceDirectory, 'MIT')],
                cargoSourceDirectories: { 'cargo:demo@2.0.0': sourceDirectory },
            }),
        });

        expect(result.ok).toBe(true);
        expect(readProofPackages(root)['cargo:demo@2.0.0']?.assembled?.licenses).toEqual(['MIT']);
    });

    it('refuses a carry-forward whose crate archive is not in the cargo cache', () => {
        const root = createFixture({ 'cargo:demo@1.0.0': staleAssembledProof });
        const sourceDirectory = writeCrateFixture(root, { archive: false });
        const recorded = readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8');

        const result = restamp(root, {
            cargoHome: join(root, 'cargo-home'),
            resolveInstalled: () => ({
                records: [cargoRecord(sourceDirectory, 'MIT')],
                cargoSourceDirectories: { 'cargo:demo@2.0.0': sourceDirectory },
            }),
        });

        expect(result.ok).toBe(false);
        expect(result.output).toContain('cargo:demo@2.0.0: demo-2.0.0.crate is absent from');
        expect(result.output).toContain('cargo fetch');
        expect(readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')).toBe(recorded);
    });

    it('refuses to carry an archive proof to a bumped package', () => {
        const root = createFixture({
            'npm:ws@8.0.0': {
                source: 'https://registry.npmjs.org/ws/-/ws-8.0.0.tgz',
                revision: 'sha512-recorded',
                files: [
                    {
                        archivePath: 'release/dependency-license-proofs/ws-8.0.0.tgz',
                        sourcePath: 'LICENSE',
                        sha256: 'f'.repeat(64),
                    },
                ],
            },
        });
        const recorded = readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8');

        const result = restamp(root, {
            resolveInstalled: () => ({
                records: [
                    {
                        ecosystem: 'npm',
                        name: 'ws',
                        version: '9.0.0',
                        license: 'MIT',
                        legalFiles: [],
                        graphs: ['pnpm-lock.yaml'],
                    },
                ],
                cargoSourceDirectories: {},
            }),
        });

        expect(result.ok).toBe(false);
        expect(result.output).toContain('npm:ws@8.0.0: an archive proof cannot be carried to npm:ws@9.0.0');
        expect(result.output).toContain('release/dependency-license-proofs/ws-8.0.0.tgz');
        expect(readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')).toBe(recorded);
    });

    it('carries an assembled npm proof forward using the locked archive identity', () => {
        const root = createFixture({
            'npm:demo@1.0.0': {
                source: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz',
                revision: 'sha512-recorded',
                assembled: { metadata: [{ sourcePath: 'package.json', sha256: 'e'.repeat(64) }], licenses: ['MIT'] },
            },
        });
        write(root, 'pnpm-lock.yaml', 'packages:\n  demo@2.0.0:\n    resolution:\n      integrity: sha512-bumped\n');
        write(root, 'node_modules/demo/package.json', '{ "name": "demo", "version": "2.0.0" }\n');

        const result = restamp(root, {
            resolveInstalled: () => ({
                records: [
                    {
                        ecosystem: 'npm',
                        name: 'demo',
                        version: '2.0.0',
                        license: 'MIT',
                        legalFiles: [],
                        metadataFiles: [readLegalFile(join(root, 'node_modules/demo/package.json'), 'package.json')],
                        graphs: ['pnpm-lock.yaml'],
                    },
                ],
                cargoSourceDirectories: {},
            }),
        });

        expect(result.ok).toBe(true);
        expect(readProofPackages(root)).toEqual({
            'npm:demo@2.0.0': {
                source: 'https://registry.npmjs.org/demo/-/demo-2.0.0.tgz',
                revision: 'sha512-bumped',
                assembled: {
                    metadata: [
                        { sourcePath: 'package.json', sha256: digestOf(root, 'node_modules/demo/package.json') },
                    ],
                    licenses: ['MIT'],
                },
            },
        });
    });

    it('leaves a drifted Grand Boule tracked-set digest to a person', () => {
        const root = createFixture();
        const inventory = readInventory(root);
        inventory.surfaces.find((surface) => surface.id === 'grand-boule')!.digests = [
            `tracked-set-sha256:${staleDigest}:${GRAND_BOULE_DIGEST_PATH}`,
        ];
        writeInventory(root, inventory);
        const recorded = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');

        const result = restamp(root, { verify: () => ['grand-boule: tracked-set digest drifted'] });

        expect(result.ok).toBe(false);
        expect(result.output.split('\n')[0]).toBe(UNRESTAMPED_DIGEST_CLASSES);
        expect(UNRESTAMPED_DIGEST_CLASSES).toContain('Grand Boule tracked-set');
        expect(result.output).toContain('grand-boule: tracked-set digest drifted');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(recorded);
    });

    it('rewrites nothing on a tree that already agrees with its files', () => {
        const root = createFixture();
        const inventory = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        const proofs = readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8');

        const result = restamp(root);

        expect(result).toEqual({ ok: true, output: 'restamped: nothing to rewrite\n' });
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(inventory);
        expect(readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')).toBe(proofs);
    });

    it('leaves a drifted generated-artifact snapshot to a person', () => {
        const root = createFixture();
        for (const path of GENERATED_ARTIFACT_SNAPSHOT_PATHS) {
            write(root, path, `rebuilt ${path}\n`);
        }
        const recorded = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        const drifted = GENERATED_ARTIFACT_SNAPSHOT_PATHS.map((path) => `${path}: snapshot drifted`);
        expect(digestDriftErrors(root)).toEqual(expect.arrayContaining(drifted));

        expect(restamp(root).ok).toBe(true);

        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(recorded);
        expect(digestDriftErrors(root)).toEqual(expect.arrayContaining(drifted));
        expect(UNRESTAMPED_DIGEST_CLASSES).toContain('public/wasm/manifest.json');
    });

    it('keeps the licenses the predecessor proof elected when the bumped expression still admits them', () => {
        const root = createFixture({ 'cargo:demo@1.0.0': staleAssembledProof });
        const sourceDirectory = writeCrateFixture(root, { archive: true });

        const result = restamp(root, {
            cargoHome: join(root, 'cargo-home'),
            resolveInstalled: () => ({
                records: [cargoRecord(sourceDirectory, 'Zlib OR Apache-2.0 OR MIT')],
                cargoSourceDirectories: { 'cargo:demo@2.0.0': sourceDirectory },
            }),
        });

        expect(result.ok).toBe(true);
        expect(readProofPackages(root)['cargo:demo@2.0.0']?.assembled?.licenses).toEqual(['MIT']);
        expect(selectCanonicalSpdxLicenses('Zlib OR Apache-2.0 OR MIT')).toEqual(['Apache-2.0']);
    });

    it('drops a stale proof key once the bumped package substantiates its own license', () => {
        const root = createFixture({ 'cargo:demo@1.0.0': staleAssembledProof });
        const sourceDirectory = writeCrateFixture(root, { archive: true });

        const result = restamp(root, {
            cargoHome: join(root, 'cargo-home'),
            resolveInstalled: () => ({
                records: [
                    {
                        ...cargoRecord(sourceDirectory, 'MIT'),
                        legalFiles: [readLegalFile(join(root, MIT_TEXT_PATH), 'LICENSE')],
                    },
                ],
                cargoSourceDirectories: { 'cargo:demo@2.0.0': sourceDirectory },
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.output).toContain('dropped cargo:demo@1.0.0');
        expect(readProofPackages(root)).toEqual({});
    });

    it('writes the regenerated dependency-license artifacts to disk', () => {
        const root = createFixture();
        const artifacts = {
            proofManifest: '{ "schemaVersion": 4, "packages": {} }\n',
            report: 'regenerated dependency licenses\n',
            serverNotices: 'regenerated server notices\n',
        };

        const result = restamp(root, {
            writeArtifacts: (target) => {
                writeDependencyLicenseArtifacts(target, () => artifacts);
            },
        });

        expect(result.ok).toBe(true);
        expect(readFileSync(join(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')).toBe(artifacts.proofManifest);
        expect(readFileSync(join(root, DEPENDENCY_LICENSE_REPORT_PATH), 'utf8')).toBe(artifacts.report);
        expect(readFileSync(join(root, SERVER_THIRD_PARTY_NOTICES_PATH), 'utf8')).toBe(artifacts.serverNotices);
    });

    it('restores every file it wrote when verification refuses', () => {
        const root = createFixture();
        write(root, 'pnpm-lock.yaml', 'bumped pnpm lock\n');
        const inventory = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        const notices = readFileSync(join(root, SERVER_THIRD_PARTY_NOTICES_PATH), 'utf8');

        const result = restamp(root, {
            writeArtifacts: (target) => {
                writeFileSync(join(target, SERVER_THIRD_PARTY_NOTICES_PATH), 'regenerated server notices\n');
            },
            verify: () => ['project-wasm: release inventory digests does not match provenance'],
        });

        expect(result.ok).toBe(false);
        expect(result.output).toContain('project-wasm: release inventory digests does not match provenance');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(inventory);
        expect(readFileSync(join(root, SERVER_THIRD_PARTY_NOTICES_PATH), 'utf8')).toBe(notices);
    });

    it('refuses with what both checks report, in the order they run', () => {
        const root = createFixture();

        const result = restampDependencyBump(root, {
            resolveInstalled: () => ({ records: [], cargoSourceDirectories: {} }),
            writeArtifacts: () => undefined,
            checkLicense: () => {
                throw new Error('LICENSE: project license drifted');
            },
            checkInventory: () => {
                throw new Error('grand-boule: release inventory digests does not match provenance');
            },
        });

        expect(result.ok).toBe(false);
        expect(result.output.split('\n').slice(0, 3)).toEqual([
            UNRESTAMPED_DIGEST_CLASSES,
            'LICENSE: project license drifted',
            'grand-boule: release inventory digests does not match provenance',
        ]);
    });

    it('is reachable as pnpm release:restamp', () => {
        const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };

        expect(manifest.scripts['release:restamp']).toBe('node scripts/restampDependencyBump.ts');
    });

    it('is listed in the AGENTS.md checks table', () => {
        const agents = readFileSync(join(import.meta.dirname, '../../AGENTS.md'), 'utf8');

        expect(agents).toMatch(/^\| Restamp a dependency bump +\| `pnpm release:restamp` +\|$/mu);
    });
});
