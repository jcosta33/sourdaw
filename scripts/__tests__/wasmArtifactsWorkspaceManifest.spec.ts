import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { wasmArtifacts } from '../wasm-artifacts';
import { workspaceDependencyNames, workspaceManifestFingerprintInput } from '../workspaceManifestFingerprint';

/**
 * #3473: `hashCrateClosure` used to hash the raw bytes of the workspace-root
 * `Cargo.toml`, so an unrelated `[workspace].members` edit — a new crate, a
 * comment, reflowed whitespace — moved every wasm package's recorded hash and
 * reddened `pnpm wasm:verify` for no byte change in any cdylib. These specs
 * pin the canonical rendering (`workspaceManifestFingerprintInput`) and the
 * used-dependency scan (`workspaceDependencyNames`) it depends on, and the
 * injectable-manifest wiring on `hashCrateClosure` itself.
 */

const baseManifest = `[workspace]
members = [
    "crates/a",
    "crates/b",
]
resolver = "2"

[workspace.package]
authors = ["Test"]

[workspace.dependencies]
serde = "1"
unused-dep = "2"

[profile.release]
opt-level = 3
lto = true
`;

const usedDependencies = new Set(['serde']);

describe('workspaceManifestFingerprintInput', () => {
    it('renders identically when members, a comment, whitespace reflow, or a profile comment/trailing-whitespace change', () => {
        const editedManifest = `[workspace]
members = [
"crates/a",
    "crates/b",
        "crates/c",
]
resolver = "2"
# a brand new unrelated comment

[workspace.package]
authors = ["Test"]

[workspace.dependencies]
serde = "1"
unused-dep = "2"

[profile.release]
opt-level = 3
    lto = true  # ship it clean
`;

        expect(workspaceManifestFingerprintInput(editedManifest, usedDependencies)).toEqual(
            workspaceManifestFingerprintInput(baseManifest, usedDependencies)
        );
    });

    it('changes when [profile.release] opt-level changes', () => {
        const optLevelChanged = baseManifest.replace('opt-level = 3', 'opt-level = 2');

        expect(workspaceManifestFingerprintInput(optLevelChanged, usedDependencies)).not.toEqual(
            workspaceManifestFingerprintInput(baseManifest, usedDependencies)
        );
    });

    it('changes when a [profile.release.package."foo"] override table is added', () => {
        const withPackageOverride = `${baseManifest}
[profile.release.package."foo"]
opt-level = 1
`;

        const rendered = workspaceManifestFingerprintInput(withPackageOverride, usedDependencies);

        expect(rendered).not.toEqual(workspaceManifestFingerprintInput(baseManifest, usedDependencies));
        expect(rendered).toContain('[profile.release.package."foo"]');
    });

    it('drops a [workspace.dependencies] entry the closure never resolves and ignores its edits', () => {
        const rendered = workspaceManifestFingerprintInput(baseManifest, usedDependencies);
        expect(rendered).not.toContain('unused-dep');

        const unusedDepChanged = baseManifest.replace('unused-dep = "2"', 'unused-dep = "99"');
        expect(workspaceManifestFingerprintInput(unusedDepChanged, usedDependencies)).toEqual(rendered);
    });

    it('keeps a [workspace.dependencies] entry the closure resolves and reacts to its edits', () => {
        const rendered = workspaceManifestFingerprintInput(baseManifest, usedDependencies);
        expect(rendered).toContain('serde = "1"');

        const usedDepChanged = baseManifest.replace('serde = "1"', 'serde = "9"');
        expect(workspaceManifestFingerprintInput(usedDepChanged, usedDependencies)).not.toEqual(rendered);
    });

    it('pins [workspace.package]: the rendering carries its lines, and editing one moves the rendering', () => {
        const rendered = workspaceManifestFingerprintInput(baseManifest, usedDependencies);
        expect(rendered).toContain('authors = ["Test"]');

        const authorsChanged = baseManifest.replace('authors = ["Test"]', 'authors = ["Someone Else"]');
        expect(workspaceManifestFingerprintInput(authorsChanged, usedDependencies)).not.toEqual(rendered);
    });

    it('keeps a used [workspace.dependencies.<name>] sub-table whole and drops an unused one', () => {
        const withDependencySubTables = `${baseManifest}
[workspace.dependencies.tokio]
version = "1"
workspace = true

[workspace.dependencies.unused-sub]
version = "9"
workspace = true
`;

        const rendered = workspaceManifestFingerprintInput(withDependencySubTables, new Set(['serde', 'tokio']));

        expect(rendered).toContain('[workspace.dependencies.tokio]');
        expect(rendered).toContain('version = "1"');
        expect(rendered).not.toContain('unused-sub');
    });

    it('renders a dotted-key [workspace.dependencies] entry (serde.version = "1") when used and drops it when unused', () => {
        const withDottedEntry = `[workspace.dependencies]
serde.version = "1"
`;

        expect(workspaceManifestFingerprintInput(withDottedEntry, new Set(['serde']))).toContain('serde.version = "1"');
        expect(workspaceManifestFingerprintInput(withDottedEntry, new Set())).not.toContain('serde.version');
    });

    it('renders [patch.*] tables and the [workspace] resolver line verbatim', () => {
        const withPatch = `${baseManifest}
[patch.crates-io]
foo = { git = "https://example.com/foo" }
`;

        const rendered = workspaceManifestFingerprintInput(withPatch, usedDependencies);

        expect(rendered).toContain('[patch.crates-io]');
        expect(rendered).toContain('foo = { git = "https://example.com/foo" }');
        expect(rendered).toContain('resolver = "2"');
    });
});

