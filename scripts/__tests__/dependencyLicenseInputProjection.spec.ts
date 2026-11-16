import { describe, expect, it } from 'vitest';

import {
    cargoManifestLicenceGraphProjection,
    cargoWorkspaceMemberManifestPaths,
    curatedDependencyLicenseProofsProjection,
    licenceInputDigest,
    licenceInputProjectionKind,
    packageJsonPackagingProjection,
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
    "version": "1.0.0",
    "license": "Apache-2.0",
    "main": "electron/out/main.js",
    "scripts": {
        "build": "vite build",
        "desktop:build": "pnpm run native:addon && electron-builder --config electron-builder.yml --publish never",
        "native:addon": "node scripts/buildNativeAddon.ts",
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

    // Cargo reads `[dev_dependencies]` and `[build_dependencies]` as the hyphenated tables, so an
    // entry there can enable an optional, already-locked crate and change the runtime graph.
    const UNDERSCORE_MANIFEST = `[workspace]
members = ["crates/a"]
default_members = ["crates/a"]

[package]
name = "demo"
license_file = "LICENSE"

[dev_dependencies]
tempfile = "3"

[build_dependencies]
cc = "1"

[target.'cfg(unix)'.dev_dependencies]
libc = "0.2"
`;
    const underscoreBaseline = cargoManifestLicenceGraphProjection(UNDERSCORE_MANIFEST, 'Cargo.toml');

    it.each([
        [
            '[dev_dependencies] add',
            'tempfile = "3"\n',
            'tempfile = "3"\nnapi = { version = "3", features = ["tokio"] }\n',
        ],
        ['[dev_dependencies] re-version', 'tempfile = "3"', 'tempfile = "4"'],
        ['[build_dependencies] add', 'cc = "1"\n', 'cc = "1"\nnapi-build = "2"\n'],
        ["[target.'cfg(unix)'.dev_dependencies] add", 'libc = "0.2"\n', 'libc = "0.2"\nnix = "0.29"\n'],
        ['[package] license_file', 'license_file = "LICENSE"', 'license_file = "LICENSE-MIT"'],
        ['[workspace] default_members', 'default_members = ["crates/a"]', 'default_members = []'],
    ])('moves the Cargo projection on the underscore spelling %s', (_change, before, after) => {
        expect(UNDERSCORE_MANIFEST).toContain(before);
        const edited = cargoManifestLicenceGraphProjection(UNDERSCORE_MANIFEST.replace(before, after), 'Cargo.toml');
        expect(edited).not.toBe(underscoreBaseline);
    });

    // TOML reads a quoted key segment as its unquoted text, so Cargo sees each table below as the
    // bare spelling; a quoted dependency table must pin like a bare one.
    const QUOTED_MANIFEST = `"features".x = ["a"]

[package]
name = "demo"
"license" = "MIT"
"description" = "Demo crate"

["dependencies"]
serde = "1"

['build-dependencies']
cc = "1"

[target.x."dependencies"]
libc = "0.2"

[target.'cfg(unix)'."dev-dependencies"]
tempfile = "3"

["patch".crates-io]
cpal = { path = "vendor/cpal" }
`;
    const quotedBaseline = cargoManifestLicenceGraphProjection(QUOTED_MANIFEST, 'Cargo.toml');

    it.each([
        ['["dependencies"] add', 'serde = "1"\n', 'serde = "1"\nrtrb = "0.4"\n'],
        ["['build-dependencies'] add", 'cc = "1"\n', 'cc = "1"\nnapi-build = "2"\n'],
        ['[target.x."dependencies"] add', 'libc = "0.2"\n', 'libc = "0.2"\nnix = "0.29"\n'],
        [`[target.'cfg(unix)'."dev-dependencies"] add`, 'tempfile = "3"\n', 'tempfile = "3"\nproptest = "1"\n'],
        // A root dotted key cannot also define the `["dependencies"]` table, so it extends another dependency table.
        ['root "dev-dependencies".evil add', '"features".x', '"dev-dependencies".evil = "1"\n"features".x'],
        ['root "features".x change', '"features".x = ["a"]', '"features".x = ["a", "b"]'],
        [
            '["patch".crates-io] add',
            'path = "vendor/cpal" }\n',
            'path = "vendor/cpal" }\nrubato = { path = "vendor/rubato" }\n',
        ],
        ['[package] "license" change', '"license" = "MIT"', '"license" = "Apache-2.0"'],
    ])('moves the Cargo projection on the quoted spelling %s', (_change, before, after) => {
        expect(QUOTED_MANIFEST).toContain(before);
        const edited = cargoManifestLicenceGraphProjection(QUOTED_MANIFEST.replace(before, after), 'Cargo.toml');
        expect(edited).not.toBe(quotedBaseline);
    });

    it('leaves the Cargo projection alone on a quoted key the licence graph does not read', () => {
        const before = '"description" = "Demo crate"';
        expect(QUOTED_MANIFEST).toContain(before);
        const edited = cargoManifestLicenceGraphProjection(
            QUOTED_MANIFEST.replace(before, '"description" = "A demo crate"'),
            'Cargo.toml'
        );
        expect(edited).toBe(quotedBaseline);
    });

    it('keeps a quoted target cfg table whole, dots and quotes inside the cfg included', () => {
        const manifest = `[target.'cfg(target_os = "macos")'.dependencies]
coreaudio-rs = "0.13"

[target."cfg(all(unix, target_env = \\"gnu\\"))".dependencies]
libc = "0.2"

[target.'cfg(unix)'.dev_dependencies]
nix = "0.29"
`;
        expect(cargoManifestLicenceGraphProjection(manifest, 'Cargo.toml')).toBe(
            `${JSON.stringify({
                target: {
                    'cfg(all(unix, target_env = "gnu"))': { dependencies: { libc: '0.2' } },
                    'cfg(target_os = "macos")': { dependencies: { 'coreaudio-rs': '0.13' } },
                    'cfg(unix)': { dev_dependencies: { nix: '0.29' } },
                },
            })}\n`
        );
        // The digest of this fixture's canonical JSON projection: a format change must restamp the committed pins.
        expect(licenceInputDigest('Cargo.toml', Buffer.from(MANIFEST, 'utf8')).sha256).toBe(
            '852290e45dbe79e16b919115088353f90be2e5b4e8a66ca60b0605ce3785db98'
        );
    });

    it('fails closed on a dependency table spelling the projection does not know', () => {
        expect(() =>
            cargoManifestLicenceGraphProjection('[target.\'cfg(unix)\'.devdependencies]\nlibc = "0.2"\n', 'Cargo.toml')
        ).toThrow('unrecognised dependency table key target."cfg(unix)".devdependencies');
        expect(() =>
            cargoManifestLicenceGraphProjection('[package]\nnormal_dependencies = []\n', 'Cargo.toml')
        ).toThrow('unrecognised dependency table key package.normal_dependencies');
        expect(() =>
            cargoManifestLicenceGraphProjection('[[bin]]\nname = "x"\nextra-dependencies = []\n', 'Cargo.toml')
        ).toThrow('unrecognised dependency table key bin.extra-dependencies');
        expect(
            cargoManifestLicenceGraphProjection('[package.metadata.machete]\nignored-dependencies = []\n', 'Cargo.toml')
        ).toBe('{"package":{}}\n');
        expect(
            cargoManifestLicenceGraphProjection('[workspace.metadata.x]\nignored-dependencies = []\n', 'Cargo.toml')
        ).toBe('{"workspace":{}}\n');
        expect(() =>
            cargoManifestLicenceGraphProjection('[workspace.package]\nextra_dependencies = []\n', 'Cargo.toml')
        ).toThrow('unrecognised dependency table key workspace.package.extra_dependencies');
    });

    it.each([
        ['a workspace root', '[workspace.lints.rust]\nunused_crate_dependencies = "warn"\n', '{"workspace":{}}\n'],
        ['a member manifest', '[lints.rust]\nunused_crate_dependencies = "warn"\n', '{}\n'],
    ])('ignores the unused_crate_dependencies lint in %s', (_manifest, text, projection) => {
        expect(cargoManifestLicenceGraphProjection(text, 'Cargo.toml')).toBe(projection);
    });

    // The parse reads strings, escapes and comments as Cargo does, so text inside them can neither
    // hide a later key nor be read as one.
    const ESCAPE_MANIFEST = `[dependencies]
# A comment holding " and # must not open a string.
foo = { version = "1", note = "\\" #", features = ["a"] }
serde = "1"
`;
    const MULTILINE_STRING_MANIFEST = `[package]
name = "demo"
description = """
A crate whose description holds what looks like a table:
[dependencies]
evil = "1"
"""

[dependencies]
serde = "1"
`;

    it.each([
        ['a feature change after an escaped quote and #', ESCAPE_MANIFEST, 'features = ["a"]', 'features = ["a", "b"]'],
        ['a dependency change after a comment holding " and #', ESCAPE_MANIFEST, 'serde = "1"', 'serde = "2"'],
        [
            'a dependency added after a comment holding " and #',
            ESCAPE_MANIFEST,
            'serde = "1"\n',
            'serde = "1"\nrtrb = "0.4"\n',
        ],
        [
            'a dependency change after a multi-line basic string',
            MULTILINE_STRING_MANIFEST,
            'serde = "1"',
            'serde = "2"',
        ],
    ])('moves the Cargo projection on %s', (_change, manifest, before, after) => {
        expect(manifest).toContain(before);
        const baselineProjection = cargoManifestLicenceGraphProjection(manifest, 'Cargo.toml');
        const edited = cargoManifestLicenceGraphProjection(manifest.replace(before, after), 'Cargo.toml');
        expect(edited).not.toBe(baselineProjection);
    });

    it('reads string and comment text as Cargo does, not as keys', () => {
        const escapeBaseline = cargoManifestLicenceGraphProjection(ESCAPE_MANIFEST, 'Cargo.toml');
        expect(JSON.parse(escapeBaseline)).toEqual({
            dependencies: { foo: { version: '1', note: '" #', features: ['a'] }, serde: '1' },
        });
        const recommented = ESCAPE_MANIFEST.replace('# A comment holding " and #', '# Another comment holding " and #');
        expect(cargoManifestLicenceGraphProjection(recommented, 'Cargo.toml')).toBe(escapeBaseline);
        const multilineBaseline = cargoManifestLicenceGraphProjection(MULTILINE_STRING_MANIFEST, 'Cargo.toml');
        expect(JSON.parse(multilineBaseline)).toEqual({ package: {}, dependencies: { serde: '1' } });
        expect(
            cargoManifestLicenceGraphProjection(
                MULTILINE_STRING_MANIFEST.replace('evil = "1"', 'evil = "2"'),
                'Cargo.toml'
            )
        ).toBe(multilineBaseline);
    });

    it('leaves the Cargo projection alone on table reorder', () => {
        const table = '[dev-dependencies]\ntempfile = "3"\n';
        expect(MANIFEST).toContain(`${table}\n`);
        const reordered = `${MANIFEST.replace(`${table}\n`, '')}\n${table}`;
        expect(cargoManifestLicenceGraphProjection(reordered, 'Cargo.toml')).toBe(baseline);
    });

    it('fails closed on a manifest TOML cannot parse', () => {
        expect(() => cargoManifestLicenceGraphProjection('[dependencies]\nserde\n', 'Cargo.toml')).toThrow(
            'Cargo.toml: unparseable Cargo manifest'
        );
        expect(() =>
            cargoManifestLicenceGraphProjection('[dependencies]\nfoo = { version = "1", note = "\\" }\n', 'Cargo.toml')
        ).toThrow('Cargo.toml: unparseable Cargo manifest');
        expect(() =>
            cargoManifestLicenceGraphProjection('[dependencies]\nserde = "1"\nserde = "2"\n', 'Cargo.toml')
        ).toThrow('Cargo.toml: unparseable Cargo manifest');
    });

    it('derives workspace member manifests from the parsed members list', () => {
        expect(cargoWorkspaceMemberManifestPaths(MANIFEST, 'Cargo.toml')).toEqual([
            'crates/a/Cargo.toml',
            'crates/b/Cargo.toml',
        ]);
        expect(
            cargoWorkspaceMemberManifestPaths(
                '[workspace]\nmembers = [\n    "crates/a", # first\n    "./crates/b/",\n]\n',
                'Cargo.toml'
            )
        ).toEqual(['crates/a/Cargo.toml', 'crates/b/Cargo.toml']);
        expect(cargoWorkspaceMemberManifestPaths('[package]\nname = "solo"\n', 'Cargo.toml')).toEqual([]);
        expect(() => cargoWorkspaceMemberManifestPaths('[workspace]\nmembers = ["crates/*"]\n', 'Cargo.toml')).toThrow(
            'glob workspace member crates/* is not supported'
        );
        expect(() => cargoWorkspaceMemberManifestPaths('[workspace]\nmembers = [1]\n', 'Cargo.toml')).toThrow(
            'workspace.members must be an array of strings'
        );
    });

    it.each([
        ['license', '"license": "Apache-2.0"', '"license": "MIT"', true],
        ['scripts.build', '"build": "vite build"', '"build": "vite build --mode bundled"', true],
        ['scripts.build removed', '"build": "vite build",\n', '', true],
        ['desktop:build dropping its electron-builder config', ' --config electron-builder.yml', '', true],
        [
            'a top-level electron-builder build key',
            '"main": "electron/out/main.js",',
            '"main": "electron/out/main.js",\n    "build": { "files": ["node_modules/**/*"] },',
            true,
        ],
        ['main', '"main": "electron/out/main.js"', '"main": "electron/out/other.js"', true],
        ['files', '"main": "electron/out/main.js",', '"main": "electron/out/main.js",\n    "files": ["dist"],', true],
        ['an added dependency', '"react": "19.0.0"', '"react": "19.0.0",\n        "left-pad": "1.3.0"', true],
        ['a re-versioned dependency', '"react": "19.0.0"', '"react": "19.1.0"', true],
        [
            'a script desktop:build runs through pnpm run',
            '"native:addon": "node scripts/buildNativeAddon.ts"',
            '"native:addon": "node scripts/buildNativeAddonRenamed.ts"',
            true,
        ],
        [
            'an added postinstall hook',
            '"test": "vitest"',
            '"test": "vitest",\n        "postinstall": "node fetch.js"',
            true,
        ],
        [
            'an added pre hook of a packaging script',
            '"test": "vitest"',
            '"test": "vitest",\n        "predesktop:build": "node fetch.js"',
            true,
        ],
        ['an unknown top-level key', '"name": "fixture",', '"name": "fixture",\n    "future": true,', true],
        ['name', '"name": "fixture"', '"name": "renamed"', true],
        ['version', '"version": "1.0.0"', '"version": "1.1.0"', false],
        ['an added unrelated script', '"test": "vitest"', '"test": "vitest",\n        "lint:foo": "oxlint"', false],
        ['an unrelated existing script', '"test": "vitest"', '"test": "vitest run"', false],
    ])(
        'moves the package.json projection on an edit to %s only when packaging can read it',
        (_field, before, after, moves) => {
            expect(PACKAGE_JSON).toContain(before);
            const baselineProjection = packageJsonPackagingProjection(PACKAGE_JSON, 'package.json');
            const edited = packageJsonPackagingProjection(PACKAGE_JSON.replace(before, after), 'package.json');
            expect(edited !== baselineProjection).toBe(moves);
        }
    );

    it.each([
        ['pnpm with a flag', { 'desktop:build': 'pnpm --silent prep' }],
        ['pnpm --filter . run', { build: 'vite build && pnpm --filter . run prep' }],
        ['pnpm -C .', { build: 'vite build && pnpm -C . prep' }],
        ['node --run', { build: 'vite build && node --run prep' }],
        ['npm run --script-shell=sh', { build: 'npm run --script-shell=sh prep' }],
        ['a pnpm:devPreinstall hook', { 'pnpm:devPreinstall': 'pnpm prep' }],
        ['an environment assignment', { build: 'vite build && STAGE=prep tool' }],
        ['an output redirection', { build: 'vite build && tool>prep' }],
        ['an input redirection', { build: 'vite build && tool <prep' }],
    ])('keeps a script packaging reaches through %s, and drops an unrelated one', (_form, roots) => {
        const manifest = (prep: string, lint: string): string =>
            JSON.stringify({ license: 'MIT', scripts: { ...roots, prep, lint } });
        const kept = packageJsonPackagingProjection(manifest('a', 'x'), 'package.json');
        expect(kept).not.toBe(packageJsonPackagingProjection(manifest('b', 'x'), 'package.json'));
        expect(kept).toBe(packageJsonPackagingProjection(manifest('a', 'y'), 'package.json'));
    });

    it('moves the package.json projection on a pnpm:devPreinstall edit', () => {
        const manifest = (hook: string): string =>
            JSON.stringify({ license: 'MIT', scripts: { build: 'vite build', 'pnpm:devPreinstall': hook } });
        expect(packageJsonPackagingProjection(manifest('node a.js'), 'package.json')).not.toBe(
            packageJsonPackagingProjection(manifest('node b.js'), 'package.json')
        );
    });

    it('rejects a package.json with duplicate keys', () => {
        expect(() =>
            packageJsonPackagingProjection('{"license":"MIT","license":"Apache-2.0"}', 'package.json')
        ).toThrow('duplicate key');
    });

    // electron-builder applies `files` patterns in order, so any line can change what the bundle ships.
    it.each([
        ['the node_modules exclusion removed', "    - '!node_modules/**/*'\n", ''],
        ['the node_modules exclusion rewritten', "'!node_modules/**/*'", "'!node_modules/**'"],
        [
            'node_modules re-included after the exclusion',
            "    - '!node_modules/**/*'\n",
            "    - '!node_modules/**/*'\n    - 'node_modules/**/*'\n",
        ],
        ['another packaging line', 'from: crates/sourdaw-native', 'from: crates/renamed'],
    ])('moves the electron-builder.yml pin on %s', (_change, before, after) => {
        expect(ELECTRON_BUILDER).toContain(before);
        const baseline = licenceInputDigest('electron-builder.yml', Buffer.from(ELECTRON_BUILDER, 'utf8'));
        const edited = licenceInputDigest(
            'electron-builder.yml',
            Buffer.from(ELECTRON_BUILDER.replace(before, after), 'utf8')
        );
        expect(edited.sha256).not.toBe(baseline.sha256);
    });

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
        ['package.json', 'package-json-packaging'],
        ['server/package.json', 'whole-file'],
        ['electron-builder.yml', 'whole-file'],
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
