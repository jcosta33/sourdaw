import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { wasmArtifacts } from '../wasm-artifacts';

/**
 * #3473: `hashCrateClosure` used to hash the raw bytes of the workspace-root
 * `Cargo.toml`, so an unrelated `[workspace].members` edit — a new crate, a
 * comment, reflowed whitespace — moved every wasm package's recorded hash and
 * reddened `pnpm wasm:verify` for no byte change in any cdylib. These specs
 * pin the canonical rendering (`workspaceManifestFingerprintInput`) and the
 * used-dependency scan (`workspaceDependencyNames`) it depends on.
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
    it('renders identically when only members, a comment, or their whitespace change', () => {
        const membersEdited = `[workspace]
members = [
"crates/a",
    "crates/b",
        "crates/c",
]
resolver = "3"
# a brand new unrelated comment

[workspace.package]
authors = ["Test"]

[workspace.dependencies]
serde = "1"
unused-dep = "2"

[profile.release]
opt-level = 3
lto = true
`;

        expect(wasmArtifacts.workspaceManifestFingerprintInput(membersEdited, usedDependencies)).toEqual(
            wasmArtifacts.workspaceManifestFingerprintInput(baseManifest, usedDependencies)
        );
    });

    it('changes when [profile.release] opt-level changes', () => {
        const optLevelChanged = baseManifest.replace('opt-level = 3', 'opt-level = 2');

        expect(wasmArtifacts.workspaceManifestFingerprintInput(optLevelChanged, usedDependencies)).not.toEqual(
            wasmArtifacts.workspaceManifestFingerprintInput(baseManifest, usedDependencies)
        );
    });

    it('changes when a [profile.release.package."foo"] override table is added', () => {
        const withPackageOverride = `${baseManifest}
[profile.release.package."foo"]
opt-level = 1
`;

        const rendered = wasmArtifacts.workspaceManifestFingerprintInput(withPackageOverride, usedDependencies);

        expect(rendered).not.toEqual(wasmArtifacts.workspaceManifestFingerprintInput(baseManifest, usedDependencies));
        expect(rendered).toContain('[profile.release.package."foo"]');
    });

    it('drops a [workspace.dependencies] entry the closure never resolves and ignores its edits', () => {
        const rendered = wasmArtifacts.workspaceManifestFingerprintInput(baseManifest, usedDependencies);
        expect(rendered).not.toContain('unused-dep');

        const unusedDepChanged = baseManifest.replace('unused-dep = "2"', 'unused-dep = "99"');
        expect(wasmArtifacts.workspaceManifestFingerprintInput(unusedDepChanged, usedDependencies)).toEqual(rendered);
    });

    it('keeps a [workspace.dependencies] entry the closure resolves and reacts to its edits', () => {
        const rendered = wasmArtifacts.workspaceManifestFingerprintInput(baseManifest, usedDependencies);
        expect(rendered).toContain('serde = "1"');

        const usedDepChanged = baseManifest.replace('serde = "1"', 'serde = "9"');
        expect(wasmArtifacts.workspaceManifestFingerprintInput(usedDepChanged, usedDependencies)).not.toEqual(rendered);
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

        expect(wasmArtifacts.workspaceDependencyNames(cargoToml)).toEqual(new Set(['serde']));
    });

    it('finds a [dependencies.name] sub-table workspace dependency', () => {
        const cargoToml = `[package]
name = "example"

[dependencies.serde]
workspace = true
features = ["derive"]
`;

        expect(wasmArtifacts.workspaceDependencyNames(cargoToml)).toEqual(new Set(['serde']));
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
            for (const name of wasmArtifacts.workspaceDependencyNames(cargoToml)) {
                usedWorkspaceDependencies.add(name);
            }
        }
        const manifestText = readFileSync(wasmArtifacts.absolute('Cargo.toml'), 'utf8');
        const rendered = wasmArtifacts.workspaceManifestFingerprintInput(manifestText, usedWorkspaceDependencies);

        expect(rendered).toContain('[profile.release]');
        expect(rendered).not.toContain('members');
        expect(rendered).not.toContain('sourdaw-harness-tone');
    });
});