describe('workspaceDependencyNames', () => {
    it('finds an inline-table workspace dependency and excludes [package] table inheritance', () => {
        const cargoToml = `[package]
name = "example"
authors.workspace = true

[dependencies]
serde = { workspace = true }
other = "1.0"
`;

        expect(workspaceDependencyNames(cargoToml)).toEqual(new Set(['serde']));
    });

    it('finds a [dependencies.name] sub-table workspace dependency', () => {
        const cargoToml = `[package]
name = "example"

[dependencies.serde]
workspace = true
features = ["derive"]
`;

        expect(workspaceDependencyNames(cargoToml)).toEqual(new Set(['serde']));
    });

    it('finds a workspace dependency under a target.<cfg>.dependencies table', () => {
        const cargoToml = `[target.'cfg(target_arch = "wasm32")'.dependencies]
windows = { workspace = true }
`;

        expect(workspaceDependencyNames(cargoToml)).toEqual(new Set(['windows']));
    });

    it('finds a dotted-key workspace dependency: name.workspace = true', () => {
        const cargoToml = `[dependencies]
serde.workspace = true
`;

        expect(workspaceDependencyNames(cargoToml)).toEqual(new Set(['serde']));
    });

    it('accumulates a multi-line inline-table dependency spanning several source lines (crates/daw-engine/Cargo.toml:39-45)', () => {
        const cargoToml = `[target.'cfg(windows)'.dependencies]
windows = { workspace = true, features = [
    "Win32_Foundation",
    "Win32_Media_Audio",
    "Win32_Security",
    "Win32_System_Com",
] }
`;

        expect(workspaceDependencyNames(cargoToml)).toEqual(new Set(['windows']));
    });

    it('throws on a dependency entry it cannot classify, instead of silently dropping it', () => {
        const cargoToml = `[dependencies]
broken-dep = 1.0
`;

        expect(() => workspaceDependencyNames(cargoToml)).toThrow(
            'Unrecognised dependency entry in dependencies: broken-dep = 1.0'
        );
    });
});

describe('hashCrateClosure (integration, real repository)', () => {
    it('is stable across repeated calls for the same crate', () => {
        const first = wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder');
        const second = wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder');

        expect(first).toEqual(second);
    });

    it('renders the real root Cargo.toml down to profile tables only, dropping members and unrelated crates', () => {
        const crateDir = 'crates/daw-wasm-decoder';
        const usedWorkspaceDependencies = new Set<string>();
        for (const dir of wasmArtifacts.pathDepClosure(crateDir)) {
            const cargoToml = readFileSync(wasmArtifacts.absolute(`${dir}/Cargo.toml`), 'utf8');
            for (const name of workspaceDependencyNames(cargoToml)) {
                usedWorkspaceDependencies.add(name);
            }
        }
        const manifestText = readFileSync(wasmArtifacts.absolute('Cargo.toml'), 'utf8');
        const rendered = workspaceManifestFingerprintInput(manifestText, usedWorkspaceDependencies);

        expect(rendered).toContain('[profile.release]');
        expect(rendered).not.toContain('members');
        expect(rendered).not.toContain('sourdaw-harness-tone');
    });

    it('accepts an injectable root manifest text and is unaffected by an extra member and an extra profile comment', () => {
        const realManifestText = readFileSync(wasmArtifacts.absolute('Cargo.toml'), 'utf8');
        const baseline = wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder', realManifestText);

        const editedManifestText = realManifestText
            .replace('"crates/sourdaw-native"', '"crates/sourdaw-native",\n    "crates/fake-member-for-spec"')
            .replace('opt-level = 3', 'opt-level = 3 # unrelated comment');

        expect(wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder', editedManifestText)).toEqual(baseline);
    });

    it('moves when an injected root manifest changes [profile.release] opt-level', () => {
        const realManifestText = readFileSync(wasmArtifacts.absolute('Cargo.toml'), 'utf8');
        const baseline = wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder', realManifestText);

        const optLevelChanged = realManifestText.replace('opt-level = 3', 'opt-level = 2');

        expect(wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder', optLevelChanged)).not.toEqual(baseline);
    });
});
