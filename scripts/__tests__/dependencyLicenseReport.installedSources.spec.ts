import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildDependencyLicenseArtifactsFromInstalledMetadata,
    collectCargoDependencyLicenses,
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    type DependencyLicenseProofSourceManifest,
} from '../dependencyLicenseReport';
import type { SourceManifest } from '../cargoLocalPatchProof';

const boundary = vi.hoisted(() => ({ metadata: '' }));
vi.mock('../cargoMetadata.ts', () => ({ cargoMetadata: () => boundary.metadata }));
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
            // Only the external pnpm inventory boundary is replaced. Native Git replay stays real.
            if (args[0] === 'pnpm' && args[1]?.join(' ') === 'licenses list --prod --json') return '{}';
            return actual.execFileSync(...args);
        },
    };
});
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function write(root: string, path: string, bytes: string | Buffer): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
}
function archiveFile(path: string, contents: Buffer): Buffer {
    const header = Buffer.alloc(512);
    new Header({ path, type: 'File', size: contents.length, mode: 0o644 }).encode(header);
    return Buffer.concat([header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)]);
}
function fixture(kind: 'git' | 'registry' | 'local') {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-installed-origin-'));
    roots.push(root);
    const legal = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'));
    write(root, 'Cargo.toml', '[workspace]\nmembers = ["native"]\n');
    write(root, 'native/Cargo.toml', '[package]\nname = "sourdaw-native"\nversion = "0.0.0"\nlicense = "Apache-2.0"\n');
    write(root, 'package.json', '{"name":"private-origin-fixture","version":"1.0.0","private":true}\n');
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n");
    for (const path of ['electron-builder.yml', 'rust-toolchain.toml', 'scripts/buildNativeAddon.ts'])
        write(root, path, readFileSync(join(process.cwd(), path)));
    const serverArchive = gzipSync(Buffer.concat([archiveFile('package/LICENSE', legal), Buffer.alloc(1024)]));
    const serverArchivePath = 'release/dependency-license-proofs/fixture-server-1.0.0.tgz';
    const integrity = `sha512-${createHash('sha512').update(serverArchive).digest('base64')}`;
    write(root, serverArchivePath, serverArchive);
    write(
        root,
        'server/package-lock.json',
        JSON.stringify({
            packages: {
                '': { dependencies: { 'fixture-server': '1.0.0' } },
                'node_modules/fixture-server': {
                    version: '1.0.0',
                    license: 'MIT',
                    resolved: 'https://registry.npmjs.org/fixture-server/-/fixture-server-1.0.0.tgz',
                    integrity,
                },
            },
        })
    );
    write(
        root,
        DEPENDENCY_LICENSE_PROOFS_PATH,
        JSON.stringify({
            schemaVersion: 3,
            packages: {
                'npm:fixture-server@1.0.0': {
                    source: 'https://registry.npmjs.org/fixture-server/-/fixture-server-1.0.0.tgz',
                    revision: integrity,
                    files: [
                        {
                            archivePath: serverArchivePath,
                            sourcePath: 'LICENSE',
                            sha256: createHash('sha256').update(legal).digest('hex'),
                        },
                    ],
                },
            },
        })
    );
    let name = 'fixture-cargo';
    let version = '1.0.0';
    let license = 'MIT';
    let directory = 'installed-cargo';
    let source: string | null =
        kind === 'git'
            ? `git+https://example.invalid/fixture-cargo#${'1'.repeat(40)}`
            : 'registry+https://index.crates.io/';
    write(root, `${directory}/Cargo.toml`, `[package]\nname = "${name}"\nversion = "${version}"\nlicense = "MIT"\n`);
    write(root, `${directory}/LICENSE`, legal);
    const cargoArchive = gzipSync(
        Buffer.concat([archiveFile(`${name}-${version}/LICENSE`, legal), Buffer.alloc(1024)])
    );
    const checksumLine =
        kind === 'registry' ? `checksum = "${createHash('sha256').update(cargoArchive).digest('hex')}"\n` : '';
    write(
        root,
        'Cargo.lock',
        `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "${source}"\n${checksumLine}`
    );
    if (kind === 'local') {
        const manifest = JSON.parse(
            readFileSync(join(process.cwd(), 'vendor/rust/sources.json'), 'utf8')
        ) as SourceManifest;
        const original = manifest.sources.find((record) => record.package === 'cexpr');
        if (!original) throw new Error('The authentic cexpr capsule is required');
        name = original.package;
        version = original.version;
        license = original.license;
        directory = original.directory;
        source = null;
        cpSync(join(process.cwd(), directory), join(root, directory), { recursive: true });
        write(root, `vendor/rust/${original.patch}`, readFileSync(join(process.cwd(), 'vendor/rust', original.patch)));
        write(root, 'vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [original] }));
        write(
            root,
            'Cargo.toml',
            `[workspace]\nmembers = ["native"]\n[patch.crates-io]\ncexpr = { path = "${directory}" }\n`
        );
        write(root, 'Cargo.lock', readFileSync(join(process.cwd(), 'Cargo.lock')));
        write(
            root,
            'release/dependency-license-proofs/cexpr-0.6.0.crate',
            readFileSync(join(process.cwd(), 'scripts/__tests__/fixtures/local-cargo-proof/cexpr-0.6.0.crate'))
        );
    }
    boundary.metadata = JSON.stringify({
        packages: [
            {
                id: 'native',
                name: 'sourdaw-native',
                version: '0.0.0',
                source: null,
                license: 'Apache-2.0',
                license_file: null,
                manifest_path: join(root, 'native/Cargo.toml'),
            },
            {
                id: 'dependency',
                name,
                version,
                source,
                license,
                license_file: null,
                manifest_path: join(root, directory, 'Cargo.toml'),
            },
        ],
        workspace_members: ['native'],
        resolve: {
            nodes: [
                {
                    id: 'native',
                    features: ['napi-addon'],
                    deps: [{ pkg: 'dependency', dep_kinds: [{ kind: null, target: null }] }],
                },
                { id: 'dependency', features: [], deps: [] },
            ],
        },
    });
    return root;
}
describe('installed source authentication before retained legal evidence', () => {
    it('refuses a git source carrying genuine complete MIT bytes through artifact generation', () => {
        const root = fixture('git');
        expect(() => buildDependencyLicenseArtifactsFromInstalledMetadata(root)).toThrow(
            /proof source is not the crates.io registry/
        );
    });
    it('refuses an unregistered null-source dependency carrying genuine legal bytes', () => {
        const root = fixture('git');
        const metadata = JSON.parse(boundary.metadata) as { packages: Array<{ id: string; source: string | null }> };
        const dependency = metadata.packages.find(({ id }) => id === 'dependency');
        if (!dependency) throw new Error('The metadata fixture must include its dependency');
        dependency.source = null;
        boundary.metadata = JSON.stringify(metadata);
        write(root, 'vendor/rust/sources.json', JSON.stringify({ schemaVersion: 1, sources: [] }));
        expect(() => buildDependencyLicenseArtifactsFromInstalledMetadata(root)).toThrow(
            /Missing local patch identity/
        );
    });
    it('refuses an offline git origin beside valid retained legal bytes', () => {
        const root = fixture('registry');
        const generated = buildDependencyLicenseArtifactsFromInstalledMetadata(root);
        const snapshot = JSON.parse(generated.proofManifest) as DependencyLicenseProofSourceManifest;
        const row = snapshot.cargoRuntimeInventory?.packages[0];
        if (!row) throw new Error('The generated fixture must contain its Cargo package');
        row.source = `git+https://example.invalid/fixture-cargo#${'1'.repeat(40)}`;
        write(root, DEPENDENCY_LICENSE_PROOFS_PATH, JSON.stringify(snapshot));
        write(root, DEPENDENCY_LICENSE_REPORT_PATH, generated.report);
        expect(() => collectCargoDependencyLicenses(root)).toThrow(/proof source is not the crates.io registry/);
    });
    it.each(['registry', 'local'] as const)(
        'generates and replays an authenticated %s source with retained legal evidence',
        (kind) => {
            const root = fixture(kind);
            const generated = buildDependencyLicenseArtifactsFromInstalledMetadata(root);
            write(root, DEPENDENCY_LICENSE_PROOFS_PATH, generated.proofManifest);
            write(root, DEPENDENCY_LICENSE_REPORT_PATH, generated.report);
            const records = collectCargoDependencyLicenses(root);
            expect(records).toHaveLength(1);
            expect(records[0]?.cargoSource).toBe(kind === 'local' ? null : 'registry+https://index.crates.io/');
            expect(generated.report).toContain(
                kind === 'local' ? 'locally modified vendor/rust/cexpr-' : 'cargo:fixture-cargo@1.0.0'
            );
        }
    );
});
