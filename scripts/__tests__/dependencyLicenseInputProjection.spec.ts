import { describe, expect, it } from 'vitest';

import {
    cargoManifestLicenceGraphProjection,
    curatedDependencyLicenseProofsProjection,
    electronBuilderNodeModulesExclusionProjection,
    licenceInputDigest,
    licenceInputProjectionKind,
    packageJsonLicenceFieldsProjection,
} from '../dependencyLicenseInputProjection';

const MANIFEST = `[workspace]
members = ["crates/a", "crates/b"]
exclude = ["crates/retired"]
resolver = "2"

[workspace.package]
license = "Apache-2.0"
version = "0.1.0"

[workspace.dependencies]
windows = "0.62.2"

[workspace.lints.clippy]
todo = "deny"

[package]
name = "demo"
version = "0.1.0"
description = "Demo crate"
license.workspace = true

[lints]
workspace = true

[features]
default = []
addon = ["dep:napi"]

[dependencies]
napi = { version = "3", optional = true }
serde = "1"
windows = { workspace = true }

[dev-dependencies]
tempfile = "3"

[build-dependencies]
napi-build = "2"

[target.'cfg(target_os = "macos")'.dependencies]
coreaudio-rs = "0.13"

[patch.crates-io]
cpal = { git = "https://example.invalid/cpal", rev = "abc" }

[replace]
"foo:0.1.0" = { path = "vendor/foo" }

[profile.release]
lto = true
`;

function projectEdit(before: string, after: string): string {
    expect(MANIFEST).toContain(before);
    return cargoManifestLicenceGraphProjection(MANIFEST.replace(before, after), 'Cargo.toml');
}

const PACKAGE_JSON = `{
    "name": "fixture",
    "license": "Apache-2.0",
    "scripts": {
        "build": "vite build",
        "test": "vitest"
    },
    "dependencies": {
        "react": "19.0.0"
    }
}
`;

const ELECTRON_BUILDER = `files:
    - dist/**/*
    - '!node_modules/**/*'
extraResources:
    - from: crates/sourdaw-native
`;

const PROOFS = `${JSON.stringify(
    {
        schemaVersion: 5,
        cargoRuntimeInventory: { cargoLockSha256: 'a'.repeat(64), sourceInputs: [], packages: [] },
        packages: {
            'cargo:napi@3.16.2': {
                source: 'https://crates.io/api/v1/crates/napi/3.16.2/download',
                revision: `sha256:${'b'.repeat(64)}`,
                assembled: { metadata: [{ sourcePath: 'Cargo.toml', sha256: 'c'.repeat(64) }], licenses: ['MIT'] },
            },
            'npm:demo@1.0.0': {
                source: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz',
                revision: 'sha512-demo',
                files: [{ archivePath: 'package/LICENSE', sourcePath: 'release/demo/LICENSE', sha256: 'd'.repeat(64) }],
            },
        },
    },
    null,
    4
)}\n`;

function proofsEdit(edit: (manifest: Record<string, unknown>) => void): string {
    const manifest = JSON.parse(PROOFS) as Record<string, unknown>;
    edit(manifest);
    return curatedDependencyLicenseProofsProjection(`${JSON.stringify(manifest, null, 4)}\n`, 'proofs.json');
}

describe('dependency licence input projection', () => {
    const baseline = cargoManifestLicenceGraphProjection(MANIFEST, 'Cargo.toml');

    it.each([
        ['[dependencies] add', 'serde = "1"\n', 'serde = "1"\nrtrb = "0.4"\n'],
        ['[dependencies] remove', 'serde = "1"\n', ''],
        ['[dependencies] re-version', 'serde = "1"', 'serde = "2"'],
        ['[dev-dependencies] add', 'tempfile = "3"\n', 'tempfile = "3"\nproptest = "1"\n'],
        ['[dev-dependencies] remove', 'tempfile = "3"\n', ''],
        ['[dev-dependencies] re-version', 'tempfile = "3"', 'tempfile = "4"'],
        ['[build-dependencies] add', 'napi-build = "2"\n', 'napi-build = "2"\ncc = "1"\n'],
        ['[build-dependencies] remove', 'napi-build = "2"\n', ''],
        ['[build-dependencies] re-version', 'napi-build = "2"', 'napi-build = "3"'],
        ['[target.*.dependencies] add', 'coreaudio-rs = "0.13"\n', 'coreaudio-rs = "0.13"\nobjc2 = "0.6"\n'],
        ['[target.*.dependencies] remove', 'coreaudio-rs = "0.13"\n', ''],
        ['[target.*.dependencies] re-version', 'coreaudio-rs = "0.13"', 'coreaudio-rs = "0.14"'],
        ['[workspace.dependencies] add', 'windows = "0.62.2"\n', 'windows = "0.62.2"\nlibc = "0.2"\n'],
        ['[workspace.dependencies] remove', 'windows = "0.62.2"\n', ''],
        ['workspace-inherited dependency re-versioned at the root', 'windows = "0.62.2"', 'windows = "0.63.0"'],
        ['[patch.*] add', 'rev = "abc" }\n', 'rev = "abc" }\nrubato = { path = "vendor/rubato" }\n'],
        ['[patch.*] remove', 'cpal = { git = "https://example.invalid/cpal", rev = "abc" }\n', ''],
        ['[patch.*] re-version', 'rev = "abc"', 'rev = "def"'],
        ['[replace] re-point', 'path = "vendor/foo"', 'path = "vendor/foo-fork"'],
        ['[features] enables an optional dependency', 'default = []', 'default = ["addon"]'],
        ['[features] changes a feature list', 'addon = ["dep:napi"]', 'addon = ["dep:napi", "serde/derive"]'],
        ['optional dependency made mandatory', 'version = "3", optional = true', 'version = "3"'],
        ['[package] license', 'license.workspace = true', 'license = "MIT"'],
        ['[package] license-file', 'license.workspace = true', 'license-file = "LICENSE"'],
        ['[workspace.package] license', 'license = "Apache-2.0"', 'license = "MIT"'],
        ['new workspace member', '"crates/b"]', '"crates/b", "crates/c"]'],
        ['workspace exclude', '["crates/retired"]', '[]'],
        ['resolver', 'resolver = "2"', 'resolver = "3"'],
    ])('moves the Cargo projection on %s', (_change, before, after) => {
        expect(projectEdit(before, after)).not.toBe(baseline);
    });

    it.each([
        ['[lints] edit', '[lints]\nworkspace = true\n', ''],
        ['[workspace.lints] edit', 'todo = "deny"', 'todo = "warn"'],
        ['crate version', 'version = "0.1.0"\ndescription', 'version = "0.2.0"\ndescription'],
        [
            '[workspace.package] version',
            'version = "0.1.0"\n\n[workspace.dependencies]',
            'version = "0.3.0"\n\n[workspace.dependencies]',
        ],
        ['description', 'description = "Demo crate"', 'description = "A demo crate"'],
        ['comment', '[dependencies]\n', '[dependencies]\n# Runtime dependencies.\n'],
        ['trailing comment', 'serde = "1"', 'serde = "1" # serialization'],
        [
            'key reorder',
            'serde = "1"\nwindows = { workspace = true }\n',
            'windows = { workspace = true }\nserde = "1"\n',
        ],
        ['profile', 'lto = true', 'lto = false'],
    ])('leaves the Cargo projection alone on %s', (_change, before, after) => {
        expect(projectEdit(before, after)).toBe(baseline);
    });

    it('leaves the Cargo projection alone on table reorder', () => {
        const table = '[dev-dependencies]\ntempfile = "3"\n';
        expect(MANIFEST).toContain(`${table}\n`);
        const reordered = `${MANIFEST.replace(`${table}\n`, '')}\n${table}`;
        expect(cargoManifestLicenceGraphProjection(reordered, 'Cargo.toml')).toBe(baseline);
    });

    it('fails closed on a manifest shape the line scanner cannot read', () => {
        expect(() =>
            cargoManifestLicenceGraphProjection('[package]\ndescription = """\n[dependencies]\n"""\n', 'Cargo.toml')
        ).toThrow('multi-line TOML strings are not supported');
        expect(() => cargoManifestLicenceGraphProjection('[dependencies]\nserde\n', 'Cargo.toml')).toThrow(
            'unrecognised Cargo manifest line'
        );
    });

    it.each([
        ['license', '"license": "Apache-2.0"', '"license": "MIT"', true],
        ['scripts.build', '"build": "vite build"', '"build": "vite build --mode bundled"', true],
        ['scripts.build removed', '"build": "vite build",\n', '', true],
        ['a script other than build', '"test": "vitest"', '"test": "vitest",\n        "lint": "oxlint"', false],
        ['name', '"name": "fixture"', '"name": "renamed"', false],
        ['dependencies, which pnpm-lock.yaml pins', '"react": "19.0.0"', '"react": "19.1.0"', false],
    ])(
        'moves the package.json projection on an edit to %s only when the generator reads it',
        (_field, before, after, moves) => {
            expect(PACKAGE_JSON).toContain(before);
            const baselineProjection = packageJsonLicenceFieldsProjection(PACKAGE_JSON, 'package.json');
            const edited = packageJsonLicenceFieldsProjection(PACKAGE_JSON.replace(before, after), 'package.json');
            expect(edited !== baselineProjection).toBe(moves);
        }
    );

    it('rejects a package.json with duplicate keys', () => {
        expect(() =>
            packageJsonLicenceFieldsProjection('{"license":"MIT","license":"Apache-2.0"}', 'package.json')
        ).toThrow('duplicate key');
    });

    it.each([
        ['the node_modules exclusion removed', "    - '!node_modules/**/*'\n", '', true],
        ['the node_modules exclusion rewritten', "'!node_modules/**/*'", "'!node_modules/**'", true],
        ['another packaging line', 'from: crates/sourdaw-native', 'from: crates/renamed', false],
    ])(
        'moves the electron-builder.yml projection on %s only when the generator reads it',
        (_change, before, after, moves) => {
            expect(ELECTRON_BUILDER).toContain(before);
            const baselineProjection = electronBuilderNodeModulesExclusionProjection(ELECTRON_BUILDER);
            const edited = electronBuilderNodeModulesExclusionProjection(ELECTRON_BUILDER.replace(before, after));
            expect(edited !== baselineProjection).toBe(moves);
        }
    );

    it.each([
        [
            'an assembled licence election',
            (manifest: Record<string, unknown>) => {
                const packages = manifest.packages as Record<string, { assembled: { licenses: string[] } }>;
                packages['cargo:napi@3.16.2']!.assembled.licenses = ['Apache-2.0'];
            },
            true,
        ],
        [
            'a legal file entry',
            (manifest: Record<string, unknown>) => {
                const packages = manifest.packages as Record<string, { files: Array<{ sha256: string }> }>;
                packages['npm:demo@1.0.0']!.files[0]!.sha256 = 'e'.repeat(64);
            },
            true,
        ],
        [
            'a proof removed',
            (manifest: Record<string, unknown>) => {
                const packages = manifest.packages as Record<string, unknown>;
                delete packages['npm:demo@1.0.0'];
            },
            true,
        ],
        [
            'the generated Cargo runtime inventory',
            (manifest: Record<string, unknown>) => {
                (manifest.cargoRuntimeInventory as { cargoLockSha256: string }).cargoLockSha256 = 'f'.repeat(64);
            },
            false,
        ],
    ])('moves the curated proofs projection on %s only when it is curated', (_change, edit, moves) => {
        const baselineProjection = curatedDependencyLicenseProofsProjection(PROOFS, 'proofs.json');
        expect(proofsEdit(edit) !== baselineProjection).toBe(moves);
    });

    it.each([
        ['Cargo.toml', 'cargo-manifest-licence-graph'],
        ['crates/sourdaw-native/Cargo.toml', 'cargo-manifest-licence-graph'],
        ['package.json', 'package-json-licence-fields'],
        ['server/package.json', 'whole-file'],
        ['electron-builder.yml', 'electron-builder-node-modules-exclusion'],
        ['rust-toolchain.toml', 'whole-file'],
        ['.cargo/config.toml', 'whole-file'],
        ['scripts/buildNativeAddon.ts', 'whole-file'],
    ])('pins %s by the %s projection', (path, projection) => {
        expect(licenceInputProjectionKind(path)).toBe(projection);
    });

    it('digests a whole-file input byte for byte', () => {
        const bytes = Buffer.from('channel = "1.95.0"\n# comment\n', 'utf8');
        const edited = Buffer.from('channel = "1.95.0"\n# other comment\n', 'utf8');
        expect(licenceInputDigest('rust-toolchain.toml', bytes)).not.toEqual(
            licenceInputDigest('rust-toolchain.toml', edited)
        );
    });
});
